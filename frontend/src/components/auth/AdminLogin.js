import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const AdminLogin = () => {
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // 每次管理员登录前先清掉旧会话，避免沿用之前的 user token
    sessionStorage.removeItem("token");
    try {
      const response = await axios.post(
        "http://localhost:5000/api/auth/login",
        formData,
      );
      if (response.data.role !== "admin") {
        sessionStorage.removeItem("token");
        setMessage(`登录账号不是管理员（当前角色：${response.data.role || "unknown"}）`);
        return;
      }
      setMessage(response.data.message);
      sessionStorage.setItem("token", response.data.token);
      sessionStorage.setItem("creditScore", String(response.data.credit_score ?? ""));
      sessionStorage.setItem("accountStatus", response.data.status || "active");
      navigate("/dashboard");
    } catch (error) {
      sessionStorage.removeItem("token");
      setMessage(error.response?.data?.message || "登录失败");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 16px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "400px",
          margin: "0 auto",
          padding: "20px",
          border: "1px solid #d8d2c9",
          borderRadius: "8px",
          backgroundColor: "#fcfbf8",
          boxSizing: "border-box",
          transform: "translateY(-14px)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>管理员登录</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <label style={{ width: "64px", flexShrink: 0 }}>用户名:</label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              required
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <label style={{ width: "64px", flexShrink: 0 }}>密码:</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box" }}
            />
          </div>
          <button type="submit" style={{ background: "#7f95a6", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 14px", marginTop: "10px", cursor: "pointer" }}>登录</button>
        </form>
        {message && <p>{message}</p>}
        <p>
          <a href="/login">返回用户登录</a>
        </p>
      </div>
    </div>
  );
};

export default AdminLogin;
