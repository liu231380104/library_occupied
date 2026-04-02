import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const Register = () => {
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
      const response = await axios.post(
        "http://localhost:5000/api/auth/register",
        formData,
      );
      setMessage(response.data.message);
      if (response.status === 201) {
        navigate("/login");
      }
    } catch (error) {
      setMessage(error.response?.data?.message || "注册失败");
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
      <h2>用户注册</h2>
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
        <button type="submit">注册</button>
      </form>
      {message && <p>{message}</p>}
      <p>
        <a href="/login">已有账号？登录</a>
      </p>
    </div>
  );
};

export default Register;
