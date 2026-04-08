import React, { useState, useEffect, useRef } from "react";
import api from "../../services/api";
import { getUserRole } from "../../utils/tokenUtils";

const THEME = {
  pageBg: "#f2efea",
  panelBg: "#fcfbf8",
  border: "#d8d2c9",
  text: "#3f4748",
  mutedText: "#5f6768",
  primary: "#7f95a6",
  danger: "#b78a84",
  warning: "#c4ab87",
  success: "#8ca79a",
  focus: "#2f7f78",
  status: {
    free: "#a6b8a7",
    reserved: "#cbbca3",
    occupied: "#c19d98",
    abnormal: "#b5a5bb",
  },
};

const LEAVE_ITEM_TIMEOUT_MINUTES = 15;
const ADMIN_DETECT_TIMEOUT_MS = 15 * 60 * 1000;
const ADMIN_DETECT_MAX_FRAMES = 1800;
const ADMIN_DETECT_INTERVAL = 8;

const SeatMap = () => {
  const [role, setRole] = useState(null);
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState("");
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [showReservationForm, setShowReservationForm] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [reportSeat, setReportSeat] = useState(null);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportDescription, setReportDescription] = useState("");
  const [reportImageUrl, setReportImageUrl] = useState("");
  const [showAdminStatusEdit, setShowAdminStatusEdit] = useState(false);
  const [adminEditSeat, setAdminEditSeat] = useState(null);
  const [adminNewStatus, setAdminNewStatus] = useState(0);
  const [showViolationForm, setShowViolationForm] = useState(false);
  const [violationSeat, setViolationSeat] = useState(null);
  const [violationDescription, setViolationDescription] = useState("");
  const [hoveredSeatId, setHoveredSeatId] = useState(null);
  const [focusedSeatId, setFocusedSeatId] = useState(null);
  const [autoReserving, setAutoReserving] = useState(false);
  const [autoReserveMode, setAutoReserveMode] = useState("balanced");
  const [strictQuietMode, setStrictQuietMode] = useState(true);
  const [autoReserveHint, setAutoReserveHint] = useState("");
  const [autoReserveRecommendations, setAutoReserveRecommendations] = useState([]);
  const [previewCacheKey, setPreviewCacheKey] = useState(Date.now());
  const [lastDetectionAt, setLastDetectionAt] = useState(null);
  const [detectionRunning, setDetectionRunning] = useState(false);
  const [adminMonitorVideoUrl, setAdminMonitorVideoUrl] = useState("");
  const [adminMonitorVideoError, setAdminMonitorVideoError] = useState("");
  const [nowTs, setNowTs] = useState(Date.now());
  const refreshLockRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  useEffect(() => {
    // 从 token 解析 role
    const currentRole = getUserRole();
    setRole(currentRole);
    fetchAreas();
  }, []);

  const fetchAreas = async () => {
    try {
      const response = await api.get("/seats/areas");
      const dbAreas = response.data || [];
      setAreas(dbAreas);

      const defaultArea = dbAreas[0] || "";
      setSelectedArea(defaultArea);
      if (defaultArea) {
        fetchSeats(defaultArea);
      } else {
        setSeats([]);
        setLoading(false);
      }
    } catch (err) {
      setError("获取座位区域失败");
      setLoading(false);
    }
  };

  const fetchSeats = async (area) => {
    try {
      const response = area
        ? await api.get("/seats", { params: { area, _: Date.now() } })
        : await api.get("/seats", { params: { _: Date.now() } });
      setSeats(response.data);
      setPreviewCacheKey(Date.now());
      setLoading(false);
    } catch (err) {
      setError("获取座位信息失败");
      setLoading(false);
    }
  };

  const fetchDetectionStatus = async () => {
    try {
      const response = await api.get("/detection/status", { params: { _: Date.now() } });
      setDetectionRunning(Boolean(response?.data?.detectionRunning));
      const ts = Number(response?.data?.lastDetectionAt);
      setLastDetectionAt(Number.isFinite(ts) && ts > 0 ? ts : null);
    } catch (err) {
      setDetectionRunning(false);
      setLastDetectionAt(null);
    }
  };

  const normalizeMonitorVideoUrl = (rawUrl) => {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const cleaned = rawUrl.trim().replace(/\\\\/g, "/");
    const withoutDupPrefix = cleaned.replace("/python-assets/python_scripts/", "/python-assets/");
    if (/^https?:\/\//i.test(withoutDupPrefix)) return withoutDupPrefix;
    return withoutDupPrefix.startsWith("/") ? withoutDupPrefix : `/${withoutDupPrefix}`;
  };

  const fetchAdminMonitorVideo = async () => {
    try {
      const fromSession = sessionStorage.getItem("latestOccupationVideoUrl") || "";
      if (fromSession) {
        setAdminMonitorVideoUrl(normalizeMonitorVideoUrl(fromSession));
      }

      const resp = await api.get("/detect-occupation/latest", { params: { _: Date.now() } });
      const latest = normalizeMonitorVideoUrl(resp?.data?.videoUrl || "");
      if (latest) {
        setAdminMonitorVideoUrl(latest);
        sessionStorage.setItem("latestOccupationVideoUrl", latest);
        setAdminMonitorVideoError("");
      }
    } catch (err) {
      // latest 可能暂时 404，保留已加载的视频地址
    }
  };

  const refreshSeatPanel = async () => {
    if (!selectedArea) return;

    if (refreshLockRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    refreshLockRef.current = true;
    try {
      const jobs = [fetchSeats(selectedArea), fetchDetectionStatus()];
      if (role === "admin") {
        jobs.push(fetchAdminMonitorVideo());
      }
      await Promise.all(jobs);
    } finally {
      refreshLockRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        refreshSeatPanel();
      }
    }
  };

  useEffect(() => {
    if (!selectedArea) return undefined;

    refreshSeatPanel();

    const intervalMs = detectionRunning ? 2500 : 8000;

    const timer = setInterval(() => {
      refreshSeatPanel();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [selectedArea, role, detectionRunning]);

  useEffect(() => {
    if (!selectedArea || typeof EventSource === "undefined") return undefined;

    const streamUrl = `http://localhost:5000/api/seats/stream?area=${encodeURIComponent(selectedArea)}&_=${Date.now()}`;
    const source = new EventSource(streamUrl);

    const handleSeatUpdate = () => {
      refreshSeatPanel();
    };

    source.addEventListener("seat-update", handleSeatUpdate);
    source.onerror = () => {
      // 失败时依赖上面的轮询兜底
    };

    return () => {
      source.removeEventListener("seat-update", handleSeatUpdate);
      source.close();
    };
  }, [selectedArea, role]);

  const handleAreaChange = (e) => {
    const area = e.target.value;
    setSelectedArea(area);
    setAutoReserveHint("");
    setAutoReserveRecommendations([]);
    setHoveredSeatId(null);
    setFocusedSeatId(null);
    setLoading(true);
    fetchSeats(area);
  };

  const getSeatColor = (status) => {
    switch (status) {
      case 0:
        return THEME.status.free; // 空闲
      case 1:
        return THEME.status.reserved; // 已预约
      case 2:
        return THEME.status.occupied; // 已占用
      case 3:
        return THEME.status.abnormal; // 异常占座
      default:
        return "#ffffff";
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 0:
        return "空闲";
      case 1:
        return "已预约";
      case 2:
        return "已占用";
      case 3:
        return "异常占座";
      default:
        return "未知";
    }
  };

  const getSeatTextColor = (status) => {
    if (status === 0 || status === 1) return "#2f3637";
    return "#ffffff";
  };

  const hasActiveItemTimer = seats.some(
    (seat) => Boolean(seat?.item_occupied_since) && Number(seat?.status) !== 0,
  );

  useEffect(() => {
    if (!hasActiveItemTimer) return undefined;

    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [hasActiveItemTimer]);

  const formatItemOccupancyDuration = (startedAt) => {
    if (!startedAt) return "";

    const startedMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startedMs)) return "";

    const elapsedSeconds = Math.max(0, Math.floor((nowTs - startedMs) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    const pad = (value) => String(value).padStart(2, "0");

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }

    return `${pad(minutes)}:${pad(seconds)}`;
  };

  const formatItemLeaveCountdown = (startedAt) => {
    if (!startedAt) return "";

    const startedMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startedMs)) return "";

    const timeoutMs = LEAVE_ITEM_TIMEOUT_MINUTES * 60 * 1000;
    const remainingMs = timeoutMs - (nowTs - startedMs);
    const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    const pad = (value) => String(value).padStart(2, "0");

    if (remainingMs <= 0) {
      return "已超时";
    }

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }

    return `${pad(minutes)}:${pad(seconds)}`;
  };

  const toAbsoluteAssetUrl = (rawUrl, cacheKey) => {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const withCache = (url) => {
      if (!cacheKey) return url;
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}t=${cacheKey}`;
    };

    if (/^https?:\/\//i.test(rawUrl)) return withCache(rawUrl);
    const normalized = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
    return withCache(`http://localhost:5000${normalized}`);
  };

  const seatWithPreview = seats.find((seat) => seat?.seat_preview_url);
  const seatMapPreviewUrl = toAbsoluteAssetUrl(seatWithPreview?.seat_preview_url, previewCacheKey);
  const seatMapNaturalWidth = Number(seatWithPreview?.seat_preview_size?.width) || 1280;
  const seatMapNaturalHeight = Number(seatWithPreview?.seat_preview_size?.height) || 720;
  const seatMapDisplayWidth = 520;
  const seatMapDisplayHeight = Math.round(
    (seatMapDisplayWidth * seatMapNaturalHeight) / Math.max(seatMapNaturalWidth, 1),
  );

  // 左侧网格固定按座位号顺序展示（A1、A2、A3...），避免受检测框位置波动影响
  const orderedSeats = [...seats].sort((a, b) => {
    const aLabel = String(a?.seat_number || "");
    const bLabel = String(b?.seat_number || "");
    const aMatch = aLabel.match(/^([^\d]*)(\d+)$/);
    const bMatch = bLabel.match(/^([^\d]*)(\d+)$/);

    const aPrefix = aMatch?.[1] || "";
    const bPrefix = bMatch?.[1] || "";
    if (aPrefix !== bPrefix) {
      return aPrefix.localeCompare(bPrefix, "zh-CN");
    }

    const aNum = aMatch ? Number(aMatch[2]) : (Number(a?.seat_id) || 0);
    const bNum = bMatch ? Number(bMatch[2]) : (Number(b?.seat_id) || 0);
    if (aNum !== bNum) return aNum - bNum;

    return aLabel.localeCompare(bLabel, "zh-CN", { numeric: true });
  });

  const freeSeats = orderedSeats.filter((seat) => Number(seat?.status) === 0);
  const highlightedSeatId = Number.isInteger(Number(hoveredSeatId))
    ? Number(hoveredSeatId)
    : (Number.isInteger(Number(focusedSeatId)) ? Number(focusedSeatId) : null);
  const recommendedSeatRankMap = new Map(
    autoReserveRecommendations.map((item) => [Number(item?.seat_id), Number(item?.rank) || null]),
  );

  const handleSeatClick = (seat) => {
    // 管理员可以编辑座位状态
    if (role === "admin") {
      setAdminEditSeat(seat);
      setAdminNewStatus(seat.status);
      setShowAdminStatusEdit(true);
      return;
    }

    // 普通用户：空闲座位预约，占座座位质疑
    if (seat.status === 0) {
      setSelectedSeat(seat);
      setShowReservationForm(true);
    } else if (seat.status === 3) {
      setViolationSeat(seat);
      setViolationDescription("");
      setShowViolationForm(true);
    }
  };

  const handleReportClick = (seat) => {
    setReportSeat(seat);
    setReportDescription("");
    setReportImageUrl("");
    setShowReportForm(true);
  };

  const handleAdminStatusChange = async (e) => {
    e.preventDefault();

    if (!adminEditSeat) {
      alert("请选择座位");
      return;
    }

    try {
      await api.patch(`/seats/${adminEditSeat.seat_id}`, {
        status: adminNewStatus,
      });

      alert("座位状态已更新");
      setShowAdminStatusEdit(false);
      setAdminEditSeat(null);
      fetchSeats(selectedArea);
    } catch (err) {
      console.error("Admin edit seat error:", err);
      alert(err.response?.data?.message || "更新座位状态失败");
    }
  };

  const handleReportSubmit = async (e) => {
    e.preventDefault();

    if (!reportSeat) {
      alert("请选择要举报的座位");
      return;
    }

    if (!reportDescription.trim() && !reportImageUrl.trim()) {
      alert("请填写举报描述或证据图片地址");
      return;
    }

    try {
      const response = await api.post("/reports", {
        seatId: reportSeat.seat_id,
        description: reportDescription.trim(),
        evidence_img: reportImageUrl.trim(),
      });

      if (response.status === 201) {
        alert("举报提交成功，管理员会尽快处理");
        setShowReportForm(false);
        setReportSeat(null);
        setReportDescription("");
        setReportImageUrl("");
        fetchSeats(selectedArea);
      } else {
        alert(response.data?.message || "举报提交失败，请重试");
      }
    } catch (err) {
      console.error("Report submit error:", err);
      const message =
        err.response?.data?.message || err.message || "举报提交失败，请重试";
      alert(message);
    }
  };

  const handleViolationSubmit = async (e) => {
    e.preventDefault();

    if (!violationSeat) {
      alert("请选择要质疑的座位");
      return;
    }

    if (!violationDescription.trim()) {
      alert("请填写质疑描述");
      return;
    }

    try {
      await api.post("/violations", {
        seat_id: violationSeat.seat_id,
        description: violationDescription.trim(),
      });

      alert("质疑提交成功，管理员会尽快处理");
      setShowViolationForm(false);
      setViolationSeat(null);
      setViolationDescription("");
    } catch (err) {
      console.error("Violation submit error:", err);
      alert(err.response?.data?.message || "质疑提交失败，请重试");
    }
  };

  const handleReservationSubmit = async (e) => {
    e.preventDefault();

    setReserving(true);

    try {
      console.log("Sending reservation request:", {
        seatId: selectedSeat.seat_id,
      });

      const response = await api.post("/reservations", {
        seatId: selectedSeat.seat_id,
      });

      console.log("Reservation response:", response);
      alert("预约成功，系统将保留15分钟");
      setShowReservationForm(false);
      setSelectedSeat(null);
      setAutoReserveHint("");
      setAutoReserveRecommendations([]);
      // 刷新座位状态
      fetchSeats(selectedArea);
    } catch (err) {
      console.error("Reservation error:", err);
      console.error("Error response:", err.response);
      console.error("Error data:", err.response?.data);
      alert(err.response?.data?.message || "预约失败，请重试");
    } finally {
      setReserving(false);
    }
  };

  const closeReservationForm = () => {
    setShowReservationForm(false);
    setSelectedSeat(null);
  };

  const handleAutoReserve = async () => {
    if (role === "admin") return;
    setAutoReserveHint("");
    setAutoReserveRecommendations([]);
    setAutoReserving(true);
    try {
      const response = await api.post("/reservations/auto", {
        area: selectedArea || undefined,
        mode: autoReserveMode,
        strictQuiet: autoReserveMode === "quiet" ? strictQuietMode : false,
      });
      const pickedSeat = response?.data?.seat || null;
      const pickedSeatId = Number(pickedSeat?.seat_id);
      const reasons = Array.isArray(response?.data?.strategy?.reasons)
        ? response.data.strategy.reasons
        : [];

      if (Number.isInteger(pickedSeatId)) {
        setFocusedSeatId(pickedSeatId);
        setHoveredSeatId(pickedSeatId);
      }

      const reasonText = reasons.length > 0 ? `（${reasons.join("，")}）` : "";
      const msg = response?.data?.message
        || (pickedSeat
          ? `已为您自动预约 ${pickedSeat.area}${pickedSeat.seat_number}，系统将保留15分钟${reasonText}`
          : "智能预约成功");

      setAutoReserveHint(msg);
      alert(msg);
      await fetchSeats(selectedArea);
    } catch (err) {
      alert(err.response?.data?.message || "智能预约失败，请稍后重试");
    } finally {
      setAutoReserving(false);
    }
  };

  if (loading) return <div>加载中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ padding: "20px", backgroundColor: THEME.pageBg, color: THEME.text, borderRadius: "10px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "12px",
        }}
      >
        <h2 style={{ margin: 0 }}>
          {selectedArea ? `${selectedArea}座位图` : "座位图"}
        </h2>
        <div style={{ color: THEME.mutedText, fontSize: "13px", marginLeft: "auto", marginRight: "8px" }}>
          最近识别：{lastDetectionAt ? new Date(lastDetectionAt).toLocaleTimeString("zh-CN") : "尚未检测"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label htmlFor="seat-area-select">区域：</label>
          <select
            id="seat-area-select"
            value={selectedArea}
            onChange={handleAreaChange}
            style={{ padding: "6px 8px", minWidth: "160px" }}
          >
            {areas.length === 0 ? (
              <option value="">暂无区域</option>
            ) : (
              areas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))
            )}
          </select>
          {role !== "admin" && (
            <>
              <select
                value={autoReserveMode}
                onChange={(e) => setAutoReserveMode(e.target.value)}
                style={{ padding: "6px 8px" }}
                title="智能策略"
              >
                <option value="balanced">智能均衡</option>
                <option value="quick">快速入座</option>
                <option value="quiet">安静优先</option>
              </select>
              {autoReserveMode === "quiet" && (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "13px",
                    color: THEME.mutedText,
                  }}
                  title="开启后仅预约四周邻座无人的安静位置，否则直接返回无可用安静座位"
                >
                  <input
                    type="checkbox"
                    checked={strictQuietMode}
                    onChange={(e) => setStrictQuietMode(e.target.checked)}
                  />
                  严格安静
                </label>
              )}
              <button
                onClick={handleAutoReserve}
                disabled={autoReserving}
                style={{
                  padding: "6px 12px",
                  backgroundColor: THEME.success,
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: autoReserving ? "not-allowed" : "pointer",
                  opacity: autoReserving ? 0.8 : 1,
                }}
              >
                {autoReserving ? "预约中..." : "智能推荐并预约"}
              </button>
            </>
          )}
          {role === "admin" && (
            <>
              <button
                onClick={async () => {
                  try {
                    const resp = await api.post(
                      "/detect-occupation",
                      {
                        area: selectedArea || "A区",
                        saveVideo: true,
                        maxFrames: ADMIN_DETECT_MAX_FRAMES,
                        detectInterval: ADMIN_DETECT_INTERVAL,
                        timeoutMs: ADMIN_DETECT_TIMEOUT_MS,
                      },
                      { timeout: ADMIN_DETECT_TIMEOUT_MS },
                    );
                    const latestVideoUrl = resp?.data?.videoUrl || "";
                    if (latestVideoUrl) {
                      sessionStorage.setItem("latestOccupationVideoUrl", latestVideoUrl);
                      setAdminMonitorVideoUrl(normalizeMonitorVideoUrl(latestVideoUrl));
                      setAdminMonitorVideoError("");
                    }
                    window.dispatchEvent(new CustomEvent("openAdminReports"));
                    alert("占座检测完成，已跳转到举报中心查看视频结果");
                    fetchSeats(selectedArea || "A区");
                  } catch (err) {
                    const msg = err.response?.data?.error || err.message || "检测失败";
                    alert(msg);
                  }
                }}
                style={{
                  padding: "6px 12px",
                  backgroundColor: THEME.primary,
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                运行占座检测
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "18px", flexWrap: "wrap" }}>
        {role !== "admin" && autoReserveHint && (
          <div
            style={{
              width: "100%",
              marginBottom: "8px",
              padding: "8px 10px",
              borderRadius: "8px",
              border: `1px solid ${THEME.warning}`,
              background: "#f3ece1",
              color: "#6f5740",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            {autoReserveHint}
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "10px",
            maxWidth: "600px",
          }}
        >
          {orderedSeats.map((seat) => (
            (() => {
              const recommendedRank = recommendedSeatRankMap.get(Number(seat.seat_id));
              const isRecommended = Number.isInteger(recommendedRank);
              return (
                <div
                  key={seat.seat_id}
                  data-seat-id={seat.seat_id}
                  style={{
                    width: "100px",
                    height: "100px",
                    backgroundColor: getSeatColor(seat.status),
                    border: highlightedSeatId === seat.seat_id
                      ? `2px solid ${THEME.focus}`
                      : `2px solid ${THEME.border}`,
                    borderRadius: "5px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: role === "admin" || seat.status === 0 ? "pointer" : "not-allowed",
                    color: getSeatTextColor(seat.status),
                    boxShadow: highlightedSeatId === seat.seat_id
                      ? "0 0 0 4px rgba(47, 127, 120, 0.28)"
                      : "none",
                  }}
                  onClick={() => {
                    setFocusedSeatId(seat.seat_id);
                    handleSeatClick(seat);
                  }}
                  onMouseEnter={() => setHoveredSeatId(seat.seat_id)}
                  onMouseLeave={() => setHoveredSeatId(null)}
                  title={
                    seat.status === 0
                      ? `点击预约 ${seat.seat_number}`
                      : `${seat.seat_number} - ${getStatusText(seat.status)}`
                  }
                >
                  {isRecommended && (
                    <div style={{ fontSize: "10px", color: "#425867", fontWeight: 700, marginBottom: "2px" }}>
                      推荐#{recommendedRank}
                    </div>
                  )}
                  <div style={{ fontSize: "18px", fontWeight: "bold" }}>
                    {seat.seat_number}
                  </div>
                  <div style={{ fontSize: "12px" }}>{getStatusText(seat.status)}</div>
                  {role !== "admin" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReportClick(seat);
                      }}
                      style={{
                        marginTop: "5px",
                        padding: "2px 6px",
                        fontSize: "12px",
                        border: `1px solid ${THEME.danger}`,
                        borderRadius: "4px",
                        backgroundColor: "#ffffff",
                        color: THEME.danger,
                        cursor: "pointer",
                      }}
                    >
                      举报状态
                    </button>
                  )}
                </div>
              );
            })()
          ))}
        </div>

        <div style={{ minWidth: "520px", flex: "1 1 520px" }}>
          <h3 style={{ marginTop: 0, marginBottom: "8px" }}>座位图</h3>
          <div style={{ display: "flex", gap: "12px", alignItems: "stretch", flexWrap: "nowrap" }}>
            {(role === "admin" && adminMonitorVideoUrl) || seatMapPreviewUrl ? (
              <div
                style={{
                  position: "relative",
                  width: `${seatMapDisplayWidth}px`,
                  height: `${seatMapDisplayHeight}px`,
                  maxWidth: "100%",
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "8px",
                  overflow: "hidden",
                  background: "#5f6768",
                  flex: "0 0 auto",
                }}
              >
                {role === "admin" && adminMonitorVideoUrl ? (
                  <video
                    autoPlay
                    muted
                    controls
                    playsInline
                    onError={() => {
                      setAdminMonitorVideoError("实时监控视频加载失败，请点击运行占座检测后重试。");
                    }}
                    src={/^https?:\/\//i.test(adminMonitorVideoUrl)
                      ? adminMonitorVideoUrl
                      : `http://localhost:5000${adminMonitorVideoUrl}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <img
                    src={seatMapPreviewUrl}
                    alt="seat-map-preview"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                )}
                {role === "admin" && adminMonitorVideoError && (
                  <div
                    style={{
                      position: "absolute",
                      left: "8px",
                      right: "8px",
                      bottom: "8px",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      background: "rgba(183, 138, 132, 0.9)",
                      color: "#fff",
                      fontSize: "12px",
                      lineHeight: 1.3,
                    }}
                  >
                    {adminMonitorVideoError}
                  </div>
                )}
                {seats.map((seat) => {
                  const bbox = Array.isArray(seat?.seat_bbox) ? seat.seat_bbox : null;
                  if (!bbox || bbox.length !== 4) return null;

                  const [x1, y1, x2, y2] = bbox.map((v) => Number(v));
                  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) {
                    return null;
                  }

                  const sx = seatMapDisplayWidth / Math.max(seatMapNaturalWidth, 1);
                  const sy = seatMapDisplayHeight / Math.max(seatMapNaturalHeight, 1);
                  const isHighlight = highlightedSeatId === seat.seat_id;
                  const recommendedRank = recommendedSeatRankMap.get(Number(seat.seat_id));
                  const isRecommended = Number.isInteger(recommendedRank);

                  return (
                    <div
                      key={`map-box-${seat.seat_id}`}
                      onMouseEnter={() => setHoveredSeatId(seat.seat_id)}
                      onMouseLeave={() => setHoveredSeatId(null)}
                      style={{
                        position: "absolute",
                        left: `${x1 * sx}px`,
                        top: `${y1 * sy}px`,
                        width: `${Math.max(8, (x2 - x1) * sx)}px`,
                        height: `${Math.max(8, (y2 - y1) * sy)}px`,
                        border: isHighlight
                          ? `2px solid ${THEME.focus}`
                          : "1px solid rgba(255,255,255,0.55)",
                        background: isHighlight
                          ? "rgba(47, 127, 120, 0.24)"
                          : "rgba(255,255,255,0.08)",
                        boxSizing: "border-box",
                        pointerEvents: "auto",
                        overflow: "hidden",
                        cursor: "pointer",
                      }}
                      title={`${seat.seat_number} - ${getStatusText(seat.status)}`}
                    >
                      {seat.item_occupied_since && Number(seat.status) !== 0 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "4px",
                            left: "4px",
                            right: "4px",
                            padding: "2px 4px",
                            borderRadius: "4px",
                            background: "rgba(18, 24, 28, 0.72)",
                            color: "#fff",
                            fontSize: "11px",
                            fontWeight: 700,
                            textAlign: "center",
                            lineHeight: 1.2,
                          }}
                        >
                          {(() => {
                            const countdown = formatItemLeaveCountdown(seat.item_occupied_since);
                            return countdown === "已超时"
                              ? `离座超时 ${countdown}`
                              : `离座保留 ${countdown}`;
                          })()}
                        </div>
                      )}
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          fontSize: "10px",
                          color: "#fff",
                          background: isHighlight ? "#8f7a5f" : "rgba(0,0,0,0.45)",
                          padding: "1px 3px",
                        }}
                      >
                        {isRecommended ? `R${recommendedRank} ${seat.seat_number}` : seat.seat_number}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  width: `${seatMapDisplayWidth}px`,
                  maxWidth: "100%",
                  border: `1px dashed ${THEME.border}`,
                  borderRadius: "8px",
                  padding: "18px",
                  color: THEME.mutedText,
                }}
              >
                暂无座位图。请先到“视频座位配置”页面识别并确认座位。
              </div>
            )}

            <div
              style={{
                width: "180px",
                minWidth: "180px",
                border: `1px solid ${THEME.border}`,
                borderRadius: "8px",
                background: THEME.panelBg,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "10px", borderBottom: `1px solid ${THEME.border}`, fontWeight: 700 }}>
                空闲座位序号
              </div>
              <div style={{ maxHeight: `${seatMapDisplayHeight}px`, overflowY: "auto", padding: "8px" }}>
                {freeSeats.length === 0 ? (
                  <div style={{ color: THEME.mutedText, fontSize: "13px", padding: "6px 4px" }}>暂无空闲座位</div>
                ) : (
                  freeSeats.map((seat) => {
                    const isHighlight = highlightedSeatId === seat.seat_id;
                    return (
                      <button
                        key={`free-seat-${seat.seat_id}`}
                        onClick={() => setFocusedSeatId(seat.seat_id)}
                        onMouseEnter={() => setHoveredSeatId(seat.seat_id)}
                        onMouseLeave={() => setHoveredSeatId(null)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "7px 9px",
                          marginBottom: "6px",
                          borderRadius: "6px",
                          border: `1px solid ${isHighlight ? THEME.warning : THEME.border}`,
                          background: isHighlight ? "#f3ece1" : "#fff",
                          color: isHighlight ? "#6f5740" : THEME.text,
                          cursor: "pointer",
                          fontWeight: isHighlight ? 700 : 500,
                        }}
                        title={`高亮 ${seat.seat_number}`}
                      >
                        {seat.seat_number}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: "20px" }}>
        <h3>图例</h3>
        <div style={{ display: "flex", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                backgroundColor: THEME.status.free,
                marginRight: "5px",
              }}
            ></div>
            空闲（可点击预约）
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                backgroundColor: THEME.status.reserved,
                marginRight: "5px",
              }}
            ></div>
            已预约
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                backgroundColor: THEME.status.occupied,
                marginRight: "5px",
              }}
            ></div>
            已占用
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                backgroundColor: THEME.status.abnormal,
                marginRight: "5px",
              }}
            ></div>
            异常占座
          </div>
        </div>
      </div>

      {/* 预约表单弹窗 */}
      {showReservationForm && selectedSeat && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
              backgroundColor: "rgba(79, 87, 88, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: THEME.panelBg,
              padding: "20px",
              borderRadius: "8px",
              border: `1px solid ${THEME.border}`,
              maxWidth: "400px",
              width: "90%",
            }}
          >
            <h3>预约座位 {selectedSeat.seat_number}</h3>
            <form onSubmit={handleReservationSubmit}>
              <div style={{ marginBottom: "15px" }}>
                <p>
                  点击预约后，座位进入“已预约”状态，系统仅保留15分钟。
                </p>
                <p>请在15分钟内到座并在“我的预约”中点击“已入座”。</p>
                <p>若已放弃请点击“取消”按钮。</p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  onClick={closeReservationForm}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#ddd7ce",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={reserving}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: reserving ? "#b2aba1" : THEME.primary,
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: reserving ? "not-allowed" : "pointer",
                  }}
                >
                  {reserving ? "预约中..." : "确认预约"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showReportForm && reportSeat && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(79, 87, 88, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: THEME.panelBg,
              padding: "20px",
              borderRadius: "8px",
              border: `1px solid ${THEME.border}`,
              maxWidth: "400px",
              width: "90%",
            }}
          >
            <h3>举报座位 {reportSeat.seat_number}</h3>
            <form onSubmit={handleReportSubmit}>
              <div style={{ marginBottom: "10px" }}>
                <label>
                  描述（必填或可选）:
                  <textarea
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    placeholder="例如：座位被占用却无人使用..."
                    style={{ width: "100%", height: "80px", marginTop: "8px" }}
                  />
                </label>
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label>
                  证据图片URL（可选）:
                  <input
                    type="text"
                    value={reportImageUrl}
                    onChange={(e) => setReportImageUrl(e.target.value)}
                    placeholder="http://..."
                    style={{ width: "100%", marginTop: "8px" }}
                  />
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowReportForm(false);
                    setReportSeat(null);
                  }}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#ddd7ce",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    backgroundColor: THEME.danger,
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  提交举报
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAdminStatusEdit && adminEditSeat && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(79, 87, 88, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: THEME.panelBg,
              padding: "20px",
              borderRadius: "8px",
              border: `1px solid ${THEME.border}`,
              maxWidth: "400px",
              width: "90%",
            }}
          >
            <h3>编辑座位状态 - {adminEditSeat.seat_number}</h3>
            <form onSubmit={handleAdminStatusChange}>
              <div style={{ marginBottom: "15px" }}>
                <label>
                  新状态:
                  <select
                    value={adminNewStatus}
                    onChange={(e) => setAdminNewStatus(Number(e.target.value))}
                    style={{
                      width: "100%",
                      marginTop: "8px",
                      padding: "8px",
                      borderRadius: "4px",
                      border: `1px solid ${THEME.border}`,
                    }}
                  >
                    <option value={0}>空闲</option>
                    <option value={1}>已预约</option>
                    <option value={2}>已占用</option>
                    <option value={3}>异常</option>
                  </select>
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminStatusEdit(false);
                    setAdminEditSeat(null);
                  }}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#ddd7ce",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    backgroundColor: THEME.primary,
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  更新状态
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 质疑表单弹窗 */}
      {showViolationForm && violationSeat && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(79, 87, 88, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: THEME.panelBg,
              padding: "20px",
              borderRadius: "8px",
              border: `1px solid ${THEME.border}`,
              maxWidth: "400px",
              width: "90%",
            }}
          >
            <h3>质疑占座 - 座位 {violationSeat.seat_number}</h3>
            <form onSubmit={handleViolationSubmit}>
              <div style={{ marginBottom: "15px" }}>
                <label>
                  质疑描述:
                  <textarea
                    value={violationDescription}
                    onChange={(e) => setViolationDescription(e.target.value)}
                    placeholder="请描述为什么认为这不是占座..."
                    required
                    style={{
                      width: "100%",
                      height: "100px",
                      marginTop: "8px",
                      padding: "8px",
                      borderRadius: "4px",
                      border: `1px solid ${THEME.border}`,
                    }}
                  />
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowViolationForm(false);
                    setViolationSeat(null);
                    setViolationDescription("");
                  }}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#ddd7ce",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    backgroundColor: THEME.primary,
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  提交质疑
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SeatMap;
