const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('../config/db');
const { broadcastSeatUpdate } = require('../utils/seatEvents');

const LEAVE_ITEM_TIMEOUT_MINUTES = Number(process.env.LEAVE_ITEM_TIMEOUT_MINUTES || 15);

// 全局状态：保存模拟器进程和数据
let simulateProcess = null;
let simulateData = null;
let simulateStartTime = null;

const PYTHON_SCRIPT_DIR = path.join(__dirname, '../python_scripts');
const DEBUG_OUTPUT_DIR = path.join(__dirname, '../python_scripts/debug_output');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LIBRARY_SAMPLED_DATA = path.join(PROJECT_ROOT, 'library_sampled_data');
const SEATS_JSON_PATH = path.join(PYTHON_SCRIPT_DIR, 'seats.json');
const BACKEND_DIR = path.resolve(__dirname, '..');
const SEAT_META_PATH = path.join(PYTHON_SCRIPT_DIR, 'seats_meta.json');
const UPLOAD_ROOT = path.join(BACKEND_DIR, 'uploads');
const UPLOAD_SIMULATE_DIR = path.join(UPLOAD_ROOT, 'simulate_samples');

const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const token = authHeader && String(authHeader).startsWith('Bearer ')
    ? String(authHeader).slice(7)
    : '';
  if (!token) {
    return res.status(401).json({ success: false, error: '未提供访问令牌' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (String(decoded?.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ success: false, error: '仅管理员可操作' });
    }
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(403).json({ success: false, error: '令牌无效' });
  }
};

