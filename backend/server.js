const express = require("express");
const cors = require("cors");
const { PythonShell } = require("python-shell");
const { spawn } = require("child_process");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { broadcastSeatUpdate } = require("./utils/seatEvents");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

function parseJsonLines(lines) {
  return (lines || [])
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

// 中间件
app.use(cors());
app.use(express.json());

// 兼容请求URL误带尾部空格（例如 /api/model/occupation-detect%20）
app.use((req, res, next) => {
  const normalizedUrl = String(req.url || "")
    .replace(/(?:%20)+$/gi, "")
    .replace(/\s+$/g, "");

  if (normalizedUrl !== req.url) {
    return res.redirect(307, normalizedUrl);
  }

  return next();
});

app.use("/python-assets", express.static(path.join(__dirname, "python_scripts")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 路由
const authRoutes = require("./routes/auth");
const seatsRoutes = require("./routes/seats");
const reserveRoutes = require("./routes/reserve");
const reportRoutes = require("./routes/reports");
const simulateRoutes = require("./routes/simulate");

app.use("/api/auth", authRoutes);
app.use("/api/seats", seatsRoutes);
app.use("/api/reservations", reserveRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/simulate", simulateRoutes);

const PY_SCRIPT_DIR = path.join(__dirname, "python_scripts");
const SEAT_META_PATH = path.join(PY_SCRIPT_DIR, "seats_meta.json");
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODEL_DIR = path.join(__dirname, "modules");
const UPLOAD_ROOT = path.join(__dirname, "uploads");
const UPLOAD_VIDEO_DIR = path.join(UPLOAD_ROOT, "videos");
const DEFAULT_TEST_VIDEO = process.env.DEFAULT_TEST_VIDEO || path.join(PROJECT_ROOT, "v1.mp4");
const SEAT_DETECT_MODEL = process.env.SEAT_DETECT_MODEL || path.join(MODEL_DIR, "seat_best.pt");
const PERSON_DETECT_MODEL = process.env.PERSON_DETECT_MODEL || path.join(MODEL_DIR, "best.pt");
const ITEM_DETECT_MODEL = process.env.ITEM_DETECT_MODEL || path.join(MODEL_DIR, "yolov8n.pt");
const SEAT_DETECT_CONF = Number(process.env.SEAT_DETECT_CONF || 0.35);
const PYTHON_PATH = process.env.PYTHON_PATH || "";
const PYTHON_EXECUTABLE = PYTHON_PATH || process.env.PYTHON || "python";
const ENABLE_OCCUPATION_CRON = String(process.env.ENABLE_OCCUPATION_CRON || "false").toLowerCase() === "true";
const OCCUPATION_CRON_EXPR = process.env.OCCUPATION_CRON_EXPR || "*/20 * * * * *";
const OCCUPATION_CRON_MAX_FRAMES = Number.isFinite(Number(process.env.OCCUPATION_CRON_MAX_FRAMES))
  ? Math.max(30, Math.min(12000, Math.floor(Number(process.env.OCCUPATION_CRON_MAX_FRAMES))))
  : 80;
const OCCUPATION_CRON_DETECT_INTERVAL = Number.isFinite(Number(process.env.OCCUPATION_CRON_DETECT_INTERVAL))
  ? Math.max(1, Math.min(30, Math.floor(Number(process.env.OCCUPATION_CRON_DETECT_INTERVAL))))
  : 10;
const OCCUPATION_OCCUPY_THRESHOLD = Number.isFinite(Number(process.env.OCCUPATION_OCCUPY_THRESHOLD))
  ? Math.max(1, Math.min(10, Math.floor(Number(process.env.OCCUPATION_OCCUPY_THRESHOLD))))
  : 1;
const LEAVE_ITEM_TIMEOUT_MINUTES = Number(process.env.LEAVE_ITEM_TIMEOUT_MINUTES || 15);
let detectionRunning = false;
let detectionStartedAt = 0;
let lastDetectionAt = 0;
const detectionCursorByArea = new Map();
const lastOccupiedByArea = new Map();
const seatGenerationTasks = new Map();
let latestOccupationResult = null;
let presencePromptFeatureAvailable = true;
let leavePromptFeatureAvailable = true;
let seatItemOccupancyColumnReady = false;

fs.mkdirSync(UPLOAD_VIDEO_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_VIDEO_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
    const baseName = path
      .basename(file.originalname || "video", ext)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "_")
      .slice(0, 60) || "video";
    cb(null, `${Date.now()}-${Math.floor(Math.random() * 100000)}-${baseName}${ext}`);
  },
});

const uploadVideo = multer({
  storage: uploadStorage,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_VIDEO_SIZE || 500 * 1024 * 1024),
  },
  fileFilter: (_, file, cb) => {
    const allowedMime = typeof file.mimetype === "string" && file.mimetype.startsWith("video/");
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);
    if (allowedMime || allowedExt.has(ext)) return cb(null, true);
    return cb(new Error("只允许上传视频文件"));
  },
});

app.post("/api/upload-video", uploadVideo.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "请选择要上传的视频文件" });
  }

  const videoPath = req.file.path;
  const videoUrl = `/uploads/videos/${req.file.filename}`;

  return res.json({
    message: "视频上传成功",
    videoPath,
    videoUrl,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
});

app.use((err, req, res, next) => {
  if (req.path === "/api/upload-video") {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "视频文件太大，请缩小后再上传" });
    }
    if (err?.message) {
      return res.status(400).json({ error: err.message });
    }
  }
  return next(err);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDetectionIdle(timeoutMs = 0) {
  const startedAt = Date.now();

  while (detectionRunning) {
    const runningFor = Date.now() - detectionStartedAt;
    if (runningFor > 10 * 60 * 1000) {
      console.warn("检测锁已超时，自动释放占座检测锁");
      detectionRunning = false;
      detectionStartedAt = 0;
      return true;
    }

    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      return false;
    }

    await sleep(500);
  }

  return true;
}

