import React, { useState } from "react";
import axios from "axios";
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
    // 防止残留旧 token 造成身份串号
    sessionStorage.removeItem("token");
    try {
      const response = await axios.post(
        "http://localhost:5000/api/auth/login",
        formData,
      );
      setMessage(response.data.message);
      sessionStorage.setItem("token", response.data.token);
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
        border: "1px solid #ccc",
        borderRadius: "5px",
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
        <button type="submit">登录</button>
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