const readSeatsConfig = () => {
  if (!fs.existsSync(SEATS_JSON_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(SEATS_JSON_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
};

const validateSeatsArray = (seats) => {
  if (!Array.isArray(seats)) {
    return 'seats 必须是数组';
  }
  for (let i = 0; i < seats.length; i += 1) {
    const seat = seats[i];
    if (!Array.isArray(seat) || seat.length !== 4) {
      return `第 ${i + 1} 个座位格式错误，必须为 [x1, y1, x2, y2]`;
    }
    const [x1, y1, x2, y2] = seat.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) {
      return `第 ${i + 1} 个座位存在非数字坐标`;
    }
    if (x2 <= x1 || y2 <= y1) {
      return `第 ${i + 1} 个座位坐标范围无效（需满足 x2>x1 且 y2>y1）`;
    }
  }
  return '';
};

let lastAppliedSeatStateById = new Map();

const upsertNotificationHistory = async (conn, {
  userId,
  eventType = 'info',
  title,
  message,
  source,
  sourceKey,
  payload,
}) => {
  if (!userId || !title || !message || !source || !sourceKey) return;
  await conn.query(
    `INSERT INTO notification_history
       (user_id, event_type, title, message, source, source_key, payload_json, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       event_type = VALUES(event_type),
       title = VALUES(title),
       message = VALUES(message),
       payload_json = VALUES(payload_json),
       is_read = notification_history.is_read,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, eventType, title, message, source, sourceKey, payload ? JSON.stringify(payload) : null],
  );
};

const maybeCreatePresencePrompt = async (conn, { seatId, seatNumber, area, hasPerson }) => {
  if (!hasPerson) return;
  const [pendingRows] = await conn.query(
    `SELECT reservation_id, user_id
     FROM reservations
     WHERE seat_id = ? AND res_status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [seatId],
  );
  const pending = pendingRows[0];
  if (!pending) return;

  const [existingPrompts] = await conn.query(
    `SELECT prompt_id
     FROM reservation_presence_prompts
     WHERE reservation_id = ?
       AND prompt_status = 'pending'
       AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
     LIMIT 1`,
    [pending.reservation_id],
  );
  if (existingPrompts.length > 0) return;

  const [insertResult] = await conn.query(
    `INSERT INTO reservation_presence_prompts
       (reservation_id, user_id, seat_id, prompt_status, detected_at)
     VALUES (?, ?, ?, 'pending', NOW())`,
    [pending.reservation_id, pending.user_id, seatId],
  );
  const promptId = Number(insertResult?.insertId || 0);
  if (!Number.isInteger(promptId) || promptId <= 0) return;

  await upsertNotificationHistory(conn, {
    userId: pending.user_id,
    eventType: 'question',
    title: '检测到有人入座',
    message: `系统检测到你预约的座位 ${seatNumber || seatId} 已有人入座，是否为你本人？`,
    source: 'presence',
    sourceKey: `presence-created-${promptId}`,
    payload: {
      promptId,
      promptKind: 'presence',
      reservationId: pending.reservation_id,
      seatId,
      seatNumber,
      area,
      userId: pending.user_id,
    },
  });
};

const maybeCreateLeavePromptAndTimeout = async (conn, { seatId, seatNumber, area, withTimer }) => {
  if (!withTimer) return;
  const [activeRows] = await conn.query(
    `SELECT reservation_id, user_id
     FROM reservations
     WHERE seat_id = ? AND res_status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [seatId],
  );
  const active = activeRows[0];
  if (!active) return;

  const [existingPrompts] = await conn.query(
    `SELECT prompt_id
     FROM reservation_leave_prompts
     WHERE reservation_id = ?
       AND prompt_status = 'pending'
       AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
     LIMIT 1`,
    [active.reservation_id],
  );

  if (existingPrompts.length === 0) {
    const [insertResult] = await conn.query(
      `INSERT INTO reservation_leave_prompts
         (reservation_id, user_id, seat_id, prompt_status, detected_at)
       VALUES (?, ?, ?, 'pending', NOW())`,
      [active.reservation_id, active.user_id, seatId],
    );
    const promptId = Number(insertResult?.insertId || 0);
    if (Number.isInteger(promptId) && promptId > 0) {
      await upsertNotificationHistory(conn, {
        userId: active.user_id,
        eventType: 'question',
        title: '检测到你可能离开座位',
        message: `系统检测到你在${area}${seatNumber}的座位桌面仍有物品。请确认你是否暂时离开、稍后还会回来。`,
        source: 'leave-presence',
        sourceKey: `leave-created-${promptId}`,
        payload: {
          promptId,
          promptKind: 'leave',
          reservationId: active.reservation_id,
          seatId,
          seatNumber,
          area,
          userId: active.user_id,
        },
      });
    }
  }

  const [seatRows] = await conn.query(
    'SELECT item_occupied_since FROM seats WHERE seat_id = ? LIMIT 1',
    [seatId],
  );
  const startedAtRaw = seatRows[0]?.item_occupied_since;
  const startedAtMs = startedAtRaw ? new Date(startedAtRaw).getTime() : NaN;
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return;

  const timeoutMs = Math.max(1, LEAVE_ITEM_TIMEOUT_MINUTES) * 60 * 1000;
  if (Date.now() - startedAtMs < timeoutMs) return;

  await upsertNotificationHistory(conn, {
    userId: active.user_id,
    eventType: 'danger',
    title: '离座超时违规',
    message: `系统检测到你在${area}${seatNumber}离开后桌面物品已持续超过${LEAVE_ITEM_TIMEOUT_MINUTES}分钟，请尽快返回；否则将判定为违规并释放座位。`,
    source: 'leave-timeout',
    sourceKey: `leave-timeout-${seatId}-${startedAtMs}`,
    payload: {
      reservationId: active.reservation_id,
      seatId,
      seatNumber,
      area,
      itemOccupiedSince: new Date(startedAtMs).toISOString(),
      timeoutMinutes: LEAVE_ITEM_TIMEOUT_MINUTES,
    },
  });
};

const loadSeatMeta = () => {
  try {
    if (!fs.existsSync(SEAT_META_PATH)) return null;
    const raw = fs.readFileSync(SEAT_META_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) {
    return null;
  }
};

const applySimulationToDatabase = async (result) => {
  const seatStates = Array.isArray(result?.seatStates) ? result.seatStates : [];
  if (seatStates.length === 0) return;

  const seatMeta = loadSeatMeta();
  const mappings = Array.isArray(seatMeta?.seatMappings) ? seatMeta.seatMappings : [];
  const area = String(seatMeta?.area || '').trim();
  if (!area || mappings.length === 0) return;

  const conn = await db;
  const changedSeatIds = [];

  for (let i = 0; i < seatStates.length; i += 1) {
    const mapItem = mappings[i];
    const state = seatStates[i];
    const seatId = Number(mapItem?.seatId);
    if (!Number.isInteger(seatId) || seatId <= 0 || !state) continue;

    const hasPerson = Boolean(state.hasPerson);
    const hasItem = Boolean(state.hasItem);
    const occupied = Boolean(state.occupied);

    // 简化策略：
    // - 有人 -> status=2(占用), 清空物品计时
    // - 仅有物 -> status=3(异常占座), 启动/保持物品计时
    // - 无人无物 -> status=0(空闲), 清空物品计时
    const next = hasPerson
      ? { status: 2, withTimer: false }
      : (occupied && hasItem)
        ? { status: 3, withTimer: true }
        : { status: 0, withTimer: false };

    const prev = lastAppliedSeatStateById.get(seatId);
    if (prev && prev.status === next.status && prev.withTimer === next.withTimer) {
      continue;
    }

    if (next.withTimer) {
      await conn.query(
        `UPDATE seats
         SET status = ?, item_occupied_since = COALESCE(item_occupied_since, NOW())
         WHERE seat_id = ?`,
        [next.status, seatId],
      );
    } else {
      await conn.query(
        `UPDATE seats
         SET status = ?, item_occupied_since = NULL
         WHERE seat_id = ?`,
        [next.status, seatId],
      );
    }

    try {
      await maybeCreatePresencePrompt(conn, {
        seatId,
        seatNumber: String(mapItem?.seatNumber || `#${seatId}`),
        area,
        hasPerson,
      });
      await maybeCreateLeavePromptAndTimeout(conn, {
        seatId,
        seatNumber: String(mapItem?.seatNumber || `#${seatId}`),
        area,
        withTimer: next.withTimer,
      });
    } catch (notifyErr) {
      if (notifyErr?.code === 'ER_NO_SUCH_TABLE') {
        // 提示表未迁移时跳过，避免打断主流程
      } else {
        console.warn('[SIMULATE] 生成提醒失败:', notifyErr.message || notifyErr);
      }
    }

    lastAppliedSeatStateById.set(seatId, next);
    changedSeatIds.push(seatId);
  }

  if (changedSeatIds.length > 0) {
    broadcastSeatUpdate({
      area,
      source: 'simulate',
      reason: 'simulate-state-applied',
      seatIds: changedSeatIds,
    });
  }
};

