import React, { useState, useEffect } from "react";
import api from "../../services/api";

const MyReservations = () => {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
    try {
      const response = await api.get("/reservations/my");
      setReservations(response.data);
      setLoading(false);
    } catch (err) {
      setError("获取预约记录失败");
      setLoading(false);
    }
  };

  const handleCancelReservation = async (reservationId) => {
    if (!window.confirm("确定要取消这个预约吗？")) {
      return;
    }

    try {
      await api.delete(`/reservations/${reservationId}`);
      alert("预约已取消");
      fetchReservations();
    } catch (err) {
      alert(err.response?.data?.message || "取消预约失败");
    }
  };

  const handleCheckin = async (reservationId) => {
    try {
      await api.post(`/reservations/${reservationId}/checkin`);
      alert("已入座，祝您学习愉快！");
      fetchReservations();
    } catch (err) {
      alert(err.response?.data?.message || "签到失败");
    }
  };

  const handleLeave = async (reservationId) => {
    try {
      await api.post(`/reservations/${reservationId}/leave`);
      alert("已离开，座位已释放");
      fetchReservations();
    } catch (err) {
      alert(err.response?.data?.message || "离开操作失败");
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case "pending":
        return "待签到";
      case "active":
        return "已入座";
      case "completed":
        return "已完成";
      case "cancelled":
        return "已取消";
      case "violated":
        return "违规";
      default:
        return "未知";
    }
  };

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case "pending":
        return { bg: "#eee2d1", text: "#6f5740", border: "#c4ab87" };
      case "active":
        return { bg: "#dde5ec", text: "#425867", border: "#7f95a6" };
      case "completed":
        return { bg: "#e1ebe5", text: "#476457", border: "#8ca79a" };
      case "cancelled":
        return { bg: "#ecefee", text: "#596263", border: "#9aa2a0" };
      case "violated":
        return { bg: "#f0e1df", text: "#7a4f4a", border: "#b78a84" };
      default:
        return { bg: "#ecefee", text: "#596263", border: "#9aa2a0" };
    }
  };

  if (loading) return <div>加载预约记录中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ marginTop: "30px", background: "#fcfbf8", border: "1px solid #d8d2c9", borderRadius: "10px", padding: "14px" }}>
      <h3>我的预约记录</h3>
      <div
        style={{
          marginBottom: "12px",
          padding: "8px 10px",
          borderRadius: "8px",
          border: "1px solid #c4ab87",
          backgroundColor: "#eee2d1",
          color: "#6f5740",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        提醒：每次预约仅保留15分钟，超时未签到将自动判定违规并扣除信誉分。
      </div>
      {reservations.length === 0 ? (
        <p>暂无预约记录</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {reservations.map((reservation) => (
            <div
              key={reservation.reservation_id}
              style={{
                border: "1px solid #d8d2c9",
                borderRadius: "8px",
                padding: "15px",
                backgroundColor: "#f6f2ec",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <h4>
                    座位: {reservation.seat_number} ({reservation.area})
                  </h4>
                  <p>
                    开始时间:{" "}
                    {new Date(reservation.start_time).toLocaleString()}
                  </p>
                  <p>
                    结束时间:{" "}
                    {reservation.end_time
                      ? new Date(reservation.end_time).toLocaleString()
                      : "未设置"}
                  </p>
                  <p>
                    状态:{" "}
                    <span
                      style={{
                        backgroundColor: getStatusBadgeStyle(reservation.res_status).bg,
                        color: getStatusBadgeStyle(reservation.res_status).text,
                        border: `1px solid ${getStatusBadgeStyle(reservation.res_status).border}`,
                        padding: "2px 8px",
                        borderRadius: "999px",
                        fontWeight: 600,
                      }}
                    >
                      {getStatusText(reservation.res_status)}
                    </span>
                  </p>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  {reservation.res_status === "pending" && (
                    <>
                      <button
                        onClick={() =>
                          handleCheckin(reservation.reservation_id)
                        }
                        style={{
                          padding: "8px 16px",
                          backgroundColor: "#7f95a6",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        已入座
                      </button>
                      <button
                        onClick={() =>
                          handleCancelReservation(reservation.reservation_id)
                        }
                        style={{
                          padding: "8px 16px",
                          backgroundColor: "#b78a84",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        取消预约
                      </button>
                    </>
                  )}

                  {reservation.res_status === "active" && (
                    <button
                      onClick={() => handleLeave(reservation.reservation_id)}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "#8ca79a",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      已离开
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyReservations;
