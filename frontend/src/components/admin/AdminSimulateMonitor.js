import React, { useState, useEffect, useRef } from "react";
import api from "../../services/api";

const API_BASE_URL = api?.defaults?.baseURL || "";
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const toBackendAssetUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const cleaned = rawUrl.trim().replace(/\\/g, "/");
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (!cleaned.startsWith("/")) return `${API_ORIGIN}/${cleaned}`;
  return `${API_ORIGIN}${cleaned}`;
};

// 与 AdminSeatConfig.js 保持一致的 THEME
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

const CONTROL_PANEL_STYLE = {
  ...HERO_STYLE,
  display: "flex",
  alignItems: "center",
  gap: "16px",
};

const BUTTON_STYLE = (disabled = false) => ({
  padding: "10px 18px",
  borderRadius: "8px",
  border: "none",
  fontWeight: 600,
  fontSize: "14px",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 0.3s ease",
  opacity: disabled ? 0.6 : 1,
});

const PRIMARY_BUTTON_STYLE = (disabled = false) => ({
  ...BUTTON_STYLE(disabled),
  background: THEME.primary,
  color: "#fff",
});

const DANGER_BUTTON_STYLE = (disabled = false) => ({
  ...BUTTON_STYLE(disabled),
  background: THEME.danger,
  color: "#fff",
});

const STATUS_INDICATOR_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  borderRadius: "8px",
  background: "rgba(255, 255, 255, 0.6)",
  border: `1px solid ${THEME.border}`,
};

const STATUS_DOT_STYLE = (isRunning) => ({
  width: "12px",
  height: "12px",
  borderRadius: "50%",
  background: isRunning ? THEME.success : THEME.danger,
  animation: isRunning ? "pulse 1s infinite" : "none",
});

const GRID_2COL_STYLE = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "16px",
  marginTop: "16px",
};

const GRID_3COL_STYLE = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "12px",
  marginTop: "12px",
};

const METRIC_CARD_STYLE = {
  padding: "16px",
  borderRadius: "10px",
  border: `1px solid ${THEME.border}`,
  background: "rgba(255, 255, 255, 0.85)",
  textAlign: "center",
};

const METRIC_VALUE_STYLE = {
  fontSize: "32px",
  fontWeight: 700,
  color: THEME.primary,
  marginBottom: "8px",
};