async function resolveSeatBaselineStatus(conn, seatId) {
  const [activeRows] = await conn.query(
    "SELECT 1 FROM reservations WHERE seat_id = ? AND res_status = 'active' LIMIT 1",
    [seatId],
  );
  if (activeRows.length > 0) return 2;

  const [pendingRows] = await conn.query(
    "SELECT 1 FROM reservations WHERE seat_id = ? AND res_status = 'pending' LIMIT 1",
    [seatId],
  );
  if (pendingRows.length > 0) return 1;

  return 0;
}

async function ensurePresencePromptTable() {
  try {
    const db = require("./config/db");
    const conn = await db;
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reservation_presence_prompts (
        prompt_id INT AUTO_INCREMENT PRIMARY KEY,
        reservation_id INT NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        seat_id INT NOT NULL,
        prompt_status ENUM('pending', 'confirmed', 'rejected', 'expired') DEFAULT 'pending',
        detected_at DATETIME NOT NULL,
        responded_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_presence_user_status (user_id, prompt_status, created_at),
        INDEX idx_presence_reservation (reservation_id, prompt_status),
        FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (seat_id) REFERENCES seats(seat_id) ON DELETE CASCADE
      )
    `);
    console.log("reservation_presence_prompts table ready");
  } catch (err) {
    console.warn("Unable to ensure reservation_presence_prompts table:", err.message || err);
  }
}

async function ensureLeavePromptTable() {
  try {
    const db = require("./config/db");
    const conn = await db;
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reservation_leave_prompts (
        prompt_id INT AUTO_INCREMENT PRIMARY KEY,
        reservation_id INT NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        seat_id INT NOT NULL,
        prompt_status ENUM('pending', 'released', 'retained', 'expired') DEFAULT 'pending',
        detected_at DATETIME NOT NULL,
        responded_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_leave_user_status (user_id, prompt_status, created_at),
        INDEX idx_leave_reservation (reservation_id, prompt_status),
        FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (seat_id) REFERENCES seats(seat_id) ON DELETE CASCADE
      )
    `);
    console.log("reservation_leave_prompts table ready");
  } catch (err) {
    console.warn("Unable to ensure reservation_leave_prompts table:", err.message || err);
  }
}

