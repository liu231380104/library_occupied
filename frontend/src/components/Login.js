import React, { useState } from "react";
import api from "../services/api";
import { useNavigate } from "react-router-dom";

const Login = () => {
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
    try {
      const response = await api.post("/auth/login", formData);
      setMessage(response.data.message);
      sessionStorage.setItem("token", response.data.token);
      sessionStorage.setItem("creditScore", String(response.data.credit_score ?? ""));
      sessionStorage.setItem("accountStatus", response.data.status || "active");
      navigate("/dashboard");
    } catch (error) {
      setMessage(error.response?.data?.message || "登录失败");
    }
  };

  return (
    <div
      style={{
        maxWidth: "400px",
        margin: "50px auto",
        padding: "20px",
        border: "1px solid #d8d2c9",
        borderRadius: "8px",
        backgroundColor: "#fcfbf8",
      }}
    >
      <h2>用户登录</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>用户名:</label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label>密码:</label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
          />
        </div>
        <button type="submit" style={{ background: "#7f95a6", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 14px", marginTop: "10px", cursor: "pointer" }}>登录</button>
      </form>
      {message && <p>{message}</p>}
      <p>
        <a href="/register">没有账号？注册</a>
      </p>
      <p>
        <a href="/admin-login">管理员登录</a>
      </p>
    </div>
  );
};

export default Login;
