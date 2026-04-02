const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const router = express.Router();

// 中间件：验证JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "未提供访问令牌" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "令牌无效" });
    }
    req.user = user;
    next();
  });
};

// 获取座位区域列表（用于前端下拉框）
router.get("/areas", async (req, res) => {
  try {
    const connection = await db;
    const [rows] = await connection.query(
      "SELECT DISTINCT area FROM seats WHERE area IS NOT NULL AND area <> '' ORDER BY area ASC",
    );
    res.json(rows.map((item) => item.area));
  } catch (err) {
    console.error("Seat areas query error:", err);
    res.status(500).json({ error: "获取座位区域失败" });
  }
});

// 获取座位状态（支持按区域筛选）
router.get("/", async (req, res) => {
  const { area } = req.query;
  try {
    const connection = await db;

    let rows;
    if (area) {
      [rows] = await connection.query(
        "SELECT * FROM seats WHERE area = ? ORDER BY seat_number ASC",
        [area],
      );
    } else {
      [rows] = await connection.query(
        "SELECT * FROM seats ORDER BY area ASC, seat_number ASC",
      );
    }

    res.json(rows);
  } catch (err) {
    console.error("Seats query error:", err);
    res.status(500).json({ error: "数据库查询失败" });
  }
});

// YOLO 等实时识别服务释放座位
router.post("/release/:seatId", async (req, res) => {
  const { seatId } = req.params;
  try {
    const connection = await db;

    // 更新座位为可用
    await connection.query("UPDATE seats SET status = 0 WHERE seat_id = ?", [
      seatId,
    ]);

    // 如果有 active 预约，标记为 completed
    await connection.query(
      "UPDATE reservations SET res_status = 'completed', end_time = NOW() WHERE seat_id = ? AND res_status = 'active'",
      [seatId],
    );

    res.json({ message: "座位已释放，状态更新完成" });
  } catch (error) {
    console.error("Release seat error:", error);
    res.status(500).json({ message: "释放座位失败" });
  }
});

// 管理员修改座位状态
router.patch("/:seatId", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "权限不足" });
  }

  const { seatId } = req.params;
  const { status } = req.body;

  if (status === undefined || ![0, 1, 2, 3].includes(status)) {
    return res.status(400).json({ message: "无效的座位状态" });
  }

  try {
    const connection = await db;

    // 更新座位状态
    await connection.query("UPDATE seats SET status = ? WHERE seat_id = ?", [
      status,
      seatId,
    ]);

    res.json({ message: "座位状态已更新" });
  } catch (error) {
    console.error("Update seat status error:", error);
    res.status(500).json({ message: "更新座位状态失败" });
  }
});

module.exports = router;
