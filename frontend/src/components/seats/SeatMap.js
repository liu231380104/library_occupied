import React, { useState, useEffect } from "react";
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
      const ts = Number(response?.data?.lastDetectionAt);
      setLastDetectionAt(Number.isFinite(ts) && ts > 0 ? ts : null);
    } catch (err) {
      setLastDetectionAt(null);
    }
  };

  useEffect(() => {
    if (!selectedArea) return undefined;

    let polling = false;

    const refreshSeatsOnly = async () => {
      if (polling) return;
      polling = true;
      try {
        await Promise.all([fetchSeats(selectedArea), fetchDetectionStatus()]);
      } finally {
        polling = false;
      }
    };

    refreshSeatsOnly();

    const timer = setInterval(() => {
      refreshSeatsOnly();
    }, 10000);

    return () => clearInterval(timer);
  }, [selectedArea]);

  const handleAreaChange = (e) => {
    const area = e.target.value;
    setSelectedArea(area);
    setAutoReserveHint("");
    setAutoReserveRecommendations([]);
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

  // 仅调整左侧网格展示顺序：尽量与右侧座位图空间位置一致（先上后下，再左到右）
  const orderedSeats = [...seats].sort((a, b) => {
    const aBox = Array.isArray(a?.seat_bbox) && a.seat_bbox.length === 4 ? a.seat_bbox : null;
    const bBox = Array.isArray(b?.seat_bbox) && b.seat_bbox.length === 4 ? b.seat_bbox : null;

    if (aBox && bBox) {
      const aCenterY = (Number(aBox[1]) + Number(aBox[3])) / 2;
      const bCenterY = (Number(bBox[1]) + Number(bBox[3])) / 2;
      const aCenterX = (Number(aBox[0]) + Number(aBox[2])) / 2;
      const bCenterX = (Number(bBox[0]) + Number(bBox[2])) / 2;

      // 同一“行”容差，避免轻微检测抖动导致顺序跳动
      if (Math.abs(aCenterY - bCenterY) <= 24) {
        return aCenterX - bCenterX;
      }
      return aCenterY - bCenterY;
    }

    if (aBox && !bBox) return -1;
    if (!aBox && bBox) return 1;

    const aNum = Number(String(a?.seat_number || "").replace(/\D/g, "")) || Number(a?.seat_id) || 0;
    const bNum = Number(String(b?.seat_number || "").replace(/\D/g, "")) || Number(b?.seat_id) || 0;
    return aNum - bNum;
  });

  const freeSeats = orderedSeats.filter((seat) => Number(seat?.status) === 0);
  const highlightedSeatId = focusedSeatId;
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
        previewOnly: true,
      });
      const recommendations = Array.isArray(response?.data?.recommendations)
        ? response.data.recommendations
        : [];
      if (recommendations.length === 0 && response?.data?.seat?.seat_id) {
        setAutoReserveHint("后端当前仍在执行旧版直接预约逻辑，请重启后端服务后重试推荐预览。");
        return;
      }
      setAutoReserveRecommendations(recommendations);
      if (recommendations.length > 0) {
        const top = recommendations[0];
        const topReasons = Array.isArray(top?.reasons) ? top.reasons.join("，") : "";
        setAutoReserveHint(
          `已生成 ${recommendations.length} 个推荐，首选 ${top.area}${top.seat_number}${topReasons ? `（${topReasons}）` : ""}`,
        );
      } else {
        setAutoReserveHint(response?.data?.message || "暂无可推荐座位");
      }
    } catch (err) {
      alert(err.response?.data?.message || "一键预约失败，请稍后重试");
    } finally {
      setAutoReserving(false);
    }
  };

  const handlePickRecommendedSeat = (recommendation) => {
    const seatId = Number(recommendation?.seat_id);
    if (!Number.isInteger(seatId)) return;

    const seat = seats.find((item) => Number(item?.seat_id) === seatId);
    if (!seat || Number(seat.status) !== 0) {
      alert("该推荐座位状态已变化，请重新生成推荐");
      fetchSeats(selectedArea);
      return;
    }

    const isSameFocusedSeat = Number(focusedSeatId) === seatId;
    const isSameSelectedSeat = Number(selectedSeat?.seat_id) === seatId;

    setFocusedSeatId(seatId);
    setHoveredSeatId(seatId);
    setSelectedSeat(seat);

    // 第一次点击仅定位高亮，第二次点击同一推荐才弹出预约确认
    if (isSameFocusedSeat && isSameSelectedSeat) {
      setShowReservationForm(true);
    } else {
      setShowReservationForm(false);
      setAutoReserveHint(`已定位 ${seat.area}${seat.seat_number}，再次点击该推荐可弹出预约确认`);
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
                {autoReserving ? "生成中..." : "生成智能推荐"}
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
                      },
                      { timeout: 300000 },
                    );
                    const latestVideoUrl = resp?.data?.videoUrl || "";
                    if (latestVideoUrl) {
                      sessionStorage.setItem("latestOccupationVideoUrl", latestVideoUrl);
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
        {role !== "admin" && autoReserveRecommendations.length > 0 && (
          <div
            style={{
              width: "100%",
              marginBottom: "8px",
              padding: "10px",
              borderRadius: "8px",
              border: `1px solid ${THEME.primary}`,
              background: "#e7edf2",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "8px", color: "#425867" }}>
              智能推荐座位（先定位高亮，再次点击同一项确认预约）
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {autoReserveRecommendations.map((item) => (
                <button
                  key={`auto-rec-${item.seat_id}`}
                  onClick={() => handlePickRecommendedSeat(item)}
                  style={{
                    border: `1px solid ${THEME.primary}`,
                    borderRadius: "6px",
                    padding: "6px 10px",
                    background: "#fff",
                    color: "#425867",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  title={Array.isArray(item?.reasons) ? item.reasons.join("，") : ""}
                >
                  {item.rank}. {item.area}{item.seat_number}
                </button>
              ))}
            </div>
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
            {seatMapPreviewUrl ? (
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
                <img
                  src={seatMapPreviewUrl}
                  alt="seat-map-preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
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
                        pointerEvents: "none",
                      }}
                    >
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