fs.mkdirSync(UPLOAD_SIMULATE_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_SIMULATE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${Math.floor(Math.random() * 100000)}${ext}`);
  },
});

const uploadImage = multer({
  storage: uploadStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|jpg|webp)$/i.test(file.mimetype || '');
    cb(ok ? null : new Error('仅支持 jpg/png/webp 图片'), ok);
  },
});

// 确保 debug_output 目录存在
const ensureDebugDir = () => {
  if (!fs.existsSync(DEBUG_OUTPUT_DIR)) {
    fs.mkdirSync(DEBUG_OUTPUT_DIR, { recursive: true });
  }
};

/**
 * POST /simulate/start
 * 启动模拟采样进程
 */
router.post('/start', (req, res) => {
  try {
    // 如果已有进程在运行，直接返回
    if (simulateProcess) {
      return res.json({
        success: false,
        error: '模拟采样已在运行中',
      });
    }

    ensureDebugDir();

    if (!fs.existsSync(LIBRARY_SAMPLED_DATA)) {
      return res.status(400).json({
        success: false,
        error: `图片目录不存在: ${LIBRARY_SAMPLED_DATA}`,
      });
    }

    if (!fs.existsSync(SEATS_JSON_PATH)) {
      return res.status(400).json({
        success: false,
        error: `座位配置不存在: ${SEATS_JSON_PATH}`,
      });
    }

    // 构造 Python 命令参数
    const pythonArgs = [
      'simulate_images.py',
      '--image-dir', LIBRARY_SAMPLED_DATA,
      '--seats', SEATS_JSON_PATH,
      '--sample-interval', '1.0',
      '--imgsz', '1280',
      '--conf', '0.4',
      '--occupy-thr', '3',
      '--continuous-output', // 持续输出模式
    ];

    console.log(`[SIMULATE] 启动模拟采样: python ${pythonArgs.join(' ')}`);

    // 启动 Python 进程
    simulateProcess = spawn('python', pythonArgs, {
      cwd: PYTHON_SCRIPT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    simulateStartTime = Date.now();
    simulateData = null;
    lastAppliedSeatStateById = new Map();

    // 接收 stdout 数据（JSON 结果）
    simulateProcess.stdout.on('data', (data) => {
      const lines = String(data || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      lines.forEach((line) => {
        try {
          const result = JSON.parse(line);
          if (result && typeof result === 'object') {
            simulateData = result;
            console.log(`[SIMULATE] 处理帧数: ${result.status?.processedFrames || 0}, 被占座位: ${result.occupiedIndices?.length || 0}`);
            applySimulationToDatabase(result).catch((err) => {
              console.warn('[SIMULATE] 应用检测结果到数据库失败:', err.message || err);
            });
          }
        } catch (parseErr) {
          // 非 JSON 行，可能是日志输出
          if (line && !line.startsWith('[INFO]')) {
            console.log(`[SIMULATE:PYTHON] ${line}`);
          }
        }
      });
    });

    // 接收 stderr 数据（错误日志）
    simulateProcess.stderr.on('data', (data) => {
      console.error(`[SIMULATE:ERROR] ${data.toString()}`);
    });

    // 进程退出
    simulateProcess.on('close', (code) => {
      console.log(`[SIMULATE] 模拟采样进程退出，代码: ${code}`);
      simulateProcess = null;
      simulateData = null;
      simulateStartTime = null;
    });

    res.json({
      success: true,
      message: '模拟采样已启动',
    });
  } catch (error) {
    console.error('[SIMULATE] 启动失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /simulate/detect-seats-from-image
 * 上传图片并调用 generate_seats.py 识别座位框
 */
router.post('/detect-seats-from-image', authenticateAdmin, (req, res) => {
  uploadImage.single('image')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, error: uploadErr.message || '图片上传失败' });
    }

    const imagePath = req.file?.path;
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(400).json({ success: false, error: '未接收到有效图片文件' });
    }

    const confNum = Number(req.body?.conf);
    const conf = Number.isFinite(confNum) ? Math.max(0.05, Math.min(0.9, confNum)) : 0.2;
    const outImage = `results/simulate_detect_${Date.now()}.jpg`;
    const args = [
      'generate_seats.py',
      '--image', imagePath,
      '--conf', String(conf),
      '--out-image', outImage,
    ];

    const child = spawn('python', args, {
      cwd: PYTHON_SCRIPT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (err) => {
      return res.status(500).json({ success: false, error: `启动Python失败: ${err.message}` });
    });

    child.on('close', (code) => {
      const lines = String(stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      let payload = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          payload = JSON.parse(lines[i]);
          break;
        } catch (e) {
          // ignore non-json line
        }
      }

      if (!payload) {
        return res.status(500).json({
          success: false,
          error: '模型未返回有效JSON结果',
          code,
          stderr: String(stderr || '').trim(),
        });
      }

      if (payload.error) {
        return res.status(400).json({ success: false, error: payload.error, code });
      }

      const chairs = Array.isArray(payload.chairs) ? payload.chairs : [];
      const annotatedImage = String(payload.annotatedImage || outImage).replace(/\\/g, '/');
      const annotatedImageUrl = `/python-assets/${annotatedImage}`;
      const uploadedImageUrl = `/uploads/simulate_samples/${path.basename(imagePath)}`;

      return res.json({
        success: true,
        count: chairs.length,
        chairs,
        annotatedImageUrl,
        uploadedImageUrl,
        model: payload.model || '',
      });
    });
  });
});

/**
 * GET /simulate/config
 * 获取当前模拟使用的座位配置
 */
router.get('/config', authenticateAdmin, (req, res) => {
  try {
    const seats = readSeatsConfig();
    res.json({
      success: true,
      seatConfigPath: SEATS_JSON_PATH,
      seatCount: seats.length,
      seats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `读取座位配置失败: ${error.message}`,
    });
  }
});

/**
 * PUT /simulate/config
 * 更新模拟使用的座位配置
 */
router.put('/config', authenticateAdmin, (req, res) => {
  try {
    if (simulateProcess) {
      return res.status(409).json({
        success: false,
        error: '模拟正在运行，停止后再修改座位配置',
      });
    }

    const seats = req.body?.seats;
    const errMsg = validateSeatsArray(seats);
    if (errMsg) {
      return res.status(400).json({ success: false, error: errMsg });
    }

    const normalizedSeats = seats.map((seat) => seat.map((v) => Math.round(Number(v))));
    const payload = `${JSON.stringify(normalizedSeats, null, 2)}\n`;
    const tmpPath = `${SEATS_JSON_PATH}.tmp`;
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, SEATS_JSON_PATH);

    return res.json({
      success: true,
      message: '座位配置已更新',
      seatConfigPath: SEATS_JSON_PATH,
      seatCount: normalizedSeats.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `写入座位配置失败: ${error.message}`,
    });
  }
});

/**
 * POST /simulate/stop
 * 停止模拟采样进程
 */
router.post('/stop', (req, res) => {
  try {
    if (!simulateProcess) {
      return res.json({
        success: false,
        error: '没有正在运行的模拟采样',
      });
    }

    // 终止进程
    console.log('[SIMULATE] 正在停止模拟采样...');
    simulateProcess.kill('SIGTERM');

    // 设置超时，如果5秒后还没有退出，强制杀死
    const killTimeout = setTimeout(() => {
      if (simulateProcess) {
        console.log('[SIMULATE] 强制杀死进程');
        simulateProcess.kill('SIGKILL');
      }
    }, 5000);

    // 监听进程退出事件
    const exitHandler = () => {
      clearTimeout(killTimeout);
      simulateProcess = null;
    };

    if (simulateProcess) {
      simulateProcess.once('exit', exitHandler);
    }

    res.json({
      success: true,
      message: '模拟采样已停止',
    });
  } catch (error) {
    console.error('[SIMULATE] 停止失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /simulate/status
 * 获取当前模拟采样状态和最新数据
 */
router.get('/status', (req, res) => {
  try {
    const isRunning = !!simulateProcess;

    if (!isRunning && !simulateData) {
      return res.json({
        success: false,
        error: '模拟采样未运行',
        isRunning: false,
      });
    }

    // 查找最新生成的调试图片
    let latestDebugImage = null;
    try {
      ensureDebugDir();
      const fixedPreviewName = 'simulate_latest.jpg';
      const fixedPreviewPath = path.join(DEBUG_OUTPUT_DIR, fixedPreviewName);
      if (fs.existsSync(fixedPreviewPath)) {
        latestDebugImage = `/python-assets/debug_output/${fixedPreviewName}`;
      } else {
        const files = fs.readdirSync(DEBUG_OUTPUT_DIR)
          .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
          .sort()
          .reverse();
        if (files.length > 0) {
          latestDebugImage = `/python-assets/debug_output/${files[0]}`;
        }
      }
    } catch (dirErr) {
      console.warn('[SIMULATE] 读取 debug_output 目录失败:', dirErr.message);
    }

    const responseData = {
      success: true,
      isRunning,
      timestamp: Date.now(),
      uptime: simulateStartTime ? Date.now() - simulateStartTime : 0,
      debugImageUrl: latestDebugImage,
      seatConfigPath: SEATS_JSON_PATH,
    };

    // 如果有最新的模拟数据，合并到响应
    if (simulateData) {
      responseData.occupiedIndices = simulateData.occupiedIndices || [];
      responseData.seatStates = simulateData.seatStates || [];
      responseData.violationTimes = simulateData.violationTimes || {};
      responseData.status = simulateData.status || {};
      responseData.seatCount = Array.isArray(simulateData.seatStates)
        ? simulateData.seatStates.length
        : 0;

      // 为前端计算汇总数据
      responseData.lastDetection = {
        processedFrames: simulateData.status?.processedFrames || 0,
        totalImages: simulateData.status?.totalImages || 0,
        elapsedTime: simulateData.status?.elapsedTimeSeconds || 0,
        occupiedCount: (simulateData.occupiedIndices || []).length,
        violationCount: Object.keys(simulateData.violationTimes || {}).length,
      };
    }

    res.json(responseData);
  } catch (error) {
    console.error('[SIMULATE] 获取状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      isRunning: !!simulateProcess,
    });
  }
});

/**
 * GET /simulate/data
 * 获取原始的完整模拟数据（用于调试）
 */
router.get('/data', (req, res) => {
  try {
    if (!simulateData) {
      return res.json({
        success: false,
        error: '暂无模拟数据',
      });
    }

    res.json({
      success: true,
      data: simulateData,
    });
  } catch (error) {
    console.error('[SIMULATE] 获取数据失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /simulate/isRunning
 * 简单检查是否在运行（轻量级接口）
 */
router.get('/isRunning', (req, res) => {
  res.json({
    isRunning: !!simulateProcess,
  });
});

module.exports = router;