const METRIC_LABEL_STYLE = {
  fontSize: "12px",
  color: THEME.muted,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const SECTION_TITLE_STYLE = {
  fontSize: "16px",
  fontWeight: 700,
  color: THEME.text,
  marginBottom: "12px",
  paddingBottom: "8px",
  borderBottom: `2px solid ${THEME.primary}`,
};

const VIOLATION_LIST_STYLE = {
  maxHeight: "300px",
  overflowY: "auto",
  border: `1px solid ${THEME.border}`,
  borderRadius: "10px",
  background: "rgba(255, 255, 255, 0.85)",
};

const VIOLATION_ITEM_STYLE = {
  padding: "12px",
  borderBottom: `1px solid ${THEME.soft}`,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  "&:last-child": {
    borderBottom: "none",
  },
};

const VIOLATION_SEAT_STYLE = {
  fontWeight: 600,
  color: THEME.text,
};

const VIOLATION_DURATION_STYLE = {
  fontSize: "14px",
  fontWeight: 700,
  color: THEME.danger,
};

const LOG_CONSOLE_STYLE = {
  padding: "12px",
  borderRadius: "10px",
  background: "#0a0a0a",
  color: "#00ff00",
  fontFamily: '"Courier New", monospace',
  fontSize: "12px",
  lineHeight: "1.6",
  maxHeight: "300px",
  overflowY: "auto",
  border: `1px solid ${THEME.border}`,
};

const LOG_LINE_STYLE = {
  marginBottom: "4px",
  whiteSpace: "pre-wrap",
  wordWrap: "break-word",
};

const LIVE_PREVIEW_STYLE = {
  width: "100%",
  height: "auto",
  borderRadius: "10px",
  border: `2px solid ${THEME.border}`,
  background: "#f5f5f5",
  objectFit: "contain",
};

const CONFIG_TEXTAREA_STYLE = {
  width: "100%",
  minHeight: "180px",
  borderRadius: "8px",
  border: `1px solid ${THEME.border}`,
  padding: "10px",
  fontFamily: '"Courier New", monospace',
  fontSize: "12px",
  color: THEME.text,
  background: "#fff",
  resize: "vertical",
  boxSizing: "border-box",
};

const EDITOR_WRAP_STYLE = {
  position: "relative",
  width: "100%",
  border: `1px solid ${THEME.border}`,
  borderRadius: "10px",
  overflow: "hidden",
  background: "#fff",
};

const EDITOR_IMAGE_STYLE = {
  display: "block",
  width: "100%",
  height: "auto",
  userSelect: "none",
};

const AdminSimulateMonitor = () => {
  // 控制状态
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 模拟器数据
  const [simulateData, setSimulateData] = useState(null);
  const [statusHistory, setStatusHistory] = useState([]);
  const [livePreviewUrl, setLivePreviewUrl] = useState("");

  // UI 状态
  const [errorMsg, setErrorMsg] = useState("");
  const [lastUpdateTime, setLastUpdateTime] = useState(new Date());
  const [seatConfigPath, setSeatConfigPath] = useState("");
  const [seatConfigCount, setSeatConfigCount] = useState(0);
  const [seatConfigText, setSeatConfigText] = useState("");
  const [seatConfigSaving, setSeatConfigSaving] = useState(false);
  const [syncArea, setSyncArea] = useState("A区");
  const [syncPrefix, setSyncPrefix] = useState("A");
  const [syncingToDb, setSyncingToDb] = useState(false);
  const [detectingSeats, setDetectingSeats] = useState(false);
  const [uploadedImageFile, setUploadedImageFile] = useState(null);
  const [editorImageUrl, setEditorImageUrl] = useState("");
  const [editorBoxes, setEditorBoxes] = useState([]);
  const [editorNaturalSize, setEditorNaturalSize] = useState({ w: 1, h: 1 });
  const [editorDisplaySize, setEditorDisplaySize] = useState({ w: 1, h: 1 });
  const [drawingBox, setDrawingBox] = useState(null);
  const [selectedBoxIndex, setSelectedBoxIndex] = useState(-1);
  const [editorAction, setEditorAction] = useState(null);
  const editorImgRef = useRef(null);
  const statusFetchingRef = useRef(false);
  const latestSyncedSeqRef = useRef(-1);
  const previewSyncTokenRef = useRef(0);

  // 轮询控制
  const pollIntervalRef = useRef(null);

  // 时间同步：用于在前端实时跳秒显示 violation duration
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    // 每秒更新当前时间，用于计算 violation duration
    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchSeatConfig();
  }, []);

  const fetchSeatConfig = async () => {
    try {
      const resp = await api.get("/simulate/config");
      if (resp.data?.success) {
        const seats = Array.isArray(resp.data.seats) ? resp.data.seats : [];
        setSeatConfigPath(resp.data.seatConfigPath || "");
        setSeatConfigCount(Number(resp.data.seatCount || seats.length || 0));
        setSeatConfigText(JSON.stringify(seats, null, 2));
      }
    } catch (error) {
      setErrorMsg(error.response?.data?.error || "读取座位配置失败");
    }
  };

  const handleSaveSeatConfig = async () => {
    try {
      setSeatConfigSaving(true);
      setErrorMsg("");
      const parsed = JSON.parse(seatConfigText || "[]");
      if (!Array.isArray(parsed)) {
        setErrorMsg("座位配置必须是数组格式");
        return;
      }
      const resp = await api.put("/simulate/config", { seats: parsed });
      if (resp.data?.success) {
        setSeatConfigCount(Number(resp.data.seatCount || parsed.length));
        setStatusHistory((prev) => ["[配置] 座位配置已保存", ...prev.slice(0, 49)]);
      } else {
        setErrorMsg(resp.data?.error || "保存座位配置失败");
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setErrorMsg("座位配置 JSON 格式错误，请检查后重试");
      } else {
        setErrorMsg(error.response?.data?.error || error.message || "保存座位配置失败");
      }
    } finally {
      setSeatConfigSaving(false);
    }
  };

  const handleSaveAndSyncSeats = async () => {
    try {
      setSyncingToDb(true);
      setErrorMsg("");

      const parsed = JSON.parse(seatConfigText || "[]");
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setErrorMsg("请先确认至少一个座位框后再同步");
        return;
      }

      // 1) 先更新 simulate 使用的 seats.json
      const saveResp = await api.put("/simulate/config", { seats: parsed });
      if (!saveResp.data?.success) {
        setErrorMsg(saveResp.data?.error || "保存座位配置失败");
        return;
      }

      // 2) 再同步到座位地图/数据库（复用现有后端逻辑）
      const syncResp = await api.post("/confirm-seats", {
        area: String(syncArea || "A区").trim() || "A区",
        prefix: String(syncPrefix || "A").trim() || "A",
        seats: parsed,
        previewImageUrl: editorImageUrl || "",
      });

      const syncedArea = String(syncArea || "A区").trim() || "A区";
      window.dispatchEvent(new CustomEvent("seatConfigSynced", {
        detail: {
          area: syncedArea,
          prefix: String(syncPrefix || "A").trim() || "A",
          count: parsed.length,
        },
      }));

      setSeatConfigCount(Number(saveResp.data?.seatCount || parsed.length));
      setStatusHistory((prev) => {
        const msg = `[同步] 已同步 ${parsed.length} 个座位到区域 ${syncedArea}`;
        return [msg, ...prev.slice(0, 49)];
      });

      if (syncResp?.data?.message) {
        setStatusHistory((prev) => [String(syncResp.data.message), ...prev.slice(0, 49)]);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setErrorMsg("座位配置 JSON 格式错误，请检查后重试");
      } else {
        setErrorMsg(error.response?.data?.error || error.response?.data?.message || error.message || "同步到数据库失败");
      }
    } finally {
      setSyncingToDb(false);
    }
  };

  const syncBoxesToConfigText = (boxes) => {
    setSeatConfigText(JSON.stringify(boxes, null, 2));
    setSeatConfigCount(Array.isArray(boxes) ? boxes.length : 0);
  };

  const parseConfigAsBoxes = () => {
    try {
      const parsed = JSON.parse(seatConfigText || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((s) => Array.isArray(s) && s.length === 4)
        .map((s) => s.map((v) => Math.round(Number(v))))
        .filter((s) => s.every((v) => Number.isFinite(v)));
    } catch (e) {
      return [];
    }
  };

  const handleDetectSeatsFromImage = async () => {
    if (!uploadedImageFile) {
      setErrorMsg("请先选择一张图片");
      return;
    }
    try {
      setDetectingSeats(true);
      setErrorMsg("");
      const formData = new FormData();
      formData.append("image", uploadedImageFile);
      const resp = await api.post("/simulate/detect-seats-from-image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      if (!resp.data?.success) {
        setErrorMsg(resp.data?.error || "识别失败");
        return;
      }
      const chairs = Array.isArray(resp.data.chairs) ? resp.data.chairs : [];
      setEditorBoxes(chairs);
      syncBoxesToConfigText(chairs);
      setEditorImageUrl(toBackendAssetUrl(resp.data.uploadedImageUrl || resp.data.annotatedImageUrl || ""));
      setStatusHistory((prev) => [`[识别] 模型识别到 ${chairs.length} 个座位框`, ...prev.slice(0, 49)]);
    } catch (error) {
      if (error?.code === "ECONNABORTED") {
        setErrorMsg("识别超时（120秒）。可重试，或降低图片分辨率后再识别。");
      } else {
        setErrorMsg(error.response?.data?.error || error.message || "识别失败");
      }
    } finally {
      setDetectingSeats(false);
    }
  };

  const imageToDisplay = (box) => {
    const [x1, y1, x2, y2] = box;
    const sx = editorDisplaySize.w / Math.max(1, editorNaturalSize.w);
    const sy = editorDisplaySize.h / Math.max(1, editorNaturalSize.h);
    return [x1 * sx, y1 * sy, x2 * sx, y2 * sy];
  };

  const displayToImage = (box) => {
    const [x1, y1, x2, y2] = box;
    const sx = Math.max(1, editorNaturalSize.w) / Math.max(1, editorDisplaySize.w);
    const sy = Math.max(1, editorNaturalSize.h) / Math.max(1, editorDisplaySize.h);
    return [
      Math.round(x1 * sx),
      Math.round(y1 * sy),
      Math.round(x2 * sx),
      Math.round(y2 * sy),
    ];
  };

  const getLocalPoint = (evt) => {
    const rect = editorImgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
    return { x, y };
  };

  const clampDisplayBox = (box) => {
    const minSize = 8;
    const maxW = Math.max(1, editorDisplaySize.w);
    const maxH = Math.max(1, editorDisplaySize.h);
    let [x1, y1, x2, y2] = box;
    x1 = Math.max(0, Math.min(maxW, x1));
    y1 = Math.max(0, Math.min(maxH, y1));
    x2 = Math.max(0, Math.min(maxW, x2));
    y2 = Math.max(0, Math.min(maxH, y2));
    if (x2 - x1 < minSize) x2 = Math.min(maxW, x1 + minSize);
    if (y2 - y1 < minSize) y2 = Math.min(maxH, y1 + minSize);
    return [x1, y1, x2, y2];
  };

  const pointInRect = (p, rect) => p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2;

  const getHandleRects = (dispBox) => {
    const [x1, y1, x2, y2] = dispBox;
    const hs = 6;
    return {
      nw: { x1: x1 - hs, y1: y1 - hs, x2: x1 + hs, y2: y1 + hs },
      ne: { x1: x2 - hs, y1: y1 - hs, x2: x2 + hs, y2: y1 + hs },
      sw: { x1: x1 - hs, y1: y2 - hs, x2: x1 + hs, y2: y2 + hs },
      se: { x1: x2 - hs, y1: y2 - hs, x2: x2 + hs, y2: y2 + hs },
    };
  };

  const getDeleteRect = (dispBox) => {
    const [x1, y1, x2] = dispBox;
    const w = 16;
    return {
      x1: Math.max(0, x2 - w),
      y1: Math.max(0, y1),
      x2: Math.max(x1, x2),
      y2: Math.max(0, y1 + w),
    };
  };

  const pickBoxAtPoint = (p) => {
    for (let i = editorBoxes.length - 1; i >= 0; i -= 1) {
      const disp = imageToDisplay(editorBoxes[i]);
      const deleteRect = getDeleteRect(disp);
      if (pointInRect(p, deleteRect)) {
        return { index: i, mode: "delete" };
      }

      const handles = getHandleRects(disp);
      const handleKey = Object.keys(handles).find((k) => pointInRect(p, handles[k]));
      if (handleKey) {
        return { index: i, mode: "resize", handle: handleKey };
      }

      const [x1, y1, x2, y2] = disp;
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) {
        return { index: i, mode: "drag" };
      }
    }
    return null;
  };

  const updateBoxByDisplay = (index, dispBox) => {
    if (index < 0 || index >= editorBoxes.length) return;
    const clamped = clampDisplayBox(dispBox);
    const imageBox = displayToImage(clamped);
    const next = editorBoxes.map((b, i) => (i === index ? imageBox : b));
    setEditorBoxes(next);
    syncBoxesToConfigText(next);
  };

  const handleEditorMouseDown = (evt) => {
    if (!editorImageUrl) return;
    if (evt.button !== 0) return;
    const p = getLocalPoint(evt);

    const picked = pickBoxAtPoint(p);
    if (picked) {
      if (picked.mode === "delete") {
        const next = editorBoxes.filter((_, i) => i !== picked.index);
        setEditorBoxes(next);
        syncBoxesToConfigText(next);
        setSelectedBoxIndex(-1);
        return;
      }

      setSelectedBoxIndex(picked.index);
      const pickedDisplayBox = imageToDisplay(editorBoxes[picked.index]);
      setEditorAction({
        mode: picked.mode,
        handle: picked.handle || "",
        index: picked.index,
        startPoint: p,
        startBox: pickedDisplayBox,
      });
      return;
    }

    setSelectedBoxIndex(-1);
    setDrawingBox({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    setEditorAction({ mode: "draw" });
  };

  const handleEditorMouseMove = (evt) => {
    const p = getLocalPoint(evt);

    if (editorAction?.mode === "draw") {
      setDrawingBox((prev) => (prev ? { ...prev, x2: p.x, y2: p.y } : prev));
      return;
    }

    if (!editorAction || (editorAction.mode !== "drag" && editorAction.mode !== "resize")) {
      return;
    }

    const { startPoint, startBox, index, mode, handle } = editorAction;
    const dx = p.x - startPoint.x;
    const dy = p.y - startPoint.y;
    const [sx1, sy1, sx2, sy2] = startBox;

    if (mode === "drag") {
      const w = sx2 - sx1;
      const h = sy2 - sy1;
      let nx1 = sx1 + dx;
      let ny1 = sy1 + dy;
      nx1 = Math.max(0, Math.min(editorDisplaySize.w - w, nx1));
      ny1 = Math.max(0, Math.min(editorDisplaySize.h - h, ny1));
      updateBoxByDisplay(index, [nx1, ny1, nx1 + w, ny1 + h]);
      return;
    }

    let nx1 = sx1;
    let ny1 = sy1;
    let nx2 = sx2;
    let ny2 = sy2;
    if (handle === "nw") {
      nx1 = sx1 + dx;
      ny1 = sy1 + dy;
    } else if (handle === "ne") {
      nx2 = sx2 + dx;
      ny1 = sy1 + dy;
    } else if (handle === "sw") {
      nx1 = sx1 + dx;
      ny2 = sy2 + dy;
    } else if (handle === "se") {
      nx2 = sx2 + dx;
      ny2 = sy2 + dy;
    }
    updateBoxByDisplay(index, [Math.min(nx1, nx2), Math.min(ny1, ny2), Math.max(nx1, nx2), Math.max(ny1, ny2)]);
  };

  const handleEditorMouseUp = () => {
    if (editorAction?.mode === "draw" && drawingBox) {
      const x1 = Math.min(drawingBox.x1, drawingBox.x2);
      const y1 = Math.min(drawingBox.y1, drawingBox.y2);
      const x2 = Math.max(drawingBox.x1, drawingBox.x2);
      const y2 = Math.max(drawingBox.y1, drawingBox.y2);
      if (x2 - x1 >= 8 && y2 - y1 >= 8) {
        const imageBox = displayToImage([x1, y1, x2, y2]);
        const next = [...editorBoxes, imageBox];
        setEditorBoxes(next);
        syncBoxesToConfigText(next);
        setSelectedBoxIndex(next.length - 1);
      }
    }
    setDrawingBox(null);
    setEditorAction(null);
  };

  const handleApplyConfigToEditor = () => {
    const parsed = parseConfigAsBoxes();
    setEditorBoxes(parsed);
    setSeatConfigCount(parsed.length);
    setSelectedBoxIndex(-1);
  };

  const handleUndoLastBox = () => {
    if (editorBoxes.length === 0) return;
    const next = editorBoxes.slice(0, -1);
    setEditorBoxes(next);
    syncBoxesToConfigText(next);
    setSelectedBoxIndex(next.length - 1);
  };

  const handleClearBoxes = () => {
    setEditorBoxes([]);
    syncBoxesToConfigText([]);
    setSelectedBoxIndex(-1);
  };

  useEffect(() => {
    const onKeyDown = (evt) => {
      const active = document.activeElement;
      const tag = String(active?.tagName || "").toLowerCase();
      const editing = tag === "input" || tag === "textarea" || Boolean(active?.isContentEditable);
      if (editing) return;
      if (selectedBoxIndex < 0 || selectedBoxIndex >= editorBoxes.length) return;
      if (evt.key !== "Delete" && evt.key !== "Backspace") return;

      evt.preventDefault();
      const next = editorBoxes.filter((_, i) => i !== selectedBoxIndex);
      setEditorBoxes(next);
      syncBoxesToConfigText(next);
      setSelectedBoxIndex(next.length ? Math.min(selectedBoxIndex, next.length - 1) : -1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorBoxes, selectedBoxIndex]);

  /**
   * 启动模拟采样
   */
  const handleStartSimulation = async () => {
    try {
      setIsLoading(true);
      setErrorMsg("");
      const resp = await api.post("/simulate/start");
      if (resp.data?.success) {
        setIsRunning(true);
        setStatusHistory(["[启动] 模拟采样已启动"]);
        // 启动轮询
        startPolling();
      } else {
        setErrorMsg(resp.data?.error || "启动失败");
      }
    } catch (error) {
      console.error("启动模拟采样失败:", error);
      setErrorMsg(error.response?.data?.error || error.message || "启动失败");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 停止模拟采样
   */
  const handleStopSimulation = async () => {
    try {
      setIsLoading(true);
      setErrorMsg("");
      const resp = await api.post("/simulate/stop");
      if (resp.data?.success) {
        setIsRunning(false);
        stopPolling();
        setStatusHistory((prev) => [...prev, "[停止] 模拟采样已停止"]);
      } else {
        setErrorMsg(resp.data?.error || "停止失败");
      }
    } catch (error) {
      console.error("停止模拟采样失败:", error);
      setErrorMsg(error.response?.data?.error || error.message || "停止失败");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 启动轮询
   */
  const startPolling = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(fetchSimulateStatus, 3000); // 每3秒轮询一次
  };

  /**
   * 停止轮询
   */
  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const syncStatusWithPreview = (statusData) => {
    if (!statusData || typeof statusData !== "object") return;

    const frameIdRaw = Number(
      statusData?.debugImageFrameId ?? statusData?.status?.frameId,
    );
    const syncSeqRaw = Number(statusData?.status?.processedFrames);
    const hasSyncSeq = Number.isFinite(syncSeqRaw) && syncSeqRaw >= 0;
    const syncSeq = hasSyncSeq ? Math.floor(syncSeqRaw) : -1;
    const hasFrameId = Number.isFinite(frameIdRaw) && frameIdRaw >= 0;
    const frameId = hasFrameId ? Math.floor(frameIdRaw) : -1;

    setIsRunning(Boolean(statusData?.isRunning));

    const rawDebugUrl = statusData?.debugImageUrl;
    if (!rawDebugUrl) {
      setSimulateData(statusData);
      setLastUpdateTime(new Date());
      return;
    }

    const resolved = toBackendAssetUrl(rawDebugUrl);
    const sep = resolved.includes("?") ? "&" : "?";
    const syncParam = hasSyncSeq
      ? `syncSeq=${syncSeq}`
      : (hasFrameId ? `frameId=${frameId}` : `t=${Date.now()}`);
    const previewUrl = `${resolved}${sep}${syncParam}`;

    if (!hasSyncSeq) {
      setLivePreviewUrl(previewUrl);
      setSimulateData(statusData);
      setLastUpdateTime(new Date());
      return;
    }

    const token = previewSyncTokenRef.current + 1;
    previewSyncTokenRef.current = token;
    const img = new window.Image();

    img.onload = () => {
      if (token !== previewSyncTokenRef.current) return;
      if (syncSeq < latestSyncedSeqRef.current) return;
      latestSyncedSeqRef.current = syncSeq;
      setLivePreviewUrl(previewUrl);
      setSimulateData(statusData);
      setLastUpdateTime(new Date());
    };

    img.onerror = () => {
      if (token !== previewSyncTokenRef.current) return;
      if (syncSeq < latestSyncedSeqRef.current) return;
      // 图片偶发加载失败时仍推进状态，避免界面卡住。
      latestSyncedSeqRef.current = syncSeq;
      setLivePreviewUrl(previewUrl);
      setSimulateData(statusData);
      setLastUpdateTime(new Date());
    };

    img.src = previewUrl;
  };

  /**
   * 获取模拟器状态
   */
  const fetchSimulateStatus = async () => {
    if (statusFetchingRef.current) return;
    try {
      statusFetchingRef.current = true;
      const resp = await api.get("/simulate/status");
      if (resp.data) {
        syncStatusWithPreview(resp.data);

        // 添加日志条目
        if (resp.data.lastDetection) {
          const timestamp = new Date().toLocaleTimeString();
          const processedFrames = resp.data.lastDetection.processedFrames || 0;
          const occupiedCount = resp.data.lastDetection.occupiedCount || 0;
          const abnormalCount = resp.data.lastDetection.abnormalCount || 0;
          const timingCount = resp.data.lastDetection.timingCount || 0;
          const violationCount = resp.data.lastDetection.violationCount || 0;
          const logLine = `[${timestamp}] Frame ${String(processedFrames).padStart(4, "0")} - Occupied: ${occupiedCount}, Abnormal: ${abnormalCount}, Timing: ${timingCount}, Violations: ${violationCount}`;
          
          // 检查是否是新的日志（避免重复添加）
          setStatusHistory((prev) => {
            if (prev.length > 0 && prev[0] === logLine) {
              return prev; // 避免重复添加相同的日志
            }
            return [logLine, ...prev.slice(0, 49)]; // 保留最近50条
          });
        }
      }
    } catch (error) {
      console.error("获取模拟器状态失败:", error);
      // 继续轮询，避免一次失败就停止
    } finally {
      statusFetchingRef.current = false;
    }
  };

  // 页面切换回来后自动恢复状态：如果后端仍在运行，则恢复轮询与画面
  useEffect(() => {
    let alive = true;

    const recoverStatus = async () => {
      try {
        const resp = await api.get("/simulate/status");
        if (!alive) return;

        const running = Boolean(resp.data?.isRunning);
        setIsRunning(running);

        if (resp.data) {
          syncStatusWithPreview(resp.data);
        }

        if (running) {
          startPolling();
        } else {
          stopPolling();
        }
      } catch (_err) {
        // /status 失败时不打断页面，保持静默
      }
    };

    recoverStatus();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchSimulateStatus();
      }
    };

    const onFocus = () => {
      fetchSimulateStatus();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // 清理轮询
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  /**
   * 计算 violation 的持续时长（秒）
   */
  const calculateViolationDuration = (violationStartTime) => {
    if (!violationStartTime) return 0;
    const startMs = typeof violationStartTime === "number"
      ? (violationStartTime > 1e12 ? violationStartTime : violationStartTime * 1000)
      : new Date(violationStartTime).getTime();
    return Math.max(0, Math.floor((nowTs - startMs) / 1000));
  };

  /**
   * 格式化时长为 MM:SS 或 HH:MM:SS
   */
  const formatDuration = (seconds) => {
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (v) => String(v).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  const formatDateTime = (value) => {
    if (!value) return "-";
    const ts = typeof value === "number"
      ? (value > 1e12 ? value : value * 1000)
      : new Date(value).getTime();
    if (!Number.isFinite(ts) || ts <= 0) return "-";
    return new Date(ts).toLocaleTimeString();
  };

  const seatAssessment = Array.isArray(simulateData?.seatAssessment) ? simulateData.seatAssessment : [];
  const abnormalSeats = seatAssessment.length > 0
    ? seatAssessment.filter((seat) => seat?.isAbnormal)
    : (Array.isArray(simulateData?.abnormalSeatIndices)
      ? simulateData.abnormalSeatIndices.map((seatIndex) => ({
          seatIndex,
          seatNumber: `座位 ${Number(seatIndex) + 1}`,
        }))
      : []);
  const timingSeats = seatAssessment
    .filter((seat) => seat?.withTimer && Number.isFinite(Number(seat?.leaveTimerStartTime)))
    .map((seat) => ({
      seatIndex: Number(seat.seatIndex),
      seatNumber: seat.seatNumber ? `座位 ${seat.seatNumber}` : `座位 ${Number(seat.seatIndex) + 1}`,
      startTime: Number(seat.leaveTimerStartTime),
      duration: calculateViolationDuration(Number(seat.leaveTimerStartTime)),
    }))
    .sort((a, b) => b.duration - a.duration);
  const timerRecords = Array.isArray(simulateData?.leaveTimerRecords)
    ? simulateData.leaveTimerRecords.map((record, idx) => {
        const startTime = Number(record?.startTime || 0);
        const endTime = record?.endTime ? Number(record.endTime) : null;
        const duration = Number.isFinite(Number(record?.durationSeconds))
          ? Number(record.durationSeconds)
          : (endTime ? Math.max(0, Math.floor((endTime - startTime) / 1000)) : calculateViolationDuration(startTime));
        return {
          key: `${record?.seatId || 'seat'}-${startTime}-${idx}`,
          seatNumber: record?.seatNumber ? `座位 ${record.seatNumber}` : `座位 ${Number(record?.seatIndex) + 1}`,
          area: record?.area || "",
          state: record?.state || "active",
          isViolation: Boolean(record?.isViolation),
          startTime,
          endTime,
          duration,
        };
      })
    : timingSeats.map((seat) => ({
        key: `fallback-${seat.seatIndex}`,
        seatNumber: seat.seatNumber,
        area: "",
        state: "active",
        isViolation: false,
        startTime: seat.startTime,
        endTime: null,
        duration: seat.duration,
      }));

  // 获取违规座位列表
  const violationSeats = simulateData?.violationTimes
    ? Object.entries(simulateData.violationTimes)
        .map(([seatIndex, violation]) => ({
          seatIndex: parseInt(seatIndex, 10),
          seatNumber: `座位 ${parseInt(seatIndex, 10) + 1}`,
          startTime: violation.startTime,
          duration: calculateViolationDuration(violation.startTime),
        }))
        .sort((a, b) => b.duration - a.duration) // 按时长降序
    : seatAssessment
        .filter((seat) => seat?.isViolation)
        .map((seat) => {
          const fallbackStartTime = Number(seat?.violationStartTime || seat?.leaveTimerStartTime || Date.now());
          return {
            seatIndex: Number(seat?.seatIndex),
            seatNumber: seat?.seatNumber ? `座位 ${seat.seatNumber}` : `座位 ${Number(seat?.seatIndex) + 1}`,
            startTime: fallbackStartTime,
            duration: calculateViolationDuration(fallbackStartTime),
          };
        })
        .sort((a, b) => b.duration - a.duration);

  const totalSeats = simulateData?.seatStates?.length || 0;
  const occupiedCount = simulateData?.occupiedIndices?.length || 0;
  const abnormalCount = abnormalSeats.length;
  const violationCount = violationSeats.length;

  return (
    <div style={PAGE_STYLE}>
      {/* 添加脉冲动画样式 */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .log-console::-webkit-scrollbar {
          width: 6px;
        }
        .log-console::-webkit-scrollbar-track {
          background: #1a1a1a;
        }
        .log-console::-webkit-scrollbar-thumb {
          background: #00ff00;
          border-radius: 3px;
        }
      `}</style>

      {/* ====== 页面标题 ====== */}
      <div style={HERO_STYLE}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>
          🎥 实时模拟采样监控
        </h1>
        <p style={{ margin: "8px 0 0 0", fontSize: "13px", color: THEME.muted }}>
          通过图片文件夹循环进行座位监控模拟，实时展示检测结果和违规统计
        </p>
      </div>

      {/* ====== 模拟控制中心 ====== */}
      <div style={CONTROL_PANEL_STYLE}>
        <button
          style={PRIMARY_BUTTON_STYLE(isRunning || isLoading)}
          onClick={handleStartSimulation}
          disabled={isRunning || isLoading}
        >
          {isLoading && isRunning === false ? "启动中..." : "▶ 启动模拟采样"}
        </button>

        <button
          style={DANGER_BUTTON_STYLE(!isRunning || isLoading)}
          onClick={handleStopSimulation}
          disabled={!isRunning || isLoading}
        >
          {isLoading && isRunning ? "停止中..." : "⏹ 停止"}
        </button>

        <div style={STATUS_INDICATOR_STYLE}>
          <div style={STATUS_DOT_STYLE(isRunning)} />
          <span style={{ fontSize: "13px", fontWeight: 600 }}>
            {isRunning ? "正在运行" : "已停止"}
          </span>
        </div>


        {lastUpdateTime && (
          <span style={{ fontSize: "12px", color: THEME.muted, marginLeft: "auto" }}>
            最后更新: {lastUpdateTime.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div
          style={{
            marginTop: "12px",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(183, 138, 132, 0.1)",
            color: THEME.danger,
            fontSize: "13px",
            border: `1px solid ${THEME.danger}`,
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      <div style={{ ...HERO_STYLE, marginTop: "12px" }}>
        <h2 style={SECTION_TITLE_STYLE}>⚙️ 模拟座位配置</h2>
        <div style={{ fontSize: "12px", color: THEME.muted, marginBottom: "8px" }}>
          当前使用配置文件：<code>{seatConfigPath || "(未加载)"}</code>
        </div>
        <div style={{ fontSize: "12px", color: THEME.muted, marginBottom: "10px" }}>
          当前座位数量：{seatConfigCount}
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setUploadedImageFile(e.target.files?.[0] || null)}
          />
          <button
            style={PRIMARY_BUTTON_STYLE(detectingSeats || !uploadedImageFile)}
            disabled={detectingSeats || !uploadedImageFile}
            onClick={handleDetectSeatsFromImage}
          >
            {detectingSeats ? "识别中..." : "上传图片并模型识别"}
          </button>
          <button
            style={{ ...BUTTON_STYLE(false), background: "#fff", border: `1px solid ${THEME.border}` }}
            onClick={handleApplyConfigToEditor}
          >
            从下方JSON载入编辑器
          </button>
        </div>

        <div style={{ fontSize: "12px", color: THEME.muted, marginBottom: "8px" }}>
          操作说明：拖拽空白处可新增框；点击框右上角“×”可删除；拖动框体可移动，拖动四角可缩放。
        </div>

        <div
          style={EDITOR_WRAP_STYLE}
          onMouseDown={handleEditorMouseDown}
          onMouseMove={handleEditorMouseMove}
          onMouseUp={handleEditorMouseUp}
          onMouseLeave={handleEditorMouseUp}
        >
          {editorImageUrl ? (
            <>
              <img
                ref={editorImgRef}
                src={editorImageUrl}
                alt="座位编辑底图"
                style={EDITOR_IMAGE_STYLE}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setEditorNaturalSize({ w: el.naturalWidth || 1, h: el.naturalHeight || 1 });
                  setEditorDisplaySize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
                }}
              />
              <svg
                width={editorDisplaySize.w}
                height={editorDisplaySize.h}
                style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
              >
                {editorBoxes.map((box, idx) => {
                  const [x1, y1, x2, y2] = imageToDisplay(box);
                  const w = Math.max(1, x2 - x1);
                  const h = Math.max(1, y2 - y1);
                  const selected = idx === selectedBoxIndex;
                  const deleteRect = getDeleteRect([x1, y1, x2, y2]);
                  const handleRects = getHandleRects([x1, y1, x2, y2]);
                  return (
                    <g key={`${idx}-${box.join('-')}`}>
                      <rect
                        x={x1}
                        y={y1}
                        width={w}
                        height={h}
                        fill="none"
                        stroke={selected ? "#7f95a6" : "#d33"}
                        strokeWidth={selected ? "3" : "2"}
                      />
                      <text
                        x={x1 + 4}
                        y={Math.max(14, y1 - 4)}
                        fill={selected ? "#7f95a6" : "#d33"}
                        fontSize="12"
                      >
                        {`S${idx + 1}`}
                      </text>
                      {selected && (
                        <>
                          {Object.values(handleRects).map((r, i) => (
                            <rect
                              key={`h-${idx}-${i}`}
                              x={r.x1}
                              y={r.y1}
                              width={Math.max(1, r.x2 - r.x1)}
                              height={Math.max(1, r.y2 - r.y1)}
                              fill="#7f95a6"
                            />
                          ))}
                          <rect
                            x={deleteRect.x1}
                            y={deleteRect.y1}
                            width={Math.max(1, deleteRect.x2 - deleteRect.x1)}
                            height={Math.max(1, deleteRect.y2 - deleteRect.y1)}
                            fill="#b78a84"
                          />
                          <text
                            x={deleteRect.x1 + 4}
                            y={deleteRect.y1 + 12}
                            fill="#fff"
                            fontSize="12"
                            fontWeight="700"
                          >
                            ×
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}
                {drawingBox && (
                  <rect
                    x={Math.min(drawingBox.x1, drawingBox.x2)}
                    y={Math.min(drawingBox.y1, drawingBox.y2)}
                    width={Math.abs(drawingBox.x2 - drawingBox.x1)}
                    height={Math.abs(drawingBox.y2 - drawingBox.y1)}
                    fill="rgba(127,149,166,0.15)"
                    stroke="#7f95a6"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                  />
                )}
              </svg>
            </>
          ) : (
            <div style={{ padding: "28px", textAlign: "center", color: THEME.muted, fontSize: "13px" }}>
              先上传一张图片，识别后即可在此画框
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
          <button
            style={{ ...BUTTON_STYLE(editorBoxes.length === 0), background: "#fff", border: `1px solid ${THEME.border}` }}
            disabled={editorBoxes.length === 0}
            onClick={handleUndoLastBox}
          >
            撤销最后一个框
          </button>
          <button
            style={{ ...BUTTON_STYLE(editorBoxes.length === 0), background: "#fff", border: `1px solid ${THEME.border}` }}
            disabled={editorBoxes.length === 0}
            onClick={handleClearBoxes}
          >
            清空所有框
          </button>
        </div>

        <textarea
          value={seatConfigText}
          onChange={(e) => setSeatConfigText(e.target.value)}
          style={CONFIG_TEXTAREA_STYLE}
          placeholder="请粘贴座位配置 JSON，例如 [[x1,y1,x2,y2], ...]"
        />
        <div style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: "12px", color: THEME.muted }}>
            区域：
            <input
              value={syncArea}
              onChange={(e) => setSyncArea(e.target.value)}
              style={{ marginLeft: "6px", padding: "6px", borderRadius: "6px", border: `1px solid ${THEME.border}` }}
              placeholder="如 A区"
            />
          </label>
          <label style={{ fontSize: "12px", color: THEME.muted }}>
            前缀：
            <input
              value={syncPrefix}
              onChange={(e) => setSyncPrefix(e.target.value)}
              style={{ marginLeft: "6px", padding: "6px", borderRadius: "6px", border: `1px solid ${THEME.border}` }}
              placeholder="如 A"
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <button
            style={PRIMARY_BUTTON_STYLE(seatConfigSaving || isRunning)}
            disabled={seatConfigSaving || isRunning}
            onClick={handleSaveSeatConfig}
            title={isRunning ? "请先停止模拟再保存配置" : "保存配置"}
          >
            {seatConfigSaving ? "保存中..." : "保存座位配置"}
          </button>
          <button
            style={{ ...PRIMARY_BUTTON_STYLE(syncingToDb || isRunning), background: THEME.success }}
            disabled={syncingToDb || isRunning}
            onClick={handleSaveAndSyncSeats}
            title={isRunning ? "请先停止模拟再同步" : "保存并同步到座位地图/数据库"}
          >
            {syncingToDb ? "同步中..." : "保存并同步到座位地图"}
          </button>
          <button
            style={{ ...BUTTON_STYLE(false), background: "#fff", border: `1px solid ${THEME.border}` }}
            onClick={fetchSeatConfig}
          >
            重新加载配置
          </button>
        </div>
      </div>

      {/* ====== 实时画面监控和数据仪表板 ====== */}
      <div style={GRID_2COL_STYLE}>
        {/* 左列：实时画面监控 */}
        <div>
          <div style={HERO_STYLE}>
            <h2 style={SECTION_TITLE_STYLE}>📸 实时画面监控</h2>
            {livePreviewUrl ? (
              <img
                src={livePreviewUrl}
                alt="实时监控画面"
                style={LIVE_PREVIEW_STYLE}
                onError={() => {
                  // 图片加载失败时显示占位符
                }}
              />
            ) : (
              <div
                style={{
                  ...LIVE_PREVIEW_STYLE,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "400px",
                  background: "#f5f5f5",
                  color: THEME.muted,
                  fontSize: "14px",
                }}
              >
                {isRunning ? "等待第一帧画面..." : "点击启动以显示实时画面"}
              </div>
            )}
            <div style={{ marginTop: "8px", fontSize: "12px", color: THEME.muted }}>
              💡 每3秒自动刷新一次画面
            </div>
          </div>
        </div>

        {/* 右列：数据仪表板 */}
        <div>
          {/* 实时统计卡片 */}
          <div style={HERO_STYLE}>
            <h2 style={SECTION_TITLE_STYLE}>📊 实时统计</h2>
            <div style={GRID_3COL_STYLE}>
              <div style={METRIC_CARD_STYLE}>
                <div style={METRIC_VALUE_STYLE}>{totalSeats}</div>
                <div style={METRIC_LABEL_STYLE}>总座位数</div>
              </div>
              <div style={METRIC_CARD_STYLE}>
                <div style={{ ...METRIC_VALUE_STYLE, color: THEME.success }}>
                  {occupiedCount}
                </div>
                <div style={METRIC_LABEL_STYLE}>占用中</div>
              </div>
              <div style={METRIC_CARD_STYLE}>
                <div style={{ ...METRIC_VALUE_STYLE, color: THEME.danger }}>
                  {abnormalCount}
                </div>
                <div style={METRIC_LABEL_STYLE}>异常占座</div>
              </div>
            </div>
          </div>

          {/* 违规滚动列表 */}
          <div style={{ ...HERO_STYLE, marginTop: "16px" }}>
            <h2 style={SECTION_TITLE_STYLE}>⏱ 离座计时记录</h2>
            {timerRecords.length > 0 ? (
              <div style={VIOLATION_LIST_STYLE}>
                {timerRecords.map((timerSeat, idx) => (
                  <div
                    key={timerSeat.key}
                    style={{
                      ...VIOLATION_ITEM_STYLE,
                      padding: "12px",
                      borderBottom:
                        idx < timerRecords.length - 1 ? `1px solid ${THEME.soft}` : "none",
                    }}
                  >
                    <span style={VIOLATION_SEAT_STYLE}>
                      {timerSeat.seatNumber}
                      {timerSeat.area ? ` (${timerSeat.area})` : ""}
                    </span>
                    <span style={VIOLATION_DURATION_STYLE}>
                      {formatDuration(timerSeat.duration)}
                    </span>
                    <span style={{ fontSize: "12px", color: THEME.muted }}>
                      {formatDateTime(timerSeat.startTime)} - {timerSeat.endTime ? formatDateTime(timerSeat.endTime) : "进行中"}
                    </span>
                    <span style={{ fontSize: "12px", color: timerSeat.isViolation ? THEME.danger : THEME.success }}>
                      {timerSeat.isViolation ? "已违规" : (timerSeat.state === "active" ? "计时中" : "已结束")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: THEME.muted,
                  fontSize: "13px",
                }}
              >
                当前无离座计时中的座位
              </div>
            )}
          </div>

          {/* 违规滚动列表 */}
          <div style={{ ...HERO_STYLE, marginTop: "16px" }}>
            <h2 style={SECTION_TITLE_STYLE}>⚠️ 违规座位</h2>
            {violationSeats.length > 0 ? (
              <div style={VIOLATION_LIST_STYLE}>
                {violationSeats.map((violation, idx) => (
                  <div
                    key={idx}
                    style={{
                      ...VIOLATION_ITEM_STYLE,
                      padding: "12px",
                      borderBottom:
                        idx < violationSeats.length - 1 ? `1px solid ${THEME.soft}` : "none",
                    }}
                  >
                    <span style={VIOLATION_SEAT_STYLE}>{violation.seatNumber}</span>
                    <span style={VIOLATION_DURATION_STYLE}>
                      {formatDuration(violation.duration)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: "32px",
                  textAlign: "center",
                  color: THEME.muted,
                  fontSize: "13px",
                }}
              >
                ✨ 暂无违规座位
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====== 采样日志控制台 ====== */}
      <div style={{ ...HERO_STYLE, marginTop: "16px" }}>
        <h2 style={SECTION_TITLE_STYLE}>📝 采样日志</h2>
        <div style={LOG_CONSOLE_STYLE} className="log-console">
          {statusHistory.length > 0 ? (
            statusHistory.map((line, idx) => (
              <div key={idx} style={LOG_LINE_STYLE}>
                {line}
              </div>
            ))
          ) : (
            <div style={LOG_LINE_STYLE}>$ 等待日志输出...</div>
          )}
        </div>
        <div style={{ marginTop: "8px", fontSize: "12px", color: THEME.muted }}>
          💡 显示最近50条采样记录
        </div>
      </div>

      {/* ====== 原始数据面板（仅用于调试） ====== */}
      {simulateData && (
        <div style={{ ...HERO_STYLE, marginTop: "16px" }}>
          <h2 style={SECTION_TITLE_STYLE}>🔧 原始数据（调试）</h2>
          <pre
            style={{
              background: "#f5f5f5",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "11px",
              overflow: "auto",
              maxHeight: "200px",
              color: THEME.text,
            }}
          >
            {JSON.stringify(simulateData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default AdminSimulateMonitor;


