import React, { useState, useEffect } from "react";
import SeatMap from "../seats/SeatMap";
import MyReservations from "../reservations/MyReservations";
import MyReports from "../reports/MyReports";
import MyNotifications from "../notifications/MyNotifications";
import MyCreditStats from "../credit/MyCreditStats";
import AdminCenter from "../admin/AdminCenter";
import AdminCreditStats from "../admin/AdminCreditStats";
import AdminSimulateMonitor from "../admin/AdminSimulateMonitor";
import api from "../../services/api";
import { getCurrentUser, getUserRole } from "../../utils/tokenUtils";

const THEME = {
  asideBg: "#f1ede7",
  border: "#d8d2c9",
  primary: "#7f95a6",
  primaryText: "#ffffff",
  btnText: "#3e4748",
  danger: "#b78a84",
  noticeWarnBg: "#f3ece1",
  noticeWarnBorder: "#c4ab87",
  noticeDangerBg: "#f2e8e7",
  noticeDangerBorder: "#b78a84",
  text: "#3f4748",
  muted: "#646d6e",
};

const FLOATING_NOTICE_SYNC_INTERVAL_MS = 3000;

function getNoticeTtlMs(item) {
  const source = String(item?.source || "");
  const sourceKey = String(item?.sourceKey || "");
  const type = String(item?.type || "");

  if (source === "reservation" && sourceKey.startsWith("pending-")) {
    return 20 * 60 * 1000;
  }
  if (source === "reservation" && (sourceKey.startsWith("created-") || sourceKey.startsWith("auto-created-"))) {
    return 30 * 60 * 1000;
  }
  if (source === "presence" || source === "leave-presence" || type === "question") {
    return 3 * 60 * 60 * 1000;
  }
  if (source === "credit") {
    return 24 * 60 * 60 * 1000;
  }
  return 12 * 60 * 60 * 1000;
}

function isFreshFloatingNotice(item) {
  const createdAt = new Date(item?.createdAt || 0).getTime();
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  return Date.now() - createdAt <= getNoticeTtlMs(item);
}