async function ensureNotificationHistoryTable() {
  try {
    const db = require("./config/db");
    const conn = await db;
    await conn.query(`
      CREATE TABLE IF NOT EXISTS notification_history (
        notification_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(20) NOT NULL,
        event_type ENUM('info', 'success', 'warning', 'danger', 'question') NOT NULL DEFAULT 'info',
        title VARCHAR(120) NOT NULL,
        message TEXT NOT NULL,
        source VARCHAR(60) NOT NULL,
        source_key VARCHAR(120) NOT NULL,
        payload_json TEXT DEFAULT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_notification_source (user_id, source, source_key),
        INDEX idx_notification_user_updated (user_id, updated_at),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    console.log("notification_history table ready");
  } catch (err) {
    console.warn("Unable to ensure notification_history table:", err.message || err);
  }
}

async function ensureSeatItemOccupancyColumn() {
  if (seatItemOccupancyColumnReady) return;

  try {
    const db = require("./config/db");
    const conn = await db;
    const [rows] = await conn.query("SHOW COLUMNS FROM seats LIKE 'item_occupied_since'");

    if (!Array.isArray(rows) || rows.length === 0) {
      await conn.query(
        "ALTER TABLE seats ADD COLUMN item_occupied_since DATETIME DEFAULT NULL AFTER status",
      );
    }

    seatItemOccupancyColumnReady = true;
    console.log("seats.item_occupied_since column ready");
  } catch (err) {
    console.warn("Unable to ensure seats.item_occupied_since column:", err.message || err);
  }
}

function loadSeatMeta() {
  try {
    if (!fs.existsSync(SEAT_META_PATH)) return null;
    const raw = fs.readFileSync(SEAT_META_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function saveSeatMeta(meta) {
  try {
    fs.writeFileSync(SEAT_META_PATH, JSON.stringify(meta, null, 2), "utf-8");
  } catch (e) {
    console.warn("写入 seats_meta.json 失败:", e.message);
  }
}

function createTaskId() {
  return `seatgen-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function cleanupOldSeatTasks() {
  const now = Date.now();
  for (const [taskId, task] of seatGenerationTasks.entries()) {
    if (now - task.createdAt > 30 * 60 * 1000) {
      seatGenerationTasks.delete(taskId);
    }
  }
}

function buildGenerateSeatsOptions(videoPath, frame, outImage) {
  return {
    mode: "text",
    scriptPath: PY_SCRIPT_DIR,
    ...(PYTHON_PATH ? { pythonPath: PYTHON_PATH } : {}),
    args: [
      "--video",
      videoPath,
      "--frame",
      String(frame),
      "--model",
      SEAT_DETECT_MODEL,
      "--out-image",
      outImage,
    ],
  };
}

function runPythonScriptWithTimeout(scriptName, args = [], timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PY_SCRIPT_DIR, scriptName);
    const child = spawn(PYTHON_EXECUTABLE, [scriptPath, ...args], {
      cwd: PY_SCRIPT_DIR,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject({ error: `Python脚本执行超时(${Math.floor(timeoutMs / 1000)}s)` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject({ error: `启动Python失败: ${err.message}` });
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function runGenerateSeats(videoPath, frame, outImage = "results/annotated_seats.jpg") {
  return new Promise((resolve, reject) => {
    const args = [
      "--video",
      videoPath,
      "--frame",
      String(frame),
      "--model",
      SEAT_DETECT_MODEL,
      "--conf",
      String(SEAT_DETECT_CONF),
      "--out-image",
      outImage,
    ];

    runPythonScriptWithTimeout("generate_seats.py", args, 120000)
      .then(({ code, stdout, stderr }) => {
        const lines = String(stdout || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const parsed = parseJsonLines(lines);
        const result =
          parsed.find((item) => item && Array.isArray(item.chairs)) || parsed[0];

        if (result && result.error) {
          return reject({ error: result.error, rawOutput: lines });
        }

        if (!result) {
          return reject({
            error: "生成座位无有效JSON返回，请检查Python环境/模型路径",
            rawOutput: lines,
            stderr: String(stderr || "").trim(),
            exitCode: code,
          });
        }

        const imagePath = (result.annotatedImage || outImage).replace(/\\/g, "/");
        const imageUrl = `/python-assets/${imagePath}`;

        return resolve({
          ...result,
          videoPath,
          imageUrl,
        });
      })
      .catch((e) => reject(e));
  });
}

function apiSuccess(res, data, message = "ok", status = 200) {
  return res.status(status).json({
    code: 0,
    message,
    data,
  });
}

function apiFailure(res, error, status = 500) {
  const normalized = typeof error === "string" ? { error } : (error || {});
  return res.status(status).json({
    code: status,
    message: normalized.error || normalized.message || "请求失败",
    error: normalized,
  });
}

// 模型服务健康检查（用于部署验证 / Postman 冒烟测试）
app.get("/api/model/health", (req, res) => {
  const modelPaths = {
    seat: SEAT_DETECT_MODEL,
    person: PERSON_DETECT_MODEL,
    item: ITEM_DETECT_MODEL,
  };

  const checks = Object.fromEntries(
    Object.entries(modelPaths).map(([name, p]) => [name, {
      path: String(p || "").replace(/\\/g, "/"),
      exists: fs.existsSync(p),
    }]),
  );

  return apiSuccess(res, {
    service: "library-model-api",
    pythonExecutable: PYTHON_EXECUTABLE,
    models: checks,
  }, "model api healthy");
});

app.get("/api/detection/status", (req, res) => {
  res.json({
    detectionRunning,
    lastDetectionAt,
  });
});

// 标准化模型推理接口：座位识别
app.post("/api/model/seat-detect", async (req, res) => {
  const videoPath = req.body?.videoPath || DEFAULT_TEST_VIDEO;
  const frame = Number.isFinite(Number(req.body?.frame)) ? Number(req.body.frame) : 0;

  try {
    const result = await runGenerateSeats(videoPath, frame);
    return apiSuccess(res, result, "seat detection succeeded");
  } catch (e) {
    console.error("模型接口座位识别失败:", e);
    return apiFailure(res, e, 500);
  }
});

// 标准化模型推理接口：占座识别
app.post("/api/model/occupation-detect", async (req, res) => {
  const videoPath = req.body?.videoPath || DEFAULT_TEST_VIDEO;
  const area = req.body?.area || "A区";
  const maxFrames = Number(req.body?.maxFrames) || 300;

  try {
    const saveVideoRaw = req.body?.saveVideo;
    const saveVideo = saveVideoRaw === true
      || saveVideoRaw === 1
      || String(saveVideoRaw || "").trim().toLowerCase() === "true";
    const result = await runSeatDetection({ videoPath, area, maxFrames, saveVideo });
    return apiSuccess(res, result, "occupation detection succeeded");
  } catch (e) {
    console.error("模型接口占座识别失败:", e);
    return apiFailure(res, e, 500);
  }
});

// 生成座位预览（管理员审核）
app.post("/api/generate-seats", async (req, res) => {
  const videoPath = req.body?.videoPath || DEFAULT_TEST_VIDEO;
  const frame = Number.isFinite(Number(req.body?.frame))
    ? Number(req.body.frame)
    : 0;

  try {
    const result = await runGenerateSeats(videoPath, frame);
    res.json(result);
  } catch (e) {
    console.error("生成座位错误:", e);
    res.status(500).json(e);
  }
});

// 异步任务版：创建座位识别任务
app.post("/api/generate-seats/tasks", async (req, res) => {
  const videoPath = req.body?.videoPath || DEFAULT_TEST_VIDEO;
  const frame = Number.isFinite(Number(req.body?.frame))
    ? Number(req.body.frame)
    : 0;

  cleanupOldSeatTasks();
  const taskId = createTaskId();
  seatGenerationTasks.set(taskId, {
    taskId,
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    params: { videoPath, frame },
    result: null,
    error: null,
  });

  res.status(202).json({ taskId, status: "queued" });

  setImmediate(async () => {
    const task = seatGenerationTasks.get(taskId);
    if (!task) return;

    task.status = "running";
    task.updatedAt = Date.now();

    try {
      const result = await runGenerateSeats(videoPath, frame);
      task.status = "succeeded";
      task.result = result;
      task.updatedAt = Date.now();
    } catch (e) {
      task.status = "failed";
      task.error = e;
      task.updatedAt = Date.now();
      console.error("异步生成座位失败:", e);
    }
  });
});

// 异步任务版：查询座位识别任务状态
app.get("/api/generate-seats/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = seatGenerationTasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: "任务不存在或已过期" });
  }

  res.json({
    taskId,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    result: task.result,
    error: task.error,
  });
});

// 管理员确认(可修改后)座位并入库
app.post("/api/confirm-seats", async (req, res) => {
  const area = req.body?.area || "A区";
  const prefix = req.body?.prefix || "A";
  const seats = Array.isArray(req.body?.seats) ? req.body.seats : [];
  const confirmedVideoPath = String(req.body?.videoPath || "").trim();
  const confirmedFrame = Number.isFinite(Number(req.body?.frame)) ? Number(req.body.frame) : 0;
  const previewImageUrl = typeof req.body?.previewImageUrl === "string"
    ? req.body.previewImageUrl.trim()
    : "";
  const sourceVideo = req.body?.sourceVideo && typeof req.body.sourceVideo === "object"
    ? req.body.sourceVideo
    : null;

  const normalizedSeats = seats
    .filter((s) => Array.isArray(s) && s.length === 4)
    .map((s) => s.map((v) => Number(v)))
    .filter((s) => s.every((v) => Number.isFinite(v)));

  if (normalizedSeats.length === 0) {
    return res.status(400).json({ error: "请先生成并确认至少一个座位框" });
  }

  try {
    const db = require("./config/db");
    const conn = await db;

    // 更新 Python 检测使用的 seats.json
    const seatsJsonPath = path.join(PY_SCRIPT_DIR, "seats.json");
    fs.writeFileSync(
      seatsJsonPath,
      JSON.stringify(normalizedSeats, null, 2),
      "utf-8",
    );

    saveSeatMeta({
      videoPath: confirmedVideoPath || DEFAULT_TEST_VIDEO,
      frame: confirmedFrame,
      area,
      prefix,
      seats: normalizedSeats,
      previewImageUrl: previewImageUrl || "/python-assets/results/annotated_seats.jpg",
      sourceVideo,
      seatsCount: normalizedSeats.length,
      savedAt: Date.now(),
    });

    // 同步数据库座位表：按 seat_number 更新/新增，避免删除导致 reservations 级联丢失
    const generatedSeatNumbers = normalizedSeats.map((_, idx) => `${prefix}${idx + 1}`);
    const seatMappings = [];

    for (let idx = 0; idx < generatedSeatNumbers.length; idx += 1) {
      const seatNumber = generatedSeatNumbers[idx];
      const bbox = normalizedSeats[idx];
      const [existRows] = await conn.query(
        "SELECT seat_id FROM seats WHERE seat_number = ? LIMIT 1",
        [seatNumber],
      );

      if (existRows.length > 0) {
        const seatId = Number(existRows[0].seat_id);
        // 保留原 seat_id 和历史预约，刷新区域并按预约状态重置座位状态
        const baselineStatus = await resolveSeatBaselineStatus(conn, seatId);
        await conn.query(
          "UPDATE seats SET area = ?, status = ? WHERE seat_number = ?",
          [area, baselineStatus, seatNumber],
        );
        seatMappings.push({ seatId, seatNumber, area, bbox });
      } else {
        const [insertResult] = await conn.query(
          "INSERT INTO seats (seat_number, area, status) VALUES (?, ?, 0)",
          [seatNumber, area],
        );
        const seatId = Number(insertResult?.insertId);
        if (Number.isInteger(seatId) && seatId > 0) {
          seatMappings.push({ seatId, seatNumber, area, bbox });
        }
      }
    }

    // 仅清理当前区域内未出现在本次识别结果、且没有任何预约记录的旧座位
    if (generatedSeatNumbers.length > 0) {
      const placeholders = generatedSeatNumbers.map(() => "?").join(",");
      await conn.query(
        `DELETE FROM seats
         WHERE area = ?
           AND seat_number NOT IN (${placeholders})
           AND seat_id NOT IN (SELECT DISTINCT seat_id FROM reservations)`,
        [area, ...generatedSeatNumbers],
      );
    }

    saveSeatMeta({
      videoPath: confirmedVideoPath || DEFAULT_TEST_VIDEO,
      frame: confirmedFrame,
      area,
      prefix,
      seats: normalizedSeats,
      previewImageUrl: previewImageUrl || "/python-assets/results/annotated_seats.jpg",
      sourceVideo,
      seatsCount: normalizedSeats.length,
      seatMappings,
      savedAt: Date.now(),
    });

    // 重新标定后，清除该区域上一次检测缓存，避免前端误显示旧异常结果
    if (latestOccupationResult?.area === area) {
      latestOccupationResult = null;
    }

    res.json({
      message: `成功创建${normalizedSeats.length}个${area}座位`,
      count: normalizedSeats.length,
      seatsJsonPath,
      seatsMetaPath: SEAT_META_PATH,
    });
  } catch (err) {
    console.error("确认座位失败:", err);
    res.status(500).json({ error: err.message });
  }
});

// 生成监控检测视频（前端可直接播放）
app.post("/api/monitor-video", async (req, res) => {
  try {
    const requestedVideoPath = req.body?.videoPath || DEFAULT_TEST_VIDEO;
    const requestedMaxFramesRaw = Number(req.body?.maxFrames);
    const requestedDetectIntervalRaw = Number(req.body?.detectInterval);
    const requestedMaxFrames =
      Number.isFinite(requestedMaxFramesRaw) && requestedMaxFramesRaw > 0
        ? Math.floor(Math.min(requestedMaxFramesRaw, 12000))
        : 0;
    const requestedDetectInterval =
      Number.isFinite(requestedDetectIntervalRaw) && requestedDetectIntervalRaw > 0
        ? Math.floor(Math.min(Math.max(requestedDetectIntervalRaw, 1), 30))
        : (requestedMaxFrames === 0 ? 8 : 4);
    const seatMeta = loadSeatMeta();
    const videoPath = seatMeta?.videoPath || requestedVideoPath;
    const useCalibratedVideo = Boolean(seatMeta?.videoPath && seatMeta.videoPath !== requestedVideoPath);
    const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const out = `results/live_sync_${runId}.mp4`;
    const outputFps = Number(seatMeta?.sourceVideo?.fps) || 0;

    const pyArgs = [
      "--video",
      videoPath,
      "--seats",
      "seats.json",
      "--use-raw-seats",
      "--realtime-detect",
      "--detect-interval",
      String(requestedDetectInterval),
      "--max-frames",
      String(requestedMaxFrames),
    ];
    if (outputFps > 1) {
      pyArgs.push("--output-fps", String(outputFps));
    }
    pyArgs.push("--out", out);

    const { stdout, stderr, code } = await runPythonScriptWithTimeout(
      "stream_video.py",
      pyArgs,
      requestedMaxFrames === 0 ? 600000 : 300000,
    );

    const lines = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = parseJsonLines(lines);
    const last = parsed[parsed.length - 1] || {};

    if (last.error) {
      return res.status(400).json({ error: last.error });
    }

    if (!last || !last.video) {
      return res.status(500).json({
        error: `监控视频生成无有效输出（exit=${code}）${stderr ? `，stderr=${String(stderr).trim()}` : ""}`,
      });
    }

    const outVideoPath = String(last?.video?.out || out).replace(/\\/g, "/");
    const outVideoName = outVideoPath.split("/").pop() || `live_sync_${runId}.mp4`;

    res.json({
      message: "监控视频生成完成",
      videoUrl: `/python-assets/results/${outVideoName}?t=${Date.now()}`,
      videoPath,
      note: useCalibratedVideo
        ? `请求视频(${requestedVideoPath})与座位标定视频不一致，已自动使用标定视频(${videoPath})避免座位框漂移`
        : undefined,
      raw: parsed,
    });
  } catch (err) {
    console.error("生成监控视频失败:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// 新路由：手动触发占座检测（测试用）
app.post("/api/detect-occupation", async (req, res) => {
  try {
    const videoPath = req.body?.videoPath || DEFAULT_TEST_VIDEO;
    const area = req.body?.area || "A区";
    const saveVideoRaw = req.body?.saveVideo;
    const saveVideo = saveVideoRaw === true
      || saveVideoRaw === 1
      || String(saveVideoRaw || "").trim().toLowerCase() === "true";
    const requestedMaxFramesRaw = Number(req.body?.maxFrames);
    const requestedDetectIntervalRaw = Number(req.body?.detectInterval);
    const requestedMaxFrames =
      Number.isFinite(requestedMaxFramesRaw) && requestedMaxFramesRaw > 0
        ? Math.floor(Math.min(requestedMaxFramesRaw, 12000))
        : 0;
    const requestedDetectInterval =
      Number.isFinite(requestedDetectIntervalRaw) && requestedDetectIntervalRaw > 0
        ? Math.floor(Math.min(Math.max(requestedDetectIntervalRaw, 1), 30))
        : (requestedMaxFrames === 0 ? 8 : 4);
    const requestedTimeoutRaw = Number(req.body?.timeoutMs);
    const requestedTimeoutMs = Number.isFinite(requestedTimeoutRaw) && requestedTimeoutRaw > 0
      ? Math.floor(requestedTimeoutRaw)
      : 0;

    // 给长视频留更充足的执行时间，避免前后端超时不一致导致中途失败。
    const estimatedByFrames = requestedMaxFrames > 0
      ? 240000 + Math.floor((requestedMaxFrames / Math.max(requestedDetectInterval, 1)) * 900)
      : 900000;
    const effectiveTimeoutMs = Math.max(
      300000,
      Math.min(
        20 * 60 * 1000,
        requestedTimeoutMs > 0 ? requestedTimeoutMs : estimatedByFrames,
      ),
    );

    req.setTimeout(effectiveTimeoutMs + 30000);
    res.setTimeout(effectiveTimeoutMs + 30000);

    const result = await runSeatDetection({
      videoPath,
      area,
      maxFrames: requestedMaxFrames,
      detectInterval: requestedDetectInterval,
      timeoutMs: effectiveTimeoutMs,
      saveVideo,
    });
    res.json({
      message: "占座检测完成",
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// 获取最近一次占座检测结果（供举报中心展示）
app.get("/api/detect-occupation/latest", (req, res) => {
  if (!latestOccupationResult) {
    return res.status(404).json({ error: "暂无占座检测结果" });
  }
  res.json(latestOccupationResult);
});

// 定时任务：默认开启，按有预约的区域执行检测，支持离座提醒自动触发
async function getDetectionAreasByReservationActivity() {
  try {
    const db = require("./config/db");
    const conn = await db;
    const [rows] = await conn.query(
      `SELECT DISTINCT s.area
       FROM reservations r
       JOIN seats s ON s.seat_id = r.seat_id
       WHERE r.res_status IN ('pending', 'active')
         AND s.area IS NOT NULL
         AND s.area <> ''
       ORDER BY s.area ASC`,
    );

    const areas = (rows || [])
      .map((row) => String(row.area || "").trim())
      .filter(Boolean);

    return areas.length > 0 ? areas : ["A区"];
  } catch (err) {
    console.warn("获取需检测区域失败，回退为 A区:", err.message || err);
    return ["A区"];
  }
}

if (ENABLE_OCCUPATION_CRON) {
  cron.schedule(OCCUPATION_CRON_EXPR, async () => {
    if (detectionRunning) {
      console.log("Occupation cron skipped: detection already running");
      return;
    }

    const areas = await getDetectionAreasByReservationActivity();

    for (const area of areas) {
      try {
        const startFrame = Number(detectionCursorByArea.get(area)) || 0;
        await runSeatDetection({
          videoPath: DEFAULT_TEST_VIDEO,
          area,
          maxFrames: OCCUPATION_CRON_MAX_FRAMES,
          detectInterval: OCCUPATION_CRON_DETECT_INTERVAL,
          saveVideo: false,
          startFrame,
          advanceCursor: true,
        });
      } catch (e) {
        console.error(`定时占座检测失败(area=${area}):`, e);
      }
    }
  });
  console.log(
    `Occupation cron enabled: ${OCCUPATION_CRON_EXPR} for active/pending reservation areas `
    + `(maxFrames=${OCCUPATION_CRON_MAX_FRAMES}, detectInterval=${OCCUPATION_CRON_DETECT_INTERVAL})`,
  );
} else {
  console.log("Occupation cron disabled (set ENABLE_OCCUPATION_CRON=true to enable)");
}

async function runSeatDetection({
  videoPath,
  area = "A区",
  maxFrames = 0,
  detectInterval = 8,
  timeoutMs = 180000,
  saveVideo = false,
  startFrame = 0,
  advanceCursor = false,
}) {
  if (detectionRunning) {
    const waited = await waitForDetectionIdle(5 * 60 * 1000);
    if (!waited) {
      throw new Error("占座检测仍在运行，请稍后重试");
    }
  }

  detectionRunning = true;
  detectionStartedAt = Date.now();

  const seatMeta = loadSeatMeta();
  const requestedVideoPath = videoPath;
  const calibratedVideoPath = typeof seatMeta?.videoPath === "string"
    ? seatMeta.videoPath.trim()
    : "";
  const calibratedVideoExists = Boolean(calibratedVideoPath) && fs.existsSync(calibratedVideoPath);
  const effectiveVideoPath = calibratedVideoExists ? calibratedVideoPath : videoPath;
  const usedCalibratedVideo = Boolean(calibratedVideoExists && calibratedVideoPath !== requestedVideoPath);
  const missingCalibratedVideoNote = calibratedVideoPath && !calibratedVideoExists
    ? `座位标定视频(${calibratedVideoPath})不存在，已回退为请求视频(${requestedVideoPath})`
    : "";
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const outputFps = Number(seatMeta?.sourceVideo?.fps) || 0;
  const startFrameNormalized = Number.isFinite(Number(startFrame)) && Number(startFrame) > 0
    ? Math.floor(Number(startFrame))
    : 0;
  const args = [
    "--video",
    effectiveVideoPath,
    "--seats",
    "seats.json",
    "--use-raw-seats",
    "--realtime-detect",
    "--detect-interval",
    String(
      Number.isFinite(Number(detectInterval)) && Number(detectInterval) > 0
        ? Math.floor(Math.min(Math.max(Number(detectInterval), 1), 30))
        : (Number(maxFrames) > 0 ? 4 : 8),
    ),
    "--max-frames",
    String(
      Number.isFinite(Number(maxFrames)) && Number(maxFrames) > 0
        ? Math.floor(Math.min(Number(maxFrames), 12000))
        : 0,
    ),
    "--start-frame",
    String(startFrameNormalized),
    "--occupy-thr",
    String(OCCUPATION_OCCUPY_THRESHOLD),
  ];
  if (outputFps > 1) {
    args.push("--output-fps", String(outputFps));
  }
  let out = "";
  if (saveVideo) {
    out = `results/occupation_${runId}.mp4`;
    args.push("--out", out);
  }

  try {
    const { stdout, stderr, code } = await runPythonScriptWithTimeout(
      "stream_video.py",
      args,
      Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
        ? Number(timeoutMs)
        : 180000,
    );

    const lines = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = parseJsonLines(lines);
    const result = parsed[parsed.length - 1] || {};

    if (result && result.error) {
      throw new Error(result.error);
    }

    if (!result || (!Array.isArray(result.occupiedIndices) && !Array.isArray(result.occupied))) {
      throw new Error(
        `占座检测无有效输出（exit=${code}）${stderr ? `，stderr=${String(stderr).trim()}` : ""}`,
      );
    }

    const seatStates = Array.isArray(result?.seatStates) ? result.seatStates : [];
    const seatStateByIndex = new Map(
      seatStates.map((state) => [Number(state?.index), state]),
    );

    const occupiedIndexes = Array.isArray(result?.occupiedIndices)
      ? result.occupiedIndices
      : Array.isArray(result?.occupied)
        ? result.occupied.map((x) => Number(x) - 1).filter((x) => Number.isInteger(x) && x >= 0)
        : [];

    const db = require("./config/db");
    const conn = await db;

    const [areaSeats] = await conn.query(
      "SELECT seat_id, seat_number FROM seats WHERE area = ? ORDER BY CAST(REGEXP_REPLACE(seat_number, '[^0-9]', '') AS UNSIGNED) ASC, seat_number ASC",
      [area],
    );

    if (!Array.isArray(areaSeats) || areaSeats.length === 0) {
      throw new Error(`区域 ${area} 没有可检测座位，请先在举报中心完成座位识别并确认生成`);
    }

    for (const [index, seatRow] of areaSeats.entries()) {
      const seatId = Number(seatRow.seat_id);
      if (!Number.isInteger(seatId)) {
        continue;
      }

      const state = seatStateByIndex.get(index) || null;
      const hasPerson = Boolean(state?.hasPerson);
      const hasItem = Boolean(state?.hasItem);

      if (!(hasItem && !hasPerson)) {
        await conn.query(
          "UPDATE seats SET item_occupied_since = NULL WHERE seat_id = ?",
          [seatId],
        );
      }
    }

    const occupiedSeatIds = occupiedIndexes
      .map((idx) => areaSeats[idx]?.seat_id)
      .filter((id) => Number.isInteger(id));

    const prevOccupied = lastOccupiedByArea.get(area) || [];
    const prevKey = JSON.stringify([...prevOccupied].sort((a, b) => a - b));
    const currKey = JSON.stringify([...occupiedSeatIds].sort((a, b) => a - b));
    const detectionChanged = prevKey !== currKey;
    lastOccupiedByArea.set(area, [...occupiedSeatIds]);

    await conn.query(
      "UPDATE seats SET status = CASE WHEN status IN (1, 2) THEN status ELSE 0 END WHERE area = ?",
      [area],
    );

    for (const seatId of occupiedSeatIds) {
      const seatIndex = occupiedIndexes.find((idx) => areaSeats[idx]?.seat_id === seatId);
      const seatState = Number.isInteger(seatIndex) ? seatStateByIndex.get(seatIndex) || null : null;
      const seatRow = areaSeats[seatIndex] || null;
      const hasPerson = Boolean(seatState?.hasPerson);
      const hasItem = Boolean(seatState?.hasItem);

      const [activeReservations] = await conn.query(
        "SELECT reservation_id, user_id FROM reservations WHERE seat_id = ? AND res_status = 'active' ORDER BY created_at DESC LIMIT 1",
        [seatId],
      );

      if (activeReservations.length > 0) {
        // 座位被占用且有活跃预约 -> 已占用
        await conn.query("UPDATE seats SET status = 2 WHERE seat_id = ?", [seatId]);

        if (hasPerson) {
          await conn.query("UPDATE seats SET item_occupied_since = NULL WHERE seat_id = ?", [seatId]);
          continue;
        }

        if (hasItem && seatRow) {
          const [seatRows] = await conn.query(
            "SELECT item_occupied_since FROM seats WHERE seat_id = ? LIMIT 1",
            [seatId],
          );
          const itemOccupiedSince = seatRows[0]?.item_occupied_since || null;

          if (!itemOccupiedSince) {
            await conn.query(
              "UPDATE seats SET item_occupied_since = COALESCE(item_occupied_since, NOW()) WHERE seat_id = ?",
              [seatId],
            );
          }

          if (leavePromptFeatureAvailable) {
            try {
              const [existingPrompts] = await conn.query(
                `SELECT prompt_id
                 FROM reservation_leave_prompts
                 WHERE reservation_id = ?
                   AND prompt_status = 'pending'
                   AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
                 LIMIT 1`,
                [activeReservations[0].reservation_id],
              );

              if (existingPrompts.length === 0) {
                const [promptInsert] = await conn.query(
                  `INSERT INTO reservation_leave_prompts
                     (reservation_id, user_id, seat_id, prompt_status, detected_at)
                   VALUES (?, ?, ?, 'pending', NOW())`,
                  [activeReservations[0].reservation_id, activeReservations[0].user_id, seatId],
                );

                await conn.query(
                  `INSERT INTO notification_history
                     (user_id, event_type, title, message, source, source_key, payload_json, is_read)
                   VALUES (?, 'question', ?, ?, 'leave-presence', ?, ?, 0)
                   ON DUPLICATE KEY UPDATE
                     event_type = VALUES(event_type),
                     title = VALUES(title),
                     message = VALUES(message),
                     payload_json = VALUES(payload_json),
                     is_read = notification_history.is_read,
                     updated_at = CURRENT_TIMESTAMP`,
                  [
                    activeReservations[0].user_id,
                    "检测到你可能离开座位",
                    `系统检测到你在${area}${seatRow.seat_number}的座位桌面仍有物品。请确认你是否暂时离开、稍后还会回来。`,
                    `leave-created-${promptInsert.insertId}`,
                    JSON.stringify({
                      promptId: promptInsert.insertId,
                      promptKind: "leave",
                      reservationId: activeReservations[0].reservation_id,
                      seatId,
                      seatNumber: seatRow.seat_number,
                      area,
                      userId: activeReservations[0].user_id,
                    }),
                  ],
                );
              }
            } catch (promptErr) {
              if (promptErr?.code === "ER_NO_SUCH_TABLE") {
                leavePromptFeatureAvailable = false;
                console.warn("reservation_leave_prompts 表不存在，离座确认提示功能已暂时禁用。请执行对应迁移脚本。");
              } else {
                console.warn("创建离座确认提示失败:", promptErr.message || promptErr);
              }
            }
          }

          const startedAtMs = itemOccupiedSince ? new Date(itemOccupiedSince).getTime() : Date.now();
          const timeoutMs = Math.max(1, LEAVE_ITEM_TIMEOUT_MINUTES) * 60 * 1000;

          if (Date.now() - startedAtMs >= timeoutMs) {
            const sourceKey = `leave-timeout-${seatId}-${startedAtMs}`;
            const [existingRows] = await conn.query(
              `SELECT notification_id
               FROM notification_history
               WHERE user_id = ?
                 AND source = 'leave-timeout'
                 AND source_key = ?
               LIMIT 1`,
              [activeReservations[0].user_id, sourceKey],
            );

            if (existingRows.length === 0) {
              await conn.query(
                `INSERT INTO notification_history
                   (user_id, event_type, title, message, source, source_key, payload_json, is_read)
                 VALUES (?, 'danger', ?, ?, 'leave-timeout', ?, ?, 0)
                 ON DUPLICATE KEY UPDATE
                   event_type = VALUES(event_type),
                   title = VALUES(title),
                   message = VALUES(message),
                   payload_json = VALUES(payload_json),
                   is_read = notification_history.is_read,
                   updated_at = CURRENT_TIMESTAMP`,
                [
                  activeReservations[0].user_id,
                  "离座超时违规",
                  `系统检测到你在${area}${seatRow.seat_number}离开后桌面物品已持续超过${LEAVE_ITEM_TIMEOUT_MINUTES}分钟，请尽快返回；否则将判定为违规并释放座位。`,
                  sourceKey,
                  JSON.stringify({
                    reservationId: activeReservations[0].reservation_id,
                    seatId,
                    seatNumber: seatRow.seat_number,
                    area,
                    itemOccupiedSince: itemOccupiedSince || new Date(startedAtMs).toISOString(),
                    timeoutMinutes: LEAVE_ITEM_TIMEOUT_MINUTES,
                  }),
                ],
              );

              await conn.query("UPDATE seats SET status = 3 WHERE seat_id = ?", [seatId]);
            }
          }
        }
        continue;
      }

      const [pendingReservations] = await conn.query(
        "SELECT reservation_id, user_id FROM reservations WHERE seat_id = ? AND res_status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [seatId],
      );

      if (pendingReservations.length > 0) {
        // 有待签到预约时先保持“已预约”，并发起“是否本人入座”确认
        await conn.query("UPDATE seats SET item_occupied_since = NULL WHERE seat_id = ?", [seatId]);
        await conn.query("UPDATE seats SET status = 1 WHERE seat_id = ?", [seatId]);

        if (presencePromptFeatureAvailable && hasPerson) {
          try {
            const pending = pendingReservations[0];
            const [existingPrompts] = await conn.query(
              `SELECT prompt_id
               FROM reservation_presence_prompts
               WHERE reservation_id = ?
                 AND prompt_status = 'pending'
                 AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
               LIMIT 1`,
              [pending.reservation_id],
            );

            if (existingPrompts.length === 0) {
              const [promptInsert] = await conn.query(
                `INSERT INTO reservation_presence_prompts
                   (reservation_id, user_id, seat_id, prompt_status, detected_at)
                 VALUES (?, ?, ?, 'pending', NOW())`,
                [pending.reservation_id, pending.user_id, seatId],
              );

              await conn.query(
                `INSERT INTO notification_history
                   (user_id, event_type, title, message, source, source_key, payload_json, is_read)
                 VALUES (?, 'question', ?, ?, 'presence', ?, ?, 0)
                 ON DUPLICATE KEY UPDATE
                   event_type = VALUES(event_type),
                   title = VALUES(title),
                   message = VALUES(message),
                   payload_json = VALUES(payload_json),
                   is_read = notification_history.is_read,
                   updated_at = CURRENT_TIMESTAMP`,
                [
                  pending.user_id,
                  "检测到有人入座",
                  `系统检测到你预约的座位 ${seatId} 已有人入座，是否为你本人？`,
                  `presence-created-${promptInsert.insertId}`,
                  JSON.stringify({
                    promptId: promptInsert.insertId,
                    reservationId: pending.reservation_id,
                    seatId,
                    userId: pending.user_id,
                  }),
                ],
              );
            }
          } catch (promptErr) {
            if (promptErr?.code === "ER_NO_SUCH_TABLE") {
              presencePromptFeatureAvailable = false;
              console.warn("reservation_presence_prompts 表不存在，入座确认提示功能已暂时禁用。请执行对应迁移脚本。");
            } else {
              console.warn("创建入座确认提示失败:", promptErr.message || promptErr);
            }
          }
        }
        continue;
      }

      // 座位被占用且无活跃/待签到预约 -> 异常占座
      await conn.query("UPDATE seats SET item_occupied_since = NULL WHERE seat_id = ?", [seatId]);
      await conn.query("UPDATE seats SET status = 3 WHERE seat_id = ?", [seatId]);
    }

    const occupiedSeatIdSet = new Set(occupiedSeatIds.map((id) => Number(id)));
    const [activeSeatRows] = await conn.query(
      `SELECT r.reservation_id, r.user_id, r.seat_id
       FROM reservations r
       JOIN seats s ON s.seat_id = r.seat_id
       WHERE r.res_status = 'active' AND s.area = ?`,
      [area],
    );

    for (const row of activeSeatRows || []) {
      const seatId = Number(row.seat_id);
      if (!Number.isInteger(seatId) || occupiedSeatIdSet.has(seatId)) {
        continue;
      }

      await conn.query("UPDATE seats SET item_occupied_since = NULL WHERE seat_id = ?", [seatId]);
      await conn.query("UPDATE seats SET status = 2 WHERE seat_id = ?", [seatId]);

      if (!leavePromptFeatureAvailable) {
        continue;
      }

      try {
        const [existingPrompts] = await conn.query(
          `SELECT prompt_id
           FROM reservation_leave_prompts
           WHERE reservation_id = ?
             AND prompt_status = 'pending'
             AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
           LIMIT 1`,
          [row.reservation_id],
        );

        if (existingPrompts.length > 0) {
          continue;
        }

        const [promptInsert] = await conn.query(
          `INSERT INTO reservation_leave_prompts
             (reservation_id, user_id, seat_id, prompt_status, detected_at)
           VALUES (?, ?, ?, 'pending', NOW())`,
          [row.reservation_id, row.user_id, seatId],
        );

        const [seatInfoRows] = await conn.query(
          `SELECT seat_number, area
           FROM seats
           WHERE seat_id = ?
           LIMIT 1`,
          [seatId],
        );
        const seatInfo = seatInfoRows[0] || {
          seat_number: String(seatId),
          area: area || "未知区域",
        };

        await conn.query(
          `INSERT INTO notification_history
             (user_id, event_type, title, message, source, source_key, payload_json, is_read)
           VALUES (?, 'question', ?, ?, 'leave-presence', ?, ?, 0)
           ON DUPLICATE KEY UPDATE
             event_type = VALUES(event_type),
             title = VALUES(title),
             message = VALUES(message),
             payload_json = VALUES(payload_json),
             is_read = notification_history.is_read,
             updated_at = CURRENT_TIMESTAMP`,
          [
            row.user_id,
            "检测到你可能已离座",
            `系统检测到你在${seatInfo.area}${seatInfo.seat_number}的座位暂时无人，是否确认离开并释放座位？`,
            `leave-created-${promptInsert.insertId}`,
            JSON.stringify({
              promptId: promptInsert.insertId,
              promptKind: "leave",
              reservationId: row.reservation_id,
              seatId,
              seatNumber: seatInfo.seat_number,
              area: seatInfo.area,
              userId: row.user_id,
            }),
          ],
        );
      } catch (promptErr) {
        if (promptErr?.code === "ER_NO_SUCH_TABLE") {
          leavePromptFeatureAvailable = false;
          console.warn("reservation_leave_prompts 表不存在，离座确认提示功能已暂时禁用。请执行对应迁移脚本。");
        } else {
          console.warn("创建离座确认提示失败:", promptErr.message || promptErr);
        }
      }
    }

    const outVideoPath = String(result?.video?.out || out).replace(/\\/g, "/");
    const outVideoName = outVideoPath ? outVideoPath.split("/").pop() : "";
    const sourceStartFrame = Number(result?.source?.startFrame);
    const sourceProcessedFrames = Number(result?.source?.processedFrames);
    const sourceTotalFrames = Number(result?.source?.totalFrames);
    let nextStartFrame = Number.isFinite(sourceStartFrame) ? sourceStartFrame : startFrameNormalized;
    if (Number.isFinite(sourceProcessedFrames) && sourceProcessedFrames > 0) {
      nextStartFrame += Math.floor(sourceProcessedFrames);
    }
    if (Number.isFinite(sourceTotalFrames) && sourceTotalFrames > 0) {
      nextStartFrame = nextStartFrame % Math.floor(sourceTotalFrames);
    }
    if (advanceCursor) {
      detectionCursorByArea.set(area, Math.max(0, nextStartFrame));
    }

    const payload = {
      area,
      videoPath: effectiveVideoPath,
      requestedVideoPath,
      occupiedSeatIds,
      occupiedIndexes,
      detectionWindow: {
        startFrame: Number.isFinite(sourceStartFrame) ? sourceStartFrame : startFrameNormalized,
        processedFrames: Number.isFinite(sourceProcessedFrames) ? sourceProcessedFrames : null,
        totalFrames: Number.isFinite(sourceTotalFrames) ? sourceTotalFrames : null,
        nextStartFrame,
      },
      detectionChanged,
      videoUrl: outVideoName ? `/python-assets/results/${outVideoName}?t=${Date.now()}` : undefined,
      videoMeta: result?.video || null,
      detectedAt: Date.now(),
      note: usedCalibratedVideo
        ? `请求视频(${requestedVideoPath})与座位标定视频不一致，已自动使用标定视频(${effectiveVideoPath})避免座位框漂移`
        : (missingCalibratedVideoNote || undefined),
      models: {
        person: PERSON_DETECT_MODEL.replace(/\\/g, "/"),
        item: ITEM_DETECT_MODEL.replace(/\\/g, "/"),
      },
    };
    lastDetectionAt = Date.now();
    if (saveVideo) {
      latestOccupationResult = payload;
    }
    broadcastSeatUpdate({
      area,
      source: "detection",
      reason: detectionChanged ? "seat-status-updated" : "seat-status-refreshed",
      seatIds: occupiedSeatIds,
    });
    console.log(
      "占座检测完成，occupiedSeatIds:",
      occupiedSeatIds,
      "changed:",
      detectionChanged,
      "window:",
      payload.detectionWindow,
    );
    return payload;
  } finally {
    detectionRunning = false;
    detectionStartedAt = 0;
  }
}

// 启动服务器
(async () => {
  await ensurePresencePromptTable();
  await ensureLeavePromptTable();
  await ensureNotificationHistoryTable();
  await ensureSeatItemOccupancyColumn();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
