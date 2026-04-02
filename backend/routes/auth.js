const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const router = express.Router();

// 注册
router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  console.log("Register request:", req.body);

  if (!username || !password) {
    return res.status(400).json({ message: "用户名和密码都是必填的" });
  }

  try {
    const connection = await db;
    // 检查用户名是否已存在
    const [results] = await connection.query(
      "SELECT * FROM users WHERE username = ?",
      [username],
    );

    if (results.length > 0) {
      return res.status(400).json({ message: "用户名已存在" });
    }

    // 生成用户ID（可改成UUID库）
    const userId = `u-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 插入用户
    await connection.query(
      "INSERT INTO users (user_id, username, password) VALUES (?, ?, ?)",
      [userId, username, hashedPassword],
    );

    res.status(201).json({ message: "注册成功" });
  } catch (error) {
    console.log("Server error:", error);
    res.status(500).json({ message: "服务器错误" });
  }
});

// 登录
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log("Login request:", req.body);

  if (!username || !password) {
    return res.status(400).json({ message: "用户名和密码都是必填的" });
  }

  try {
    const connection = await db;
    // 查找用户
    const [results] = await connection.query(
      "SELECT * FROM users WHERE username = ?",
      [username],
    );

    if (results.length === 0) {
      return res.status(401).json({ message: "用户名或密码错误" });
    }

    const user = results[0];

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "用户名或密码错误" });
    }

    // 生成JWT token（包含 role 方便权限判断）
    const userRole = user.role || "user";
    const token = jwt.sign(
      {
        userId: user.user_id,
        username: user.username,
        role: userRole,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.json({ message: "登录成功", token, role: userRole });
  } catch (error) {
    console.log("Server error:", error);
    res.status(500).json({ message: "服务器错误" });
  }
});

module.exports = router;
