import React, { useState, useEffect } from "react";
import SeatMap from "../seats/SeatMap";
import MyReservations from "../reservations/MyReservations";
import MyReports from "../reports/MyReports";
import MyNotifications from "../notifications/MyNotifications";
import MyCreditStats from "../credit/MyCreditStats";
import AdminCenter from "../admin/AdminCenter";
import AdminCreditStats from "../admin/AdminCreditStats";
import AdminSeatConfig from "../admin/AdminSeatConfig";
import api from "../../services/api";
import { getCurrentUser, getUserRole } from "../../utils/tokenUtils";

const Dashboard = () => {
  const [role, setRole] = useState(null);
  const [username, setUsername] = useState("");
  const [activeTab, setActiveTab] = useState("seatMap");
  const [keepAdminSeatConfigMounted, setKeepAdminSeatConfigMounted] = useState(false);
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
    setActiveTab(currentRole === "admin" ? "adminReports" : "seatMap");
  }, []);

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
    if (role === "admin" && activeTab === "adminSeatConfig") {
      setKeepAdminSeatConfigMounted(true);
    }
  }, [role, activeTab]);

  useEffect(() => {
    if (role === "admin" || !role) {
      setFloatingNotice(null);
      return;
    }

    const fetchTopNotification = async () => {
      try {
        const response = await api.get("/reservations/notifications");
        const list = response.data || [];
        const visible = list.find(
          (item) => !dismissedNoticeIds.includes(item.id),
        );
        setFloatingNotice(visible || null);
      } catch (error) {
        setFloatingNotice(null);
      }
    };

    fetchTopNotification();
    const timer = setInterval(fetchTopNotification, 30000);
    return () => clearInterval(timer);
  }, [role, dismissedNoticeIds]);

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
    setFloatingNotice(null);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: "220px",
          backgroundColor: "#f4f4f4",
          borderRight: "1px solid #ddd",
          padding: "20px",
        }}
      >
        <h3>导航</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          <li>
            <button
              onClick={() => setActiveTab("seatMap")}
              style={{
                width: "100%",
                marginBottom: "8px",
                padding: "8px",
                backgroundColor: activeTab === "seatMap" ? "#007bff" : "#fff",
                color: activeTab === "seatMap" ? "#fff" : "#000",
                border: "1px solid #ccc",
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
                    activeTab === "reservations" ? "#007bff" : "#fff",
                  color: activeTab === "reservations" ? "#fff" : "#000",
                  border: "1px solid #ccc",
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
                    activeTab === "notifications" ? "#007bff" : "#fff",
                  color: activeTab === "notifications" ? "#fff" : "#000",
                  border: "1px solid #ccc",
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
                    activeTab === "myCredit" ? "#007bff" : "#fff",
                  color: activeTab === "myCredit" ? "#fff" : "#000",
                  border: "1px solid #ccc",
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
                    activeTab === "myReports" ? "#007bff" : "#fff",
                  color: activeTab === "myReports" ? "#fff" : "#000",
                  border: "1px solid #ccc",
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
                    activeTab === "adminReports" ? "#007bff" : "#fff",
                  color: activeTab === "adminReports" ? "#fff" : "#000",
                  border: "1px solid #ccc",
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
                    activeTab === "adminCredit" ? "#007bff" : "#fff",
                  color: activeTab === "adminCredit" ? "#fff" : "#000",
                  border: "1px solid #ccc",
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
                onClick={() => setActiveTab("adminSeatConfig")}
                style={{
                  width: "100%",
                  marginBottom: "8px",
                  padding: "8px",
                  backgroundColor:
                    activeTab === "adminSeatConfig" ? "#007bff" : "#fff",
                  color: activeTab === "adminSeatConfig" ? "#fff" : "#000",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                视频座位配置
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
              backgroundColor: "#dc3545",
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

        {activeTab === "seatMap" && <SeatMap />}
        {activeTab === "reservations" && <MyReservations />}
        {activeTab === "notifications" && <MyNotifications />}
        {activeTab === "myCredit" && <MyCreditStats />}
        {activeTab === "myReports" && <MyReports />}
        {activeTab === "adminReports" && <AdminCenter />}
        {activeTab === "adminCredit" && <AdminCreditStats />}
        {role === "admin" && keepAdminSeatConfigMounted && (
          <div style={{ display: activeTab === "adminSeatConfig" ? "block" : "none" }}>
            <AdminSeatConfig />
          </div>
        )}
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
                ? "1px solid #dc3545"
                : "1px solid #ffc107",
            backgroundColor:
              floatingNotice.type === "danger" ? "#fff5f5" : "#fffaf0",
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
            <span style={{ fontSize: "12px", color: "#666" }}>
              {floatingNotice.createdAt
                ? new Date(floatingNotice.createdAt).toLocaleString("zh-CN")
                : ""}
            </span>
            <button
              onClick={() => setActiveTab("notifications")}
              style={{
                border: "none",
                backgroundColor: "#007bff",
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
