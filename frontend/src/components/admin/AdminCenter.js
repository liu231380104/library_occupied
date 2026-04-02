import React, { useState, useEffect, useRef } from "react";
import api from "../../services/api";

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

const AdminCenter = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
  const [dragging, setDragging] = useState(null);
  const [imgMetrics, setImgMetrics] = useState({
    naturalW: 1,
    naturalH: 1,
    displayW: 1,
    displayH: 1,
  });
  const imgRef = useRef(null);

  useEffect(() => {
    fetchReports();
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
        { videoPath, area },
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

  const fetchReports = async () => {
    try {
      const response = await api.get("/reports");
      setReports(response.data);
      setLoading(false);
    } catch (err) {
      console.error("Fetch reports error:", err);
      setError("获取举报记录失败");
      setLoading(false);
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

  const handleGenerateMonitorVideo = async () => {
    try {
      setBusyAction("monitoring");
      const resp = await api.post(
        "/monitor-video",
        { videoPath },
        { timeout: 300000 },
      );
      const normalized = normalizeMonitorVideoUrl(resp.data?.videoUrl || "");
      setMonitorVideoUrl(normalized);
      if (normalized) {
        sessionStorage.setItem("latestOccupationVideoUrl", normalized);
        setMonitorVideoError("");
      }
      alert("监控视频已生成，可在页面直接播放");
    } catch (err) {
      console.error("Generate monitor video error:", err);
      if (err.code === "ECONNABORTED") {
        alert("监控视频生成超时，请缩短视频长度或稍后重试");
        return;
      }
      alert(err.response?.data?.error || "监控视频生成失败");
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
      const resp = await api.post("/confirm-seats", {
        area,
        prefix,
        seats,
        videoPath,
        frame,
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

  const handleUpdateReportStatus = async (reportId, newStatus) => {
    try {
      await api.patch(`/reports/${reportId}`, {
        report_status: newStatus,
      });
      setReports(
        reports.map((r) =>
          r.report_id === reportId ? { ...r, report_status: newStatus } : r,
        ),
      );
      alert("举报状态已更新");
    } catch (err) {
      console.error("Update report status error:", err);
      alert("更新举报状态失败");
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: { bg: "#ffc107", text: "待审核" },
      valid: { bg: "#28a745", text: "属实" },
      invalid: { bg: "#dc3545", text: "驳回" },
    };
    const s = statusMap[status] || statusMap.pending;
    return (
      <span
        style={{
          backgroundColor: s.bg,
          color: "#fff",
          padding: "4px 8px",
          borderRadius: "4px",
          fontSize: "12px",
        }}
      >
        {s.text}
      </span>
    );
  };

  if (loading) return <div>加载中...</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div>
      <h2>举报中心</h2>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "8px",
          padding: "14px",
          marginBottom: "20px",
          background: "#fafafa",
        }}
      >
        <h3 style={{ marginTop: 0 }}>视频座位配置（测试）</h3>
        <p style={{ marginTop: 0, color: "#666" }}>
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
            onClick={handleGenerateMonitorVideo}
            disabled={isBusy}
            style={{ padding: "8px 12px", cursor: "pointer" }}
          >
            {busyAction === "monitoring" ? "生成中..." : "2. 生成监控视频"}
          </button>
          <button
            onClick={handleRunOccupationDetection}
            disabled={isBusy}
            style={{ padding: "8px 12px", cursor: "pointer", background: "#6f42c1", color: "#fff", border: "none" }}
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

        <div style={{ marginBottom: "12px", padding: "10px", background: "#fff", border: "1px solid #e3e3e3", borderRadius: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
            <strong>占座检测结果</strong>
            <span style={{ color: "#666", fontSize: "13px" }}>
              {latestOccupation?.detectedAt ? `检测时间：${new Date(latestOccupation.detectedAt).toLocaleString("zh-CN")}` : "暂无检测记录"}
            </span>
          </div>
          <div style={{ marginTop: "6px", color: "#333", fontSize: "14px" }}>
            异常占座座位ID：
            {Array.isArray(latestOccupation?.occupiedSeatIds) && latestOccupation.occupiedSeatIds.length > 0
              ? latestOccupation.occupiedSeatIds.join(", ")
              : "无"}
          </div>
          <div style={{ marginTop: "4px", color: "#666", fontSize: "13px" }}>
            模型：人 {latestOccupation?.models?.person || "best.pt"}；物品 {latestOccupation?.models?.item || "yolov8n.pt"}
          </div>
          {latestOccupation?.videoMeta && (
            <div style={{ marginTop: "4px", color: "#666", fontSize: "13px" }}>
              视频信息：{latestOccupation.videoMeta.framesWritten || 0} 帧，
              {latestOccupation.videoMeta.fps || 0} FPS，
              时长约 {latestOccupation.videoMeta.durationSec || 0} 秒
            </div>
          )}
        </div>

        {generateTaskStatus && (
          <div style={{ marginBottom: "10px", color: "#555" }}>{generateTaskStatus}</div>
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
            style={{ padding: "8px 12px", cursor: "pointer", background: "#28a745", color: "#fff", border: "none" }}
          >
            {busyAction === "confirming" ? "保存中..." : "3. 确认并生成 seats.json"}
          </button>
        </div>

        {previewImageUrl && (
          <div style={{ marginBottom: "12px" }}>
            <strong>识别预览图：</strong>
            <div style={{ margin: "8px 0", color: "#666", fontSize: "13px" }}>
              直接拖动红框可移动；拖右下角小方块可调整大小；删除不需要的框。
            </div>
            <div
              style={{ position: "relative", width: "fit-content", maxWidth: "100%" }}
              onMouseMove={handleOverlayMouseMove}
              onMouseLeave={() => setDragging(null)}
            >
              <img
                ref={imgRef}
                src={`http://localhost:5000${previewImageUrl}?t=${Date.now()}`}
                alt="seats-preview"
                onLoad={refreshImageMetrics}
                style={{ maxWidth: "100%", border: "1px solid #ccc", borderRadius: "6px", marginTop: "8px", display: "block" }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 8,
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
                        border: `2px solid ${isActive ? "#00a86b" : "#d62728"}`,
                        background: "rgba(255, 0, 0, 0.06)",
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
                          background: isActive ? "#00a86b" : "#d62728",
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
                          border: `2px solid ${isActive ? "#00a86b" : "#d62728"}`,
                          cursor: "nwse-resize",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div style={{ marginBottom: "12px" }}>
          <strong>前端监控视频：</strong>
          <div style={{ marginTop: "8px" }}>
            {monitorVideoUrl ? (
              <>
                <video
                  controls
                  autoPlay
                  muted
                  playsInline
                  style={{ width: "100%", maxWidth: "900px", border: "1px solid #ccc", borderRadius: "6px" }}
                  onError={() => {
                    setMonitorVideoError("视频加载失败：资源可能尚未生成完成或路径不可访问，请点击“刷新最近检测结果”后重试。");
                  }}
                  src={/^https?:\/\//i.test(monitorVideoUrl) ? monitorVideoUrl : `http://localhost:5000${monitorVideoUrl}`}
                />
                {monitorVideoError && (
                  <div style={{ marginTop: "8px", color: "#c62828", fontSize: "13px" }}>
                    {monitorVideoError}
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: "12px", border: "1px dashed #ccc", borderRadius: "6px", color: "#666" }}>
                暂无检测视频。请点击“运行占座检测并更新举报中心”。
              </div>
            )}
          </div>
        </div>

        <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f4f4f4" }}>
                <th style={{ padding: "8px" }}>编号</th>
                <th style={{ padding: "8px" }}>x1</th>
                <th style={{ padding: "8px" }}>y1</th>
                <th style={{ padding: "8px" }}>x2</th>
                <th style={{ padding: "8px" }}>y2</th>
                <th style={{ padding: "8px" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {seats.map((seat, idx) => (
                <tr key={`seat-${idx}`} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "8px" }}>{prefix}{idx + 1}</td>
                  {[0, 1, 2, 3].map((pos) => (
                    <td key={pos} style={{ padding: "8px" }}>
                      <input
                        type="number"
                        value={seat[pos]}
                        onChange={(e) => updateSeatValue(idx, pos, e.target.value)}
                        style={{ width: "90px", padding: "6px" }}
                      />
                    </td>
                  ))}
                  <td style={{ padding: "8px" }}>
                    <button
                      onClick={() => removeSeat(idx)}
                      style={{ padding: "6px 10px", background: "#dc3545", color: "#fff", border: "none", cursor: "pointer" }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {seats.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "10px", color: "#666" }}>
                    还没有座位框，请先点击“识别座位”。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p>共 {reports.length} 条举报记录</p>

      {reports.length === 0 ? (
        <p>暂无举报记录</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "20px",
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: "#f4f4f4",
                  borderBottom: "2px solid #ddd",
                }}
              >
                <th style={{ padding: "10px", textAlign: "left" }}>举报ID</th>
                <th style={{ padding: "10px", textAlign: "left" }}>举报人</th>
                <th style={{ padding: "10px", textAlign: "left" }}>信誉分</th>
                <th style={{ padding: "10px", textAlign: "left" }}>座位</th>
                <th style={{ padding: "10px", textAlign: "left" }}>描述</th>
                <th style={{ padding: "10px", textAlign: "left" }}>证据图片</th>
                <th style={{ padding: "10px", textAlign: "left" }}>状态</th>
                <th style={{ padding: "10px", textAlign: "left" }}>操作</th>
                <th style={{ padding: "10px", textAlign: "left" }}>举报时间</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.report_id}
                  style={{ borderBottom: "1px solid #ddd" }}
                >
                  <td style={{ padding: "10px" }}>{report.report_id}</td>
                  <td style={{ padding: "10px" }}>
                    {report.reporter_name || "未知"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {report.reporter_credit_score ?? "未知"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {report.seat_number}({report.area})
                  </td>
                  <td style={{ padding: "10px", maxWidth: "200px" }}>
                    {report.description || "无"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {report.evidence_img ? (
                      <a
                        href={report.evidence_img}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        查看
                      </a>
                    ) : (
                      "无"
                    )}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {getStatusBadge(report.report_status)}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {report.report_status === "pending" ? (
                      <div style={{ display: "flex", gap: "5px" }}>
                        <button
                          onClick={() =>
                            handleUpdateReportStatus(report.report_id, "valid")
                          }
                          style={{
                            padding: "4px 8px",
                            backgroundColor: "#28a745",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          通过
                        </button>
                        <button
                          onClick={() =>
                            handleUpdateReportStatus(
                              report.report_id,
                              "invalid",
                            )
                          }
                          style={{
                            padding: "4px 8px",
                            backgroundColor: "#dc3545",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          驳回
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: "#999" }}>已处理</span>
                    )}
                  </td>
                  <td style={{ padding: "10px", fontSize: "12px" }}>
                    {report.created_at
                      ? new Date(report.created_at).toLocaleString("zh-CN")
                      : "未知"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminCenter;
