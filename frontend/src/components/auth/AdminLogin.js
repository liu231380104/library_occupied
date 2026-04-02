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
      navigate("/dashboard");
    } catch (error) {
      sessionStorage.removeItem("token");
      setMessage(error.response?.data?.message || "登录失败");
    }
  };

  return (
    <div
      style={{
        maxWidth: "400px",
        margin: "50px auto",
        padding: "20px",
        border: "1px solid #ccc",
        borderRadius: "5px",
      }}
    >
      <h2>管理员登录</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>管理员用户名:</label>
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
        <button type="submit">登录</button>
      </form>
      {message && <p>{message}</p>}
      <p>
        <a href="/login">返回用户登录</a>
      </p>
    </div>
  );
};

export default AdminLogin;
