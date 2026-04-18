import React, { useEffect, useState } from "react";
import api from "../../services/api";

const MyNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processingPromptId, setProcessingPromptId] = useState(null);

  const fetchNotifications = async () => {
    try {
      const response = await api.get("/reservations/notifications");
      const incoming = response.data || [];
      setNotifications((prev) => {

        const byId = new Map();
        prev.forEach((item) => {
          if (item?.id != null) byId.set(item.id, item);
        });
        // 覆盖最新的服务器有效载荷（以服务器为准）
        incoming.forEach((item) => {
          if (item?.id != null) byId.set(item.id, item);
        });

        return Array.from(byId.values()).sort(
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
    if (type === "question") {
      return {
        border: "1px solid #7f95a6",
        backgroundColor: "#e7edf2",
      };
    }

    if (type === "danger") {
      return {
        border: "1px solid #b78a84",
        backgroundColor: "#f2e8e7",
      };
    }

    return {
      border: "1px solid #c4ab87",
      backgroundColor: "#f3ece1",
    };
  };

  const handlePromptAction = async (action, value) => {
    const promptId = action?.promptId;
    const kind = action?.kind || "presence";
    if (!promptId) return;
    setProcessingPromptId(promptId);

    // 仅在用户实际点击后乐观地将此通知标记为已读。
    // 这可以避免在用户采取行动之前显示“灰色”。
    if (Number.isInteger(Number(action?.notificationId))) {
      const nid = Number(action.notificationId);
      setNotifications((prev) =>
        prev.map((n) =>
          Number(n?.notificationId) === nid ? { ...n, isRead: true } : n,
        ),
      );
    }
    try {
      const endpoint =
        kind === "leave"
          ? `/reservations/leave-prompts/${promptId}/respond`
          : `/reservations/presence-prompts/${promptId}/respond`;
      const body = kind === "leave" ? { shouldRelease: value } : { isSelf: value };

      const response = await api.post(endpoint, body);
      if (Number.isInteger(Number(action?.notificationId))) {
        try {
          await api.patch("/reservations/notifications/read", {
            notificationIds: [Number(action.notificationId)],
          });
        } catch (e) {
          // ignore read mark failure
        }
      }
      alert(response.data?.message || "已提交确认");
      await fetchNotifications();
    } catch (err) {
      alert(err.response?.data?.message || "提交确认失败");
    } finally {
      setProcessingPromptId(null);
    }
  };

  const handleMarkRead = async (item) => {
    const notificationId = Number(item?.notificationId);
    if (!Number.isInteger(notificationId) || notificationId <= 0) return;

    try {
      // Optimistic UI: user clicked "mark read" => grey immediately.
      setNotifications((prev) =>
        prev.map((n) =>
          Number(n?.notificationId) === notificationId
            ? { ...n, isRead: true }
            : n,
        ),
      );
      await api.patch("/reservations/notifications/read", {
        notificationIds: [notificationId],
      });
      await fetchNotifications();
    } catch (err) {
      // If server call fails, revert optimistic state.
      setNotifications((prev) =>
        prev.map((n) =>
          Number(n?.notificationId) === notificationId
            ? { ...n, isRead: false }
            : n,
        ),
      );
      alert(err.response?.data?.message || "标记已读失败");
    }
  };

  if (loading) return <div>加载消息中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ marginTop: "24px", background: "#fcfbf8", border: "1px solid #d8d2c9", borderRadius: "10px", padding: "14px" }}>
      <h3>消息提醒</h3>
      <p style={{ color: "#5f6768" }}>系统每30秒自动刷新一次提醒。</p>

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
                opacity: item.isRead ? 0.72 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ fontWeight: "bold" }}>{item.title}</div>
                <button
                  onClick={() => handleMarkRead(item)}
                  disabled={item.isRead}
                  style={{
                    padding: "4px 8px",
                    backgroundColor: item.isRead ? "#a7b1b4" : "#7f95a6",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: item.isRead ? "not-allowed" : "pointer",
                    fontSize: "12px",
                  }}
                >
                  {item.isRead ? "已读" : "标记已读"}
                </button>
              </div>
              <div style={{ marginBottom: "6px", color: "#454d4e" }}>{item.message}</div>
              {item.type === "question" && item.action?.promptId && (
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <button
                    onClick={() => handlePromptAction({ ...item.action, notificationId: item.notificationId }, true)}
                    disabled={processingPromptId === item.action.promptId}
                    style={{
                      padding: "6px 10px",
                      backgroundColor: "#7f95a6",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: processingPromptId === item.action.promptId ? "not-allowed" : "pointer",
                    }}
                  >
                    {item.action?.kind === "leave" ? "是，释放座位" : "是本人入座"}
                  </button>
                  <button
                    onClick={() => handlePromptAction({ ...item.action, notificationId: item.notificationId }, false)}
                    disabled={processingPromptId === item.action.promptId}
                    style={{
                      padding: "6px 10px",
                      backgroundColor: "#b78a84",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: processingPromptId === item.action.promptId ? "not-allowed" : "pointer",
                    }}
                  >
                    {item.action?.kind === "leave" ? "否，临时离开" : "不是我"}
                  </button>
                </div>
              )}
              <div style={{ fontSize: "12px", color: "#646d6e" }}>
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
