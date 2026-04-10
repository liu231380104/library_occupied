import React, { useState, useEffect, useRef } from "react";
import api from "../../services/api";

const THEME = {
  panel: "#fcfbf8",
  soft: "#f1eee8",
  border: "#d8d2c9",
  text: "#5f6768",
  muted: "#8f9594",
  primary: "#7f95a6",
  success: "#8ca79a",
  danger: "#b78a84",
  accent: "#a996b0",
};

const PREVIEW_MEDIA_MAX_WIDTH = 1200;
const LEAVE_ITEM_TIMEOUT_MINUTES = 15;
const DEFAULT_SEAT_DETECT_FRAME = 0;
const DETECT_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const DETECT_MAX_FRAMES = 1800;
const DETECT_INTERVAL = 8;

const PAGE_STYLE = {
  maxWidth: "1400px",
  margin: "0 auto",
  padding: "8px 4px 24px",
  color: THEME.text,
};

const HERO_STYLE = {
  marginBottom: "16px",
  padding: "16px 18px",
  border: `1px solid ${THEME.border}`,
  borderRadius: "12px",
  background: "linear-gradient(180deg, #fdfcf9 0%, #f6f2eb 100%)",
  boxShadow: "0 1px 2px rgba(63, 71, 72, 0.04)",
};

const FLOW_GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px",
  marginTop: "12px",
};

const FLOW_CARD_STYLE = {
  border: `1px solid ${THEME.border}`,
  borderRadius: "10px",
  padding: "12px",
  background: "rgba(255,255,255,0.85)",
};

const FLOW_STEP_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  marginBottom: "8px",
  borderRadius: "999px",
  background: THEME.primary,
  color: "#fff",
  fontWeight: 700,
  fontSize: "13px",
};

const FLOW_STEPS = [
  {
    key: "upload",
    title: "上传视频",
    desc: "先上传检测视频并确认视频路径。",
  },
  {
    key: "recognize",
    title: "识别座位",
    desc: "上传后直接生成可编辑座位框。",
  },
  {
    key: "save",
    title: "确认保存",
    desc: "校对座位框并保存到配置与数据库。",
  },
  {
    key: "detect",
    title: "运行检测",
    desc: "按保存后的配置运行占座检测任务。",
  },
  {
    key: "review",
    title: "查看结果",
    desc: "先看监控视频，再查看异常座位摘要。",
  },
];

const FLOW_STEP_PROGRESS = {
  upload: 0,
  uploaded: 0,
  generating: 1,
  generated: 1,
  saving: 2,
  saved: 2,
  detecting: 3,
  detected: 4,
};

const normalizeMonitorVideoUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const cleaned = rawUrl.trim().replace(/\\\\/g, "/");

  // 兼容历史错误路径：/python-assets/python_scripts/results/xxx.mp4
  const withoutDupPrefix = cleaned.replace("/python-assets/python_scripts/", "/python-assets/");

  if (/^https?:\/\//i.test(withoutDupPrefix)) {
    return withoutDupPrefix;
  }
  return withoutDupPrefix.startsWith("/") ? withoutDupPrefix : `/${withoutDupPrefix}`;
};

