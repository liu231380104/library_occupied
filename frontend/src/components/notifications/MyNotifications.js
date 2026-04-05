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

  const handlePresencePrompt = async (promptId, isSelf) => {
    if (!promptId) return;
    setProcessingPromptId(promptId);
    try {
      const response = await api.post(`/reservations/presence-prompts/${promptId}/respond`, {
        isSelf,
      });
      alert(response.data?.message || "已提交确认");
      await fetchNotifications();
    } catch (err) {
      alert(err.response?.data?.message || "提交确认失败");
    } finally {
      setProcessingPromptId(null);
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
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: "6px" }}>
                {item.title}
              </div>
              <div style={{ marginBottom: "6px", color: "#454d4e" }}>{item.message}</div>
              {item.type === "question" && item.action?.promptId && (
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <button
                    onClick={() => handlePresencePrompt(item.action.promptId, true)}
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
                    是本人入座
                  </button>
                  <button
                    onClick={() => handlePresencePrompt(item.action.promptId, false)}
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
                    不是我
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