const Dashboard = () => {
  const [role, setRole] = useState(null);
  const [username, setUsername] = useState("");
  const [creditScore, setCreditScore] = useState(null);
  const [accountStatus, setAccountStatus] = useState("active");
  const [activeTab, setActiveTab] = useState("seatMap");
  const [floatingNotice, setFloatingNotice] = useState(null);
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem("dismissedFloatingNoticeIds");
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    // 从 token 解析 role，而不是从 localStorage
    const currentRole = getUserRole();
    const currentUser = getCurrentUser();
    setRole(currentRole);
    setUsername(currentUser?.username || "");
    setCreditScore(Number(sessionStorage.getItem("creditScore")) || null);
    setAccountStatus(sessionStorage.getItem("accountStatus") || "active");
    setActiveTab(currentRole === "admin" ? "adminReports" : "seatMap");
  }, []);

  useEffect(() => {
    if (role === "admin" || !role) return;

    const refreshCreditStatus = async () => {
      try {
        const response = await api.get("/reports/my-credit-stats");
        const nextScore = Number(response.data?.profile?.credit_score);
        const nextStatus = response.data?.profile?.status || "active";
        if (Number.isFinite(nextScore)) {
          setCreditScore(nextScore);
          sessionStorage.setItem("creditScore", String(nextScore));
        }
        setAccountStatus(nextStatus);
        sessionStorage.setItem("accountStatus", nextStatus);
      } catch (error) {
        // 保留登录时的缓存值，避免页面直接空白
      }
    };

    refreshCreditStatus();
  }, [role]);

  useEffect(() => {
    const openAdminReports = () => {
      if (role === "admin") {
        setActiveTab("adminReports");
      }
    };
    window.addEventListener("openAdminReports", openAdminReports);
    return () => window.removeEventListener("openAdminReports", openAdminReports);
  }, [role]);

  useEffect(() => {
    if (role === "admin" || !role) {
      setFloatingNotice(null);
      return;
    }

    // 消息页自身会轮询，避免与浮窗轮询叠加造成重复请求
    if (activeTab === "notifications") {
      setFloatingNotice(null);
      return;
    }

    const fetchTopNotification = async () => {
      try {
        const response = await api.get("/reservations/notifications");
        const list = response.data || [];
        const visible = list.find(
          (item) => !item.isRead
            && !dismissedNoticeIds.includes(item.id)
            && isFreshFloatingNotice(item),
        );
        setFloatingNotice(visible || null);
      } catch (error) {
        setFloatingNotice(null);
      }
    };

    let refreshTimer = null;
    const scheduleRefresh = (delayMs = 0) => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        fetchTopNotification();
      }, Math.max(0, Number(delayMs) || 0));
    };

    fetchTopNotification();
    const timer = setInterval(fetchTopNotification, FLOATING_NOTICE_SYNC_INTERVAL_MS);

    let source;
    if (typeof EventSource !== "undefined") {
      source = new EventSource("/api/seats/stream");
      const handleSeatUpdate = (event) => {
        try {
          // 任何座位事件都可能驱动消息变化，做一次防抖刷新。
          JSON.parse(event.data || "{}");
          scheduleRefresh(120);
        } catch (e) {
          // ignore malformed events
        }
      };
      source.addEventListener("seat-update", handleSeatUpdate);
    }

    return () => {
      clearInterval(timer);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      if (source) {
        source.close();
      }
    };
  }, [role, dismissedNoticeIds, activeTab]);

  const markNoticeRead = async (notice) => {
    const notificationId = Number(notice?.notificationId);
    if (!Number.isInteger(notificationId) || notificationId <= 0) return;

    try {
      await api.patch("/reservations/notifications/read", {
        notificationIds: [notificationId],
      });
    } catch (e) {
      // 忽略标记失败，避免影响主流程
    }
  };

  const handleCloseFloatingNotice = () => {
    if (!floatingNotice?.id) {
      setFloatingNotice(null);
      return;
    }

    const nextIds = Array.from(
      new Set([...dismissedNoticeIds, floatingNotice.id]),
    );
    setDismissedNoticeIds(nextIds);
    sessionStorage.setItem(
      "dismissedFloatingNoticeIds",
      JSON.stringify(nextIds),
    );
    markNoticeRead(floatingNotice);
    setFloatingNotice(null);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", color: THEME.text }}>
      <aside
        style={{
          width: "220px",
          backgroundColor: THEME.asideBg,
          borderRight: `1px solid ${THEME.border}`,
          padding: "20px",
        }}
      >
        <h3 style={{ color: THEME.text }}>导航</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          <li>
            <button
              onClick={() => setActiveTab("seatMap")}
              style={{
                width: "100%",
                marginBottom: "8px",
                padding: "8px",
                backgroundColor: activeTab === "seatMap" ? THEME.primary : "#fff",
                color: activeTab === "seatMap" ? THEME.primaryText : THEME.btnText,
                border: `1px solid ${THEME.border}`,
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              座位地图
            </button>
          </li>
          {role !== "admin" && (
            <li>
              <button
                onClick={() => setActiveTab("reservations")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "reservations" ? THEME.primary : "#fff",
                  color: activeTab === "reservations" ? THEME.primaryText : THEME.btnText,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                我的预约
              </button>
            </li>
          )}
          {role !== "admin" && (
            <li>
              <button
                onClick={() => setActiveTab("notifications")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "notifications" ? THEME.primary : "#fff",
                  color: activeTab === "notifications" ? THEME.primaryText : THEME.btnText,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                消息提醒
              </button>
            </li>
          )}
          {role !== "admin" && (
            <li>
              <button
                onClick={() => setActiveTab("myCredit")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "myCredit" ? THEME.primary : "#fff",
                  color: activeTab === "myCredit" ? THEME.primaryText : THEME.btnText,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                我的信誉分
              </button>
            </li>
          )}
          {role !== "admin" && (
            <li>
              <button
                onClick={() => setActiveTab("myReports")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "myReports" ? THEME.primary : "#fff",
                  color: activeTab === "myReports" ? THEME.primaryText : THEME.btnText,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                我的举报
              </button>
            </li>
          )}
          {role === "admin" && (
            <li>
              <button
                onClick={() => setActiveTab("adminReports")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "adminReports" ? THEME.primary : "#fff",
                  color: activeTab === "adminReports" ? THEME.primaryText : THEME.btnText,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                举报中心
              </button>
            </li>
          )}
          {role === "admin" && (
            <li>
              <button
                onClick={() => setActiveTab("adminCredit")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "adminCredit" ? THEME.primary : "#fff",
                  color: activeTab === "adminCredit" ? THEME.primaryText : THEME.btnText,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                信誉统计
              </button>
            </li>
          )}
           {role === "admin" && (
            <li>
              <button
                onClick={() => setActiveTab("simulateMonitor")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "simulateMonitor" ? THEME.primary : "#fff",
                  color: activeTab === "simulateMonitor" ? THEME.primaryText : THEME.btnText,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                图片采样监控
              </button>
            </li>
          )}
        </ul>
        <div style={{ marginTop: "30px" }}>
          <button
            onClick={() => {
              sessionStorage.clear();
              window.location.href = "/login";
            }}
            style={{
              width: "100%",
              padding: "8px",
              backgroundColor: THEME.danger,
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            登出
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, padding: "20px" }}>
        <h2>欢迎来到图书馆座位管理系统</h2>
        <p>
          {role === "admin" ? "管理员" : "用户"}：{username || "未登录"}
        </p>
        {role !== "admin" && (
          <div
            style={{
              display: "inline-flex",
              gap: "10px",
              alignItems: "center",
              padding: "8px 12px",
              borderRadius: "999px",
              border: `1px solid ${accountStatus === "frozen" ? "#b78a84" : "#8ca79a"}`,
              backgroundColor: accountStatus === "frozen" ? "#f0e1df" : "#e1ebe5",
              color: accountStatus === "frozen" ? "#7a4f4a" : "#476457",
              marginBottom: "12px",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            <span>信誉分：{creditScore ?? 0}</span>
            <span>账号状态：{accountStatus === "frozen" ? "冻结" : "正常"}</span>
          </div>
        )}
        {role !== "admin" && creditScore !== null && creditScore <= 70 && (
          <div
            style={{
              marginBottom: "12px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: `1px solid ${creditScore < 60 ? "#b78a84" : "#c4ab87"}`,
              backgroundColor: creditScore < 60 ? "#f0e1df" : "#eee2d1",
              color: creditScore < 60 ? "#7a4f4a" : "#6f5740",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            {creditScore < 60
              ? "您的信誉分已过低，账号当前冻结，暂时无法预约，请尽快提升信誉分。"
              : "您的信誉分已低于提醒阈值，请注意保持良好使用记录，避免违规。"}
          </div>
        )}

         {activeTab === "seatMap" && <SeatMap />}
         {activeTab === "reservations" && <MyReservations />}
         {activeTab === "notifications" && <MyNotifications />}
         {activeTab === "myCredit" && <MyCreditStats />}
         {activeTab === "myReports" && <MyReports />}
         {activeTab === "adminReports" && <AdminCenter />}
         {activeTab === "adminCredit" && <AdminCreditStats />}
         {activeTab === "simulateMonitor" && <AdminSimulateMonitor />}
      </main>

      {role !== "admin" && floatingNotice && (
        <div
          style={{
            position: "fixed",
            right: "20px",
            top: "20px",
            zIndex: 1200,
            width: "360px",
            borderRadius: "10px",
            border:
              floatingNotice.type === "danger"
                ? `1px solid ${THEME.noticeDangerBorder}`
                : `1px solid ${THEME.noticeWarnBorder}`,
            backgroundColor:
              floatingNotice.type === "danger" ? THEME.noticeDangerBg : THEME.noticeWarnBg,
            boxShadow: "0 6px 18px rgba(0,0,0,0.16)",
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <strong>{floatingNotice.title || "消息提醒"}</strong>
            <button
              onClick={handleCloseFloatingNotice}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "16px",
                cursor: "pointer",
                lineHeight: 1,
              }}
              title="关闭"
            >
              ×
            </button>
          </div>
          <div style={{ marginBottom: "10px", fontSize: "14px" }}>
            {floatingNotice.message}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "12px", color: THEME.muted }}>
              {floatingNotice.createdAt
                ? new Date(floatingNotice.createdAt).toLocaleString("zh-CN")
                : ""}
            </span>
            <button
              onClick={async () => {
                await markNoticeRead(floatingNotice);
                setActiveTab("notifications");
                setFloatingNotice(null);
              }}
              style={{
                border: "none",
                backgroundColor: THEME.primary,
                color: "#fff",
                borderRadius: "4px",
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              查看详情
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
