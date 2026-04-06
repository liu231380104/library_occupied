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
  const [videoPath, setVideoPath] = useState(
    "D:\\third_year_of_university\\project\\2\\library_occupied\\v1.mp4",
  );
  const [frame, setFrame] = useState(0);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [monitorVideoUrl, setMonitorVideoUrl] = useState("");
  const [monitorVideoError, setMonitorVideoError] = useState("");
  const [latestOccupation, setLatestOccupation] = useState(null);
  const [seats, setSeats] = useState([]);
  const [area, setArea] = useState("A区");
  const [prefix, setPrefix] = useState("A");
  const [busyAction, setBusyAction] = useState("");
  const [generateTaskStatus, setGenerateTaskStatus] = useState("");
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

  useEffect(() => {
    fetchLatestOccupationResult();
  }, []);

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
    try {
      setBusyAction("occupy-detect");
      const resp = await api.post(
        "/detect-occupation",
        { videoPath, area, saveVideo: true },
        { timeout: 300000 },
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

      alert(`占座检测完成，异常占座 ${result.occupiedSeatIds?.length || 0} 个`);
    } catch (err) {
      console.error("Detect occupation error:", err);
      if (err.code === "ECONNABORTED") {
        alert("占座检测超时，请缩短视频长度或稍后重试");
        return;
      }
      alert(err.response?.data?.error || "占座检测失败");
    } finally {
      setBusyAction("");
    }
  };

  const isBusy = Boolean(busyAction);

  useEffect(() => {
    const onUp = () => setDragging(null);
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const handleGenerateSeats = async () => {
    try {
      setBusyAction("generating");
      setGenerateTaskStatus("任务创建中...");

      const createResp = await api.post("/generate-seats/tasks", {
        videoPath,
        frame,
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
      const cleanPreviewImageUrl = previewImageUrl
        ? previewImageUrl.split("?")[0]
        : "";
      const resp = await api.post("/confirm-seats", {
        area,
        prefix,
        seats,
        videoPath,
        frame,
        previewImageUrl: cleanPreviewImageUrl,
        sourceVideo: lastSeatSourceVideo,
      });
      alert(resp.data?.message || "座位已确认并保存");
    } catch (err) {
      console.error("Confirm seats error:", err);
      alert(err.response?.data?.error || "确认座位失败");
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

  return (
    <div>
      <h2>视频座位配置</h2>
      <div
        style={{
          border: `1px solid ${THEME.border}`,
          borderRadius: "8px",
          padding: "14px",
          marginBottom: "20px",
          background: THEME.panel,
        }}
      >
        <h3 style={{ marginTop: 0 }}>视频座位配置（测试）</h3>
        <p style={{ marginTop: 0, color: THEME.muted }}>
          先从视频识别座位，管理员确认或修改后，保存到 seats.json 和数据库。
        </p>

        <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
          <input
            style={{ flex: 1, minWidth: "360px", padding: "8px" }}
            value={videoPath}
            onChange={(e) => setVideoPath(e.target.value)}
            placeholder="测试视频路径"
          />
          <input
            type="number"
            min={0}
            style={{ width: "120px", padding: "8px" }}
            value={frame}
            onChange={(e) => setFrame(Number(e.target.value) || 0)}
            placeholder="帧号"
            title="0 表示第一帧"
          />
          <button
            onClick={handleGenerateSeats}
            disabled={isBusy}
            style={{ padding: "8px 12px", cursor: "pointer" }}
          >
            {busyAction === "generating" ? "识别中..." : "1. 识别座位"}
          </button>
          <button
            onClick={handleRunOccupationDetection}
            disabled={isBusy}
            style={{ padding: "8px 12px", cursor: "pointer", background: THEME.accent, color: "#fff", border: "none" }}
          >
            {busyAction === "occupy-detect" ? "检测中..." : "运行占座检测并更新举报中心"}
          </button>
          <button
            onClick={fetchLatestOccupationResult}
            disabled={isBusy}
            style={{ padding: "8px 12px", cursor: "pointer" }}
          >
            刷新最近检测结果
          </button>
        </div>

        <div style={{ marginBottom: "12px", padding: "10px", background: "#fff", border: `1px solid ${THEME.border}`, borderRadius: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
            <strong>占座检测结果</strong>
            <span style={{ color: THEME.muted, fontSize: "13px" }}>
              {latestOccupation?.detectedAt ? `检测时间：${new Date(latestOccupation.detectedAt).toLocaleString("zh-CN")}` : "暂无检测记录"}
            </span>
          </div>
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
        </div>

        {generateTaskStatus && (
          <div style={{ marginBottom: "10px", color: THEME.text }}>{generateTaskStatus}</div>
        )}

        <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
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
            + 新增座位框
          </button>
          <button
            onClick={handleConfirmSeats}
            disabled={isBusy}
            style={{ padding: "8px 12px", cursor: "pointer", background: THEME.success, color: "#fff", border: "none" }}
          >
            {busyAction === "confirming" ? "保存中..." : "3. 确认并生成 seats.json"}
          </button>
        </div>

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

        <div style={{ marginBottom: "12px" }}>
          <strong>前端监控视频：</strong>
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
                暂无检测视频。请点击“运行占座检测并更新举报中心”。
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default AdminSeatConfig;

