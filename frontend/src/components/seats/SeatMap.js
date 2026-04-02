import React, { useState, useEffect } from "react";
import api from "../../services/api";
import { getUserRole } from "../../utils/tokenUtils";

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
        ? await api.get("/seats", { params: { area } })
        : await api.get("/seats");
      setSeats(response.data);
      setLoading(false);
    } catch (err) {
      setError("获取座位信息失败");
      setLoading(false);
    }
  };

  const handleAreaChange = (e) => {
    const area = e.target.value;
    setSelectedArea(area);
    setLoading(true);
    fetchSeats(area);
  };

  const getSeatColor = (status) => {
    switch (status) {
      case 0:
        return "green"; // 空闲
      case 1:
        return "yellow"; // 已预约
      case 2:
        return "red"; // 已占用
      case 3:
        return "purple"; // 异常占座
      default:
        return "white";
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
      const response = await api.post("/violations", {
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
      alert("预约成功！请到座后在预约列表点击已入座");
      setShowReservationForm(false);
      setSelectedSeat(null);
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

  if (loading) return <div>加载中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ padding: "20px" }}>
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
          {role === "admin" && (
            <>
              <button
                onClick={async () => {
                  try {
                    const resp = await api.post("/detect-occupation", {
                      area: selectedArea || "A区",
                    });
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
                  backgroundColor: "#007bff",
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "10px",
          maxWidth: "600px",
        }}
      >
        {seats.map((seat) => (
          <div
            key={seat.seat_id}
            style={{
              width: "100px",
              height: "100px",
              backgroundColor: getSeatColor(seat.status),
              border: "2px solid #000",
              borderRadius: "5px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: role === "admin" || seat.status === 0 ? "pointer" : "not-allowed",
              color: seat.status === 1 ? "#000" : "#fff",
            }}
            onClick={() => handleSeatClick(seat)}
            title={
              seat.status === 0
                ? `点击预约 ${seat.seat_number}`
                : `${seat.seat_number} - ${getStatusText(seat.status)}`
            }
          >
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
                  border: "1px solid #dc3545",
                  borderRadius: "4px",
                  backgroundColor: "#fff",
                  color: "#dc3545",
                  cursor: "pointer",
                }}
              >
                举报状态
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: "20px" }}>
        <h3>图例</h3>
        <div style={{ display: "flex", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                backgroundColor: "green",
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
                backgroundColor: "yellow",
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
                backgroundColor: "red",
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
                backgroundColor: "purple",
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
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: "20px",
              borderRadius: "8px",
              maxWidth: "400px",
              width: "90%",
            }}
          >
            <h3>预约座位 {selectedSeat.seat_number}</h3>
            <form onSubmit={handleReservationSubmit}>
              <div style={{ marginBottom: "15px" }}>
                <p>
                  点击预约后，座位进入“已预约”状态。抵达后请在我的预约中点击“已入座”。
                </p>
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
                    backgroundColor: "#ccc",
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
                    backgroundColor: reserving ? "#ccc" : "#007bff",
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
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: "20px",
              borderRadius: "8px",
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
                    backgroundColor: "#ccc",
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
                    backgroundColor: "#dc3545",
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
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: "20px",
              borderRadius: "8px",
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
                      border: "1px solid #ccc",
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
                    backgroundColor: "#ccc",
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
                    backgroundColor: "#007bff",
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
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: "20px",
              borderRadius: "8px",
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
                      border: "1px solid #ccc",
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
                    backgroundColor: "#ccc",
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
                    backgroundColor: "#007bff",
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
