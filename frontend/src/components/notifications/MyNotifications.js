import React, { useEffect, useState } from "react";
import api from "../../services/api";

const MyNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchNotifications = async () => {
    try {
      const response = await api.get("/reservations/notifications");
      const incoming = response.data || [];
      setNotifications((prev) => {
        const merged = [...incoming, ...prev];
        const uniqueMap = new Map();
        merged.forEach((item) => {
          if (!uniqueMap.has(item.id)) {
            uniqueMap.set(item.id, item);
          }
        });
        return Array.from(uniqueMap.values()).sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
        );
      });
      setLoading(false);
    } catch (err) {
      setError("获取消息提醒失败");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();

    const timer = setInterval(() => {
      fetchNotifications();
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  const getCardStyle = (type) => {
    if (type === "danger") {
      return {
        border: "1px solid #dc3545",
        backgroundColor: "#fff5f5",
      };
    }

    return {
      border: "1px solid #ffc107",
      backgroundColor: "#fffaf0",
    };
  };

  if (loading) return <div>加载消息中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ marginTop: "24px" }}>
      <h3>消息提醒</h3>
      <p style={{ color: "#666" }}>系统每30秒自动刷新一次提醒。</p>

      {notifications.length === 0 ? (
        <p>暂无消息提醒</p>
      ) : (
        <div style={{ display: "grid", gap: "10px", maxWidth: "760px" }}>
          {notifications.map((item) => (
            <div
              key={item.id}
              style={{
                ...getCardStyle(item.type),
                borderRadius: "8px",
                padding: "12px",
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: "6px" }}>
                {item.title}
              </div>
              <div style={{ marginBottom: "6px" }}>{item.message}</div>
              <div style={{ fontSize: "12px", color: "#666" }}>
                {item.createdAt
                  ? new Date(item.createdAt).toLocaleString("zh-CN")
                  : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyNotifications;