const AdminSeatConfig = () => {
  const [videoPath, setVideoPath] = useState("");
  const [selectedVideoName, setSelectedVideoName] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadVideoError, setUploadVideoError] = useState("");
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [monitorVideoUrl, setMonitorVideoUrl] = useState("");
  const [monitorVideoError, setMonitorVideoError] = useState("");
  const [latestOccupation, setLatestOccupation] = useState(null);
  const [seats, setSeats] = useState([]);
  const [runtimeSeats, setRuntimeSeats] = useState([]);
  const [nowTs, setNowTs] = useState(Date.now());
  const [area, setArea] = useState("A区");
  const [prefix, setPrefix] = useState("A");
  const [resetSeatNumber, setResetSeatNumber] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [generateTaskStatus, setGenerateTaskStatus] = useState("");
  const [flowStep, setFlowStep] = useState("upload");
  const [flowHint, setFlowHint] = useState("请先上传视频，然后点击识别座位。");
  const [isSeatConfigSaved, setIsSeatConfigSaved] = useState(false);
  const [lastSeatSourceVideo, setLastSeatSourceVideo] = useState(null);
  const [activeSeatIndex, setActiveSeatIndex] = useState(-1);
  const [seatSearch, setSeatSearch] = useState("");
  const [dragging, setDragging] = useState(null);
  const [imgMetrics, setImgMetrics] = useState({
    naturalW: 1,
    naturalH: 1,
    displayW: 1,
    displayH: 1,
  });
  const imgRef = useRef(null);
  const previewPanelRef = useRef(null);
  const fileInputRef = useRef(null);
  // simulated-samples UI removed

  const flowProgress = FLOW_STEP_PROGRESS[flowStep] ?? 0;

  useEffect(() => {
    fetchLatestOccupationResult();
    fetchRuntimeSeats("A区");
  }, []);

  useEffect(() => {
    fetchRuntimeSeats(area);
  }, [area]);

  useEffect(() => {
    const hasActiveTimer = runtimeSeats.some(
      (seat) => Boolean(seat?.item_occupied_since) && Number(seat?.status) !== 0,
    );
    if (!hasActiveTimer) return undefined;

    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [runtimeSeats]);

  const fetchRuntimeSeats = async (targetArea = area) => {
    try {
      const resp = targetArea
        ? await api.get("/seats", { params: { area: targetArea, _: Date.now() } })
        : await api.get("/seats", { params: { _: Date.now() } });
      setRuntimeSeats(Array.isArray(resp.data) ? resp.data : []);
    } catch (e) {
      setRuntimeSeats([]);
    }
  };

  const formatDuration = (seconds) => {
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  const timerRows = runtimeSeats
    .filter((seat) => Boolean(seat?.item_occupied_since) && Number(seat?.status) !== 0)
    .map((seat) => {
      const startedMs = new Date(seat.item_occupied_since).getTime();
      const validStarted = Number.isFinite(startedMs);
      const elapsedSec = validStarted ? Math.max(0, Math.floor((nowTs - startedMs) / 1000)) : 0;
      const limitSec = LEAVE_ITEM_TIMEOUT_MINUTES * 60;
      const remainSec = Math.max(0, limitSec - elapsedSec);
      const overSec = Math.max(0, elapsedSec - limitSec);
      const overtime = elapsedSec >= limitSec;

      return {
        seatId: seat.seat_id,
        seatNumber: seat.seat_number || `#${seat.seat_id}`,
        startedAt: seat.item_occupied_since,
        elapsedText: formatDuration(elapsedSec),
        remainText: formatDuration(remainSec),
        overText: formatDuration(overSec),
        overtime,
      };
    })
    .sort((a, b) => String(a.seatNumber).localeCompare(String(b.seatNumber), "zh-CN", { numeric: true }));

  const fetchLatestOccupationResult = async () => {
    try {
      const fromSession = sessionStorage.getItem("latestOccupationVideoUrl") || "";
      if (fromSession) {
        setMonitorVideoUrl(normalizeMonitorVideoUrl(fromSession));
        setMonitorVideoError("");
      }

      const resp = await api.get("/detect-occupation/latest");
      const latest = resp.data?.videoUrl || "";
      if (latest) {
        const normalized = normalizeMonitorVideoUrl(latest);
        setMonitorVideoUrl(normalized);
        sessionStorage.setItem("latestOccupationVideoUrl", normalized);
        setMonitorVideoError("");
      }
      setLatestOccupation(resp.data || null);
    } catch (e) {
      setLatestOccupation(null);
      // /latest 可能暂时返回404，不清空已存在的视频地址，避免前端区域直接消失
    }
  };

  const handleRunOccupationDetection = async () => {
    if (!videoPath.trim()) {
      alert("请先上传视频或填写可访问的视频路径");
      return;
    }
    if (!isSeatConfigSaved) {
      alert("请先确认并保存座位配置，再运行占座检测");
      return;
    }

    try {
      setBusyAction("occupy-detect");
      setFlowStep("detecting");
      setFlowHint("检测任务已启动，处理中请稍候...");
      const resp = await api.post(
        "/detect-occupation",
        {
          videoPath,
          area,
          saveVideo: true,
          maxFrames: DETECT_MAX_FRAMES,
          detectInterval: DETECT_INTERVAL,
          timeoutMs: DETECT_REQUEST_TIMEOUT_MS,
        },
        { timeout: DETECT_REQUEST_TIMEOUT_MS },
      );
      const result = resp.data || {};
      setLatestOccupation(result);
      const latest = result.videoUrl || `/python-assets/results/occupation_latest.mp4?t=${Date.now()}`;
      if (latest) {
        const normalized = normalizeMonitorVideoUrl(latest);
        setMonitorVideoUrl(normalized);
        sessionStorage.setItem("latestOccupationVideoUrl", normalized);
        setMonitorVideoError("");
      }

      // 再次拉取最新结果，避免后端回包字段不全或缓存导致页面未更新
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fetchLatestOccupationResult();
      await fetchRuntimeSeats(area);

      setFlowStep("detected");
      setFlowHint("检测已完成。请先查看监控视频，再核对异常占座结果。");

      alert(`占座检测完成，异常占座 ${result.occupiedSeatIds?.length || 0} 个`);
    } catch (err) {
      console.error("Detect occupation error:", err);
      setFlowStep("saved");
      setFlowHint("检测失败，请修正问题后重试。");
      if (err.code === "ECONNABORTED") {
        alert("占座检测超时，请重试；若仍超时，可缩短视频或进一步减少检测帧数");
        return;
      }
      alert(err.response?.data?.error || "占座检测失败");
    } finally {
      setBusyAction("");
    }
  };

  const isBusy = Boolean(busyAction);
  const canGenerateSeats = Boolean(videoPath.trim()) && !isBusy;
  const canSaveSeats = seats.length > 0 && !isBusy;
  const canRunDetection = Boolean(videoPath.trim()) && isSeatConfigSaved && !isBusy;

  const handlePickVideoFile = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleUploadVideoFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingVideo(true);
      setUploadVideoError("");
      setSelectedVideoName(file.name);

      const formData = new FormData();
      formData.append("video", file);

      const resp = await api.post("/upload-video", formData, {
        timeout: 300000,
      });

      const uploadedPath = resp.data?.videoPath || "";
      if (!uploadedPath) {
        throw new Error("上传成功但没有返回视频路径");
      }

      setVideoPath(uploadedPath);
      setSeats([]);
      setPreviewImageUrl("");
      setLastSeatSourceVideo(null);
      setActiveSeatIndex(-1);
      setSeatSearch("");
      setLatestOccupation(null);
      setMonitorVideoUrl("");
      setMonitorVideoError("");
      sessionStorage.removeItem("latestOccupationVideoUrl");
      setGenerateTaskStatus(`已上传：${resp.data?.originalName || file.name}，请点击“识别座位”。`);
      setSelectedVideoName(resp.data?.originalName || file.name);
      setIsSeatConfigSaved(false);
      setFlowStep("uploaded");
      setFlowHint("视频上传成功。下一步：识别座位。");
    } catch (err) {
      console.error("Upload video error:", err);
      setUploadVideoError(err.response?.data?.error || err.message || "视频上传失败");
      setFlowHint("视频上传失败，请重试或手动填写视频路径。");
    } finally {
      setUploadingVideo(false);
      event.target.value = "";
    }
  };

  useEffect(() => {
    const onUp = () => setDragging(null);
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const handleGenerateSeats = async () => {
    if (!videoPath.trim()) {
      alert("请先上传视频或填写可访问的视频路径");
      return;
    }

    try {
      setBusyAction("generating");
      setGenerateTaskStatus("任务创建中...");
      setFlowStep("generating");
      setFlowHint("正在识别座位，请等待任务完成。");

      const createResp = await api.post("/generate-seats/tasks", {
        videoPath,
        frame: DEFAULT_SEAT_DETECT_FRAME,
      });

      const taskId = createResp.data?.taskId;
      if (!taskId) {
        throw new Error("创建识别任务失败");
      }

      const startedAt = Date.now();
      const maxWaitMs = 10 * 60 * 1000;

      while (true) {
        if (Date.now() - startedAt > maxWaitMs) {
          throw new Error("识别任务等待超时，请稍后重试");
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusResp = await api.get(`/generate-seats/tasks/${taskId}`, {
          timeout: 30000,
        });

        const status = statusResp.data?.status;
        setGenerateTaskStatus(`任务状态：${status || "unknown"}`);

        if (status === "succeeded") {
          const result = statusResp.data?.result || {};
          setSeats(result.chairs || []);
          setLastSeatSourceVideo(result.sourceVideo || null);
          const imageUrl = result.imageUrl
            ? `${result.imageUrl}?t=${Date.now()}`
            : "";
          setPreviewImageUrl(imageUrl);
          alert(`识别完成，共识别 ${result.count ?? 0} 个候选座位`);
          setGenerateTaskStatus("已完成");
          setIsSeatConfigSaved(false);
          setFlowStep("generated");
          setFlowHint("座位识别完成。请检查座位框并点击“确认并保存座位配置”。");
          break;
        }

        if (status === "failed") {
          const taskErr = statusResp.data?.error;
          const backendMsg = taskErr?.error || statusResp.data?.error?.message;
          const raw = taskErr?.rawOutput;
          const rawMsg = Array.isArray(raw) ? raw.join("\n") : "";
          throw new Error(backendMsg || rawMsg || "座位识别失败");
        }
      }
    } catch (err) {
      console.error("Generate seats error:", err);
      alert(err.message || err.response?.data?.error || "座位识别失败");
      setGenerateTaskStatus("失败");
      setFlowStep(videoPath.trim() ? "uploaded" : "upload");
      setFlowHint("座位识别失败，请检查视频后重试。");
    } finally {
      setBusyAction("");
    }
  };

  const updateSeatValue = (idx, pos, value) => {
    const next = seats.map((seat, i) => {
      if (i !== idx) return seat;
      const cloned = [...seat];
      cloned[pos] = Number(value) || 0;
      return cloned;
    });
    setSeats(next);
  };

  const addSeat = () => {
    setSeats([...seats, [100, 100, 200, 200]]);
  };

  const removeSeat = (idx) => {
    setSeats(seats.filter((_, i) => i !== idx));
  };

  const refreshImageMetrics = () => {
    const img = imgRef.current;
    if (!img) return;
    setImgMetrics({
      naturalW: img.naturalWidth || 1,
      naturalH: img.naturalHeight || 1,
      displayW: img.clientWidth || 1,
      displayH: img.clientHeight || 1,
    });
  };

  const startDragSeat = (e, idx, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSeatIndex(idx);
    setDragging({
      idx,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      original: [...seats[idx]],
    });
  };

  const handleOverlayMouseMove = (e) => {
    if (!dragging) return;
    const sx = imgMetrics.displayW / imgMetrics.naturalW;
    const sy = imgMetrics.displayH / imgMetrics.naturalH;
    const dx = Math.round((e.clientX - dragging.startX) / Math.max(sx, 0.0001));
    const dy = Math.round((e.clientY - dragging.startY) / Math.max(sy, 0.0001));

    setSeats((prev) =>
      prev.map((seat, i) => {
        if (i !== dragging.idx) return seat;
        const [x1, y1, x2, y2] = dragging.original;
        if (dragging.mode === "move") {
          return [Math.max(0, x1 + dx), Math.max(0, y1 + dy), Math.max(1, x2 + dx), Math.max(1, y2 + dy)];
        }
        const nx2 = Math.max(x1 + 10, x2 + dx);
        const ny2 = Math.max(y1 + 10, y2 + dy);
        return [x1, y1, nx2, ny2];
      }),
    );
  };

  const handleConfirmSeats = async () => {
    if (!seats.length) {
      alert("请先识别或新增座位框");
      return;
    }
    try {
      setBusyAction("confirming");
      setFlowStep("saving");
      setFlowHint("正在保存座位配置...");
      const cleanPreviewImageUrl = previewImageUrl
        ? previewImageUrl.split("?")[0]
        : "";
      const resp = await api.post("/confirm-seats", {
        area,
        prefix,
        seats,
        videoPath,
        frame: DEFAULT_SEAT_DETECT_FRAME,
        previewImageUrl: cleanPreviewImageUrl,
        sourceVideo: lastSeatSourceVideo,
      });
      await fetchRuntimeSeats(area);
      setIsSeatConfigSaved(true);
      setFlowStep("saved");
      setFlowHint("座位配置已保存。下一步：运行占座检测。");
      alert(resp.data?.message || "座位已确认并保存");
    } catch (err) {
      console.error("Confirm seats error:", err);
      alert(err.response?.data?.error || "确认座位失败");
      setFlowStep("generated");
      setFlowHint("保存失败，请检查参数并重试。");
    } finally {
      setBusyAction("");
    }
  };

  const handleResetTimerByArea = async () => {
    if (!area) {
      alert("请先填写区域");
      return;
    }
    try {
      setBusyAction("reset-area-timer");
      const resp = await api.post("/seats/item-timer/reset", { area });
      await fetchRuntimeSeats(area);
      alert(resp.data?.message
        ? `${resp.data.message}（${resp.data.affectedRows || 0} 条）`
        : "区域离座计时已重置");
    } catch (err) {
      console.error("Reset timer by area error:", err);
      alert(err.response?.data?.message || "区域离座计时重置失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleResetTimerBySeat = async () => {
    const seatNumber = resetSeatNumber.trim();
    if (!seatNumber) {
      alert("请先输入座位号，例如 A12");
      return;
    }
    try {
      setBusyAction("reset-seat-timer");
      const resp = await api.post("/seats/item-timer/reset", {
        area,
        seatNumber,
      });
      await fetchRuntimeSeats(area);
      alert(resp.data?.message
        ? `${resp.data.message}（${resp.data.affectedRows || 0} 条）`
        : "座位离座计时已重置");
    } catch (err) {
      console.error("Reset timer by seat error:", err);
      alert(err.response?.data?.message || "座位离座计时重置失败");
    } finally {
      setBusyAction("");
    }
  };

  const selectSeatAndFocus = (idx) => {
    setActiveSeatIndex(idx);
    if (previewPanelRef.current) {
      previewPanelRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const normalizedSeatSearch = seatSearch.trim().toLowerCase();
  const filteredSeatRows = seats
    .map((seat, idx) => ({ seat, idx, label: `${prefix}${idx + 1}` }))
    .filter((item) => item.label.toLowerCase().includes(normalizedSeatSearch));

  // simulated-samples endpoints and UI have been removed

  return (
    <div style={PAGE_STYLE}>
      <div style={HERO_STYLE}>
        <h2 style={{ margin: 0, color: THEME.text }}>视频座位配置</h2>
        <div style={FLOW_GRID_STYLE}>
          {FLOW_STEPS.map((step, idx) => {
            const completed = idx < flowProgress;
            const active = idx === flowProgress;
            const cardStyle = {
              ...FLOW_CARD_STYLE,
              border: active
                ? `1px solid ${THEME.primary}`
                : completed
                  ? `1px solid ${THEME.success}`
                  : `1px solid ${THEME.border}`,
              background: active
                ? "#f7fbff"
                : completed
                  ? "#f4faf6"
                  : "rgba(255,255,255,0.85)",
            };

            return (
              <div key={step.key} style={cardStyle}>
                <div
                  style={{
                    ...FLOW_STEP_STYLE,
                    background: active ? THEME.primary : completed ? THEME.success : THEME.border,
                  }}
                >
                  {idx + 1}
                </div>
                <div style={{ fontWeight: 700, marginBottom: "4px", color: THEME.text }}>{step.title}</div>
                <div style={{ fontSize: "13px", color: THEME.muted, lineHeight: 1.5 }}>{step.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${THEME.border}`,
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "18px",
          background: THEME.panel,
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "8px" }}>视频输入与检测操作</h3>
        <p style={{ marginTop: 0, marginBottom: "12px", color: THEME.muted, lineHeight: 1.6 }}>
          建议按顺序操作：先上传视频并识别座位，再编辑并保存配置，最后运行占座检测并查看结果。
        </p>

        <div
          style={{
            marginBottom: "12px",
            padding: "10px 12px",
            border: `1px solid ${THEME.border}`,
            borderRadius: "8px",
            background: "#fff",
            color: THEME.text,
            fontSize: "14px",
          }}
        >
          当前步骤提示：{flowHint}
        </div>

        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleUploadVideoFile} style={{ display: "none" }} />

        <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={handlePickVideoFile}
            disabled={uploadingVideo}
            style={{ padding: "8px 12px", cursor: "pointer", border: `1px solid ${THEME.border}`, background: "#fff" }}
          >
            {uploadingVideo ? "上传中..." : "选择视频文件上传"}
          </button>
          <div style={{ color: THEME.muted, fontSize: "13px" }}>
            {selectedVideoName ? `已选：${selectedVideoName}` : "未选择文件，仍可手动填写路径兜底"}
          </div>
          <button
            onClick={handleGenerateSeats}
            disabled={!canGenerateSeats}
            style={{ padding: "8px 12px", cursor: "pointer" }}
          >
            {busyAction === "generating" ? "识别中..." : "识别座位"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ flex: 1, minWidth: "320px", padding: "8px" }}
            value={videoPath}
            onChange={(e) => setVideoPath(e.target.value)}
            placeholder="兜底：若上传失败，可手动填写后端可访问的视频路径"
          />
          <div style={{ color: THEME.muted, fontSize: "12px" }}>
            上传后的路径会自动填到这里
          </div>
        </div>

        {uploadVideoError && (
          <div style={{ marginBottom: "10px", color: THEME.danger, fontSize: "13px" }}>
            {uploadVideoError}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px", flexWrap: "wrap", marginTop: "14px", marginBottom: "12px" }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: "8px" }}>座位框编辑与保存</h3>
            <p style={{ marginTop: 0, marginBottom: 0, color: THEME.muted, lineHeight: 1.6 }}>
              先调整座位框，再保存配置；新增座位框和确认保存放在一起，操作会更顺手。
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
            <input
              style={{ width: "140px", padding: "8px" }}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="区域，如A区"
            />
            <input
              style={{ width: "120px", padding: "8px" }}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="编号前缀，如A"
            />
            <button
              onClick={addSeat}
              style={{ padding: "8px 12px", cursor: "pointer" }}
            >
              新增座位框
            </button>
            <button
              onClick={handleConfirmSeats}
              disabled={!canSaveSeats}
              style={{ padding: "8px 12px", cursor: "pointer", background: THEME.success, color: "#fff", border: "none" }}
            >
              {busyAction === "confirming" ? "保存中..." : "确认并保存座位配置"}
            </button>
            <button
              onClick={handleRunOccupationDetection}
              disabled={!canRunDetection}
              style={{ padding: "8px 12px", cursor: "pointer", background: THEME.accent, color: "#fff", border: "none" }}
            >
              {busyAction === "occupy-detect" ? "检测中..." : "运行占座检测"}
            </button>
            <button
              onClick={fetchLatestOccupationResult}
              disabled={isBusy}
              style={{ padding: "8px 12px", cursor: "pointer" }}
            >
              刷新最近检测结果
            </button>
          </div>
        </div>

        {generateTaskStatus && (
          <div style={{ marginBottom: "10px", color: THEME.text }}>{generateTaskStatus}</div>
        )}

        {previewImageUrl && (
          <div
            style={{
              marginBottom: "12px",
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "12px",
              alignItems: "stretch",
              width: "100%",
              maxWidth: `calc(${PREVIEW_MEDIA_MAX_WIDTH}px * 2 + 12px)`,
              margin: "0 auto",
            }}
          >
            <div
              ref={previewPanelRef}
              style={{
                background: "#fff",
                border: `1px solid ${THEME.border}`,
                borderRadius: "6px",
                padding: "10px",
                width: "100%",
                minWidth: 0,
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <strong>识别预览图</strong>
              <div style={{ margin: "8px 0", color: THEME.muted, fontSize: "13px" }}>
                左键拖动红框可移动；拖右下角小方块可调整大小。
              </div>
              <div
                style={{ position: "relative", width: "100%" }}
                onMouseMove={handleOverlayMouseMove}
                onMouseLeave={() => setDragging(null)}
              >
                <img
                  ref={imgRef}
                  src={`http://localhost:5000${previewImageUrl}?t=${Date.now()}`}
                  alt="seats-preview"
                  onLoad={refreshImageMetrics}
                  style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: "6px", display: "block" }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: `${imgMetrics.displayW}px`,
                    height: `${imgMetrics.displayH}px`,
                    pointerEvents: "none",
                  }}
                >
                  {seats.map((seat, idx) => {
                    const sx = imgMetrics.displayW / imgMetrics.naturalW;
                    const sy = imgMetrics.displayH / imgMetrics.naturalH;
                    const left = seat[0] * sx;
                    const top = seat[1] * sy;
                    const width = Math.max(10, (seat[2] - seat[0]) * sx);
                    const height = Math.max(10, (seat[3] - seat[1]) * sy);
                    const isActive = idx === activeSeatIndex;
                    return (
                      <div
                        key={`box-${idx}`}
                        onMouseDown={(e) => startDragSeat(e, idx, "move")}
                        style={{
                          position: "absolute",
                          left,
                          top,
                          width,
                          height,
                          border: `2px solid ${isActive ? "#4f7f67" : "#b78a84"}`,
                          background: isActive ? "rgba(79, 127, 103, 0.16)" : "rgba(255, 0, 0, 0.06)",
                          boxSizing: "border-box",
                          pointerEvents: "auto",
                          cursor: "move",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: 2,
                            top: 2,
                            background: isActive ? "#4f7f67" : "#b78a84",
                            color: "#fff",
                            fontSize: "12px",
                            padding: "1px 5px",
                            borderRadius: "3px",
                          }}
                        >
                          {prefix}{idx + 1}
                        </div>
                        <div
                          onMouseDown={(e) => startDragSeat(e, idx, "resize")}
                          style={{
                            position: "absolute",
                            right: -5,
                            bottom: -5,
                            width: 10,
                            height: 10,
                            background: "#fff",
                            border: `2px solid ${isActive ? "#4f7f67" : "#b78a84"}`,
                            cursor: "nwse-resize",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              style={{
                background: "#fff",
                border: `1px solid ${THEME.border}`,
                borderRadius: "6px",
                padding: "10px",
                width: "100%",
                minWidth: 0,
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <strong>座位列表</strong>
                <span style={{ color: THEME.muted, fontSize: "12px" }}>共 {filteredSeatRows.length}/{seats.length}</span>
              </div>
              <input
                type="text"
                value={seatSearch}
                onChange={(e) => setSeatSearch(e.target.value)}
                placeholder="搜索编号，例如 A12"
                style={{ width: "100%", marginBottom: "8px", padding: "8px", border: `1px solid ${THEME.border}`, borderRadius: "6px" }}
              />

              <div
                style={{
                  height: `${Math.max(320, Math.round(imgMetrics.displayH || 0))}px`,
                  overflow: "auto",
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "6px",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "32%" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: THEME.soft }}>
                      <th style={{ padding: "8px", textAlign: "left" }}>编号</th>
                      <th style={{ padding: "8px" }}>x1</th>
                      <th style={{ padding: "8px" }}>y1</th>
                      <th style={{ padding: "8px" }}>x2</th>
                      <th style={{ padding: "8px" }}>y2</th>
                      <th style={{ padding: "8px" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSeatRows.map(({ seat, idx, label }) => {
                      const isActive = idx === activeSeatIndex;
                      return (
                        <tr
                          key={`seat-row-${idx}`}
                          onClick={() => setActiveSeatIndex(idx)}
                          style={{
                            borderTop: `1px solid ${THEME.border}`,
                            background: isActive ? "#e9f2ee" : "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <td style={{ padding: "8px", fontWeight: isActive ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</td>
                          {[0, 1, 2, 3].map((pos) => (
                            <td key={pos} style={{ padding: "8px" }}>
                              <input
                                type="number"
                                value={seat[pos]}
                                onChange={(e) => updateSeatValue(idx, pos, e.target.value)}
                                onFocus={() => setActiveSeatIndex(idx)}
                                style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "5px" }}
                              />
                            </td>
                          ))}
                          <td style={{ padding: "8px" }}>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectSeatAndFocus(idx);
                                }}
                                style={{ padding: "5px 8px", cursor: "pointer", border: `1px solid ${THEME.border}`, background: "#fff" }}
                              >
                                跳转
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeSeat(idx);
                                  if (activeSeatIndex === idx) {
                                    setActiveSeatIndex(-1);
                                  }
                                }}
                                style={{
                                  padding: "5px 8px",
                                  cursor: "pointer",
                                  border: "none",
                                  background: THEME.danger,
                                  color: "#fff",
                                }}
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredSeatRows.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: "10px", color: THEME.muted }}>
                          未匹配到座位编号。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: "12px", padding: "10px", background: "#fff", border: `1px solid ${THEME.border}`, borderRadius: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <strong>离座计时监控（{area}）</strong>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                onClick={() => fetchRuntimeSeats(area)}
                disabled={isBusy}
                style={{ padding: "4px 8px", cursor: "pointer", border: `1px solid ${THEME.border}`, background: "#fff" }}
              >
                刷新
              </button>
              <button
                onClick={handleResetTimerByArea}
                disabled={isBusy}
                style={{ padding: "4px 8px", cursor: "pointer", border: "none", background: THEME.primary, color: "#fff" }}
              >
                {busyAction === "reset-area-timer" ? "重置中..." : "重置本区域计时"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={resetSeatNumber}
              onChange={(e) => setResetSeatNumber(e.target.value)}
              placeholder="输入座位号，如 A12"
              style={{ width: "180px", padding: "6px 8px", border: `1px solid ${THEME.border}`, borderRadius: "6px" }}
            />
            <button
              onClick={handleResetTimerBySeat}
              disabled={isBusy}
              style={{ padding: "6px 10px", cursor: "pointer", border: "none", background: THEME.success, color: "#fff" }}
            >
              {busyAction === "reset-seat-timer" ? "重置中..." : "重置该座位计时"}
            </button>
          </div>

          {timerRows.length === 0 ? (
            <div style={{ marginTop: "6px", color: THEME.muted, fontSize: "13px" }}>
              当前区域暂无“人离开且桌面有物品”的计时座位。
            </div>
          ) : (
            <div style={{ marginTop: "8px", display: "grid", gap: "6px" }}>
              {timerRows.map((row) => (
                <div
                  key={`timer-${row.seatId}`}
                  style={{
                    border: `1px solid ${row.overtime ? THEME.danger : THEME.border}`,
                    borderRadius: "6px",
                    padding: "8px",
                    background: row.overtime ? "#fff4f2" : "#f9f9f7",
                    fontSize: "13px",
                    color: THEME.text,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{row.seatNumber}</div>
                  <div>离座已持续：{row.elapsedText}</div>
                  <div style={{ color: row.overtime ? THEME.danger : THEME.muted }}>
                    {row.overtime ? `已超时：${row.overText}` : `距离超时还剩：${row.remainText}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: "12px" }}>
          <strong>前端监控视频</strong>
          <div
            style={{
              marginTop: "8px",
              width: "100%",
              maxWidth: "calc((100% - 12px) / 2)",
            }}
          >
            {monitorVideoUrl ? (
              <>
                <video
                  controls
                  autoPlay
                  muted
                  playsInline
                  style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: "6px" }}
                  onError={() => {
                    setMonitorVideoError("视频加载失败：资源可能尚未生成完成或路径不可访问，请点击“刷新最近检测结果”后重试。");
                  }}
                  src={/^https?:\/\//i.test(monitorVideoUrl) ? monitorVideoUrl : `http://localhost:5000${monitorVideoUrl}`} 
                />
                {monitorVideoError && (
                  <div style={{ marginTop: "8px", color: THEME.danger, fontSize: "13px" }}>
                    {monitorVideoError}
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: "12px", border: `1px dashed ${THEME.border}`, borderRadius: "6px", color: THEME.muted }}>
                暂无检测视频。请先完成“确认并保存座位配置”，再点击“运行占座检测”。
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: "12px", padding: "10px", background: "#fff", border: `1px solid ${THEME.border}`, borderRadius: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
            <strong>占座检测结果</strong>
            <span style={{ color: THEME.muted, fontSize: "13px" }}>
              {latestOccupation?.detectedAt ? `检测时间：${new Date(latestOccupation.detectedAt).toLocaleString("zh-CN")}` : "暂无检测记录"}
            </span>
          </div>
          {latestOccupation ? (
            <>
              <div style={{ marginTop: "6px", color: THEME.text, fontSize: "14px" }}>
                异常占座座位ID：
                {Array.isArray(latestOccupation?.occupiedSeatIds) && latestOccupation.occupiedSeatIds.length > 0
                  ? latestOccupation.occupiedSeatIds.join(", ")
                  : "无"}
              </div>
              <div style={{ marginTop: "4px", color: THEME.muted, fontSize: "13px" }}>
                模型：人 {latestOccupation?.models?.person || "best.pt"}；物品 {latestOccupation?.models?.item || "yolov8n.pt"}
              </div>
              {latestOccupation?.videoMeta && (
                <div style={{ marginTop: "4px", color: THEME.muted, fontSize: "13px" }}>
                  视频信息：{latestOccupation.videoMeta.framesWritten || 0} 帧，
                  {latestOccupation.videoMeta.fps || 0} FPS，
                  时长约 {latestOccupation.videoMeta.durationSec || 0} 秒
                </div>
              )}
            </>
          ) : (
            <div style={{ marginTop: "6px", color: THEME.muted, fontSize: "13px" }}>
              暂无可展示结果。请先运行占座检测并等待监控视频生成完成。
            </div>
          )}
        </div>

        {/* simulated-samples UI removed */}
      </div>
    </div>
  );
};

export default AdminSeatConfig;

