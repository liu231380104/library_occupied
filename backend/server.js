const express = require("express");
const cors = require("cors");
const { PythonShell } = require("python-shell");
const { spawn } = require("child_process");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
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
app.use("/python-assets", express.static(path.join(__dirname, "python_scripts")));

// 路由
const authRoutes = require("./routes/auth");
const seatsRoutes = require("./routes/seats");
const reserveRoutes = require("./routes/reserve");
const reportRoutes = require("./routes/reports");
app.use("/api/auth", authRoutes);
app.use("/api/seats", seatsRoutes);
app.use("/api/reservations", reserveRoutes);
app.use("/api/reports", reportRoutes);

const PY_SCRIPT_DIR = path.join(__dirname, "python_scripts");
const SEAT_META_PATH = path.join(PY_SCRIPT_DIR, "seats_meta.json");
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODEL_DIR = path.join(__dirname, "modules");
const DEFAULT_TEST_VIDEO = process.env.DEFAULT_TEST_VIDEO || path.join(PROJECT_ROOT, "v1.mp4");
const SEAT_DETECT_MODEL = process.env.SEAT_DETECT_MODEL || path.join(MODEL_DIR, "seat_best.pt");
const PERSON_DETECT_MODEL = process.env.PERSON_DETECT_MODEL || path.join(MODEL_DIR, "best.pt");
const ITEM_DETECT_MODEL = process.env.ITEM_DETECT_MODEL || path.join(MODEL_DIR, "yolov8n.pt");
const SEAT_DETECT_CONF = Number(process.env.SEAT_DETECT_CONF || 0.35);
const PYTHON_PATH = process.env.PYTHON_PATH || "";
const PYTHON_EXECUTABLE = PYTHON_PATH || process.env.PYTHON || "python";
const ENABLE_OCCUPATION_CRON = String(process.env.ENABLE_OCCUPATION_CRON || "false").toLowerCase() === "true";
let detectionRunning = false;
const seatGenerationTasks = new Map();
let latestOccupationResult = null;

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

    for (const seatNumber of generatedSeatNumbers) {
      const [existRows] = await conn.query(
        "SELECT seat_id FROM seats WHERE seat_number = ? LIMIT 1",
        [seatNumber],
      );

      if (existRows.length > 0) {
        // 保留原 seat_id 和历史预约，仅刷新区域与时间戳
        await conn.query(
          "UPDATE seats SET area = ?, last_updated = NOW() WHERE seat_number = ?",
          [area, seatNumber],
        );
      } else {
        await conn.query(
          "INSERT INTO seats (seat_number, area, status) VALUES (?, ?, 0)",
          [seatNumber, area],
        );
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
    const seatMeta = loadSeatMeta();
    const videoPath = seatMeta?.videoPath || requestedVideoPath;
    const useCalibratedVideo = Boolean(seatMeta?.videoPath && seatMeta.videoPath !== requestedVideoPath);
    const out = "results/live_sync.mp4";
    const outputFps = Number(seatMeta?.sourceVideo?.fps) || 0;

    const pyArgs = [
      "--video",
      videoPath,
      "--seats",
      "seats.json",
      "--use-raw-seats",
      "--realtime-detect",
      "--detect-interval",
      "4",
      "--max-frames",
      "300",
    ];
    if (outputFps > 1) {
      pyArgs.push("--output-fps", String(outputFps));
    }
    pyArgs.push("--out", out);

    const { stdout, stderr, code } = await runPythonScriptWithTimeout(
      "stream_video.py",
      pyArgs,
      180000,
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

    res.json({
      message: "监控视频生成完成",
      videoUrl: `/python-assets/results/live_sync.mp4?t=${Date.now()}`,
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
    const result = await runSeatDetection({ videoPath, area, maxFrames: 300 });
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

// 定时任务：默认关闭，避免占用资源导致管理端识别超时
if (ENABLE_OCCUPATION_CRON) {
  cron.schedule("*/10 * * * * *", () => {
    runSeatDetection({ videoPath: DEFAULT_TEST_VIDEO, area: "A区", maxFrames: 300 }).catch((e) => {
      console.error("定时占座检测失败:", e);
    });
  });
  console.log("Occupation cron enabled: every 10 seconds");
} else {
  console.log("Occupation cron disabled (set ENABLE_OCCUPATION_CRON=true to enable)");
}

async function runSeatDetection({ videoPath, area = "A区", maxFrames = 300 }) {
  if (detectionRunning) {
    throw new Error("占座检测仍在运行，请稍后重试");
  }
  detectionRunning = true;

  const seatMeta = loadSeatMeta();
  const requestedVideoPath = videoPath;
  const effectiveVideoPath = seatMeta?.videoPath || videoPath;
  const usedCalibratedVideo = Boolean(seatMeta?.videoPath && seatMeta.videoPath !== requestedVideoPath);
  const out = "results/occupation_latest.mp4";
  const outputFps = Number(seatMeta?.sourceVideo?.fps) || 0;
  const args = [
    "--video",
    effectiveVideoPath,
    "--seats",
    "seats.json",
    "--use-raw-seats",
    "--realtime-detect",
    "--detect-interval",
    "4",
    "--max-frames",
    String(Math.max(1, Math.min(Number(maxFrames) || 120, 300))),
  ];
  if (outputFps > 1) {
    args.push("--output-fps", String(outputFps));
  }
  args.push("--out", out);

  try {
    const { stdout, stderr, code } = await runPythonScriptWithTimeout(
      "stream_video.py",
      args,
      180000,
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

    const occupiedSeatIds = occupiedIndexes
      .map((idx) => areaSeats[idx]?.seat_id)
      .filter((id) => Number.isInteger(id));

    await conn.query(
      "UPDATE seats SET status = CASE WHEN status = 1 THEN 1 ELSE 0 END WHERE area = ?",
      [area],
    );

    for (const seatId of occupiedSeatIds) {
      const [reservations] = await conn.query(
        "SELECT 1 FROM reservations WHERE seat_id = ? AND res_status = 'active' LIMIT 1",
        [seatId],
      );
      if (reservations.length === 0) {
        // 座位被占用但无活跃预约 -> 异常占座
        await conn.query("UPDATE seats SET status = 3 WHERE seat_id = ?", [seatId]);
      } else {
        // 座位被占用且有活跃预约 -> 已占用
        await conn.query("UPDATE seats SET status = 2 WHERE seat_id = ?", [seatId]);
      }
    }

    const payload = {
      area,
      videoPath: effectiveVideoPath,
      requestedVideoPath,
      occupiedSeatIds,
      occupiedIndexes,
      videoUrl: `/python-assets/results/occupation_latest.mp4?t=${Date.now()}`,
      videoMeta: result?.video || null,
      detectedAt: Date.now(),
      note: usedCalibratedVideo
        ? `请求视频(${requestedVideoPath})与座位标定视频不一致，已自动使用标定视频(${effectiveVideoPath})避免座位框漂移`
        : undefined,
      models: {
        person: PERSON_DETECT_MODEL.replace(/\\/g, "/"),
        item: ITEM_DETECT_MODEL.replace(/\\/g, "/"),
      },
    };
    latestOccupationResult = payload;
    console.log("占座检测完成，occupiedSeatIds:", occupiedSeatIds);
    return payload;
  } finally {
    detectionRunning = false;
  }
}

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
