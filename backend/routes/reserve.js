// 预约/签到逻辑路由
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const router = express.Router();

// 处理超时未签到预约：超过15分钟自动记为违规并扣5信誉分
const expireOverduePendingReservations = async (connection) => {
  const [overdueRows] = await connection.query(
    `SELECT reservation_id, user_id, seat_id
     FROM reservations
     WHERE res_status = 'pending'
       AND created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
  );

  if (overdueRows.length === 0) {
    return;
  }

  const reservationIds = overdueRows.map((row) => row.reservation_id);
  const seatIds = overdueRows.map((row) => row.seat_id);
  const userIds = overdueRows.map((row) => row.user_id);

  await connection.query(
    `UPDATE reservations
     SET res_status = 'violated', end_time = NOW()
     WHERE reservation_id IN (?)`,
    [reservationIds],
  );

  await connection.query("UPDATE seats SET status = 0 WHERE seat_id IN (?)", [
    seatIds,
  ]);

  await connection.query(
    `UPDATE users
     SET credit_score = GREATEST(0, credit_score - 5)
     WHERE user_id IN (?)`,
    [userIds],
  );
};

// 中间件：验证JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  console.log(`[AUTH] ${req.method} ${req.originalUrl}`);

  if (!token) {
    console.log("[AUTH] missing token");
    return res.status(401).json({ message: "未提供访问令牌" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log("[AUTH] token invalid");
      return res.status(403).json({ message: "令牌无效" });
    }
    req.user = user;
    console.log(
      `[AUTH] ok user=${user.username || user.userId} role=${user.role || "unknown"}`,
    );
    next();
  });
};

// 创建预约（不直接设置结束时间，仅挂起后续签到）
router.post("/", authenticateToken, async (req, res) => {
  const { seatId } = req.body;
  const userId = req.user.userId;

  console.log("Reservation request:", req.body);
  console.log("User ID from token:", userId);

  if (!seatId) {
    return res.status(400).json({ message: "座位ID为必填字段" });
  }

  try {
    const connection = await db;

    await expireOverduePendingReservations(connection);

    // 检查座位是否存在且为空闲状态
    const [seatRows] = await connection.query(
      "SELECT * FROM seats WHERE seat_id = ? AND status = 0",
      [seatId],
    );

    if (seatRows.length === 0) {
      return res.status(400).json({ message: "座位不存在或当前不可预约" });
    }

    // 检查用户是否已有未完成的预约
    const [existingReservations] = await connection.query(
      "SELECT * FROM reservations WHERE user_id = ? AND res_status IN ('pending', 'active')",
      [userId],
    );

    if (existingReservations.length > 0) {
      return res
        .status(400)
        .json({ message: "您已有未完成的预约，请先完成或取消后再预约" });
    }

    // 兼容旧库结构：end_time 可能为 NOT NULL，因此先写入 NOW() 占位，离开/违规时会再更新
    const [result] = await connection.query(
      "INSERT INTO reservations (user_id, seat_id, start_time, end_time, res_status) VALUES (?, ?, NOW(), NOW(), 'pending')",
      [userId, seatId],
    );

    // 更新座位状态为已预约（pending）
    await connection.query("UPDATE seats SET status = 1 WHERE seat_id = ?", [
      seatId,
    ]);

    res.status(201).json({
      message: "预约成功，请到座后点击“已入座”",
      reservationId: result.insertId,
    });
  } catch (error) {
    console.error("Reservation error:", error);
    res.status(500).json({ message: "预约失败，请稍后重试" });
  }
});

// 取消预约
router.delete("/:reservationId", authenticateToken, async (req, res) => {
  const { reservationId } = req.params;
  const userId = req.user.userId;

  try {
    const connection = await db;

    await expireOverduePendingReservations(connection);

    // 查找预约记录
    const [reservations] = await connection.query(
      "SELECT * FROM reservations WHERE reservation_id = ? AND user_id = ? AND res_status = 'pending'",
      [reservationId, userId],
    );

    if (reservations.length === 0) {
      return res.status(404).json({ message: "预约记录不存在或无法取消" });
    }

    const reservation = reservations[0];

    // 更新预约状态为已取消
    await connection.query(
      "UPDATE reservations SET res_status = 'cancelled' WHERE reservation_id = ?",
      [reservationId],
    );

    // 更新座位状态为空闲
    await connection.query("UPDATE seats SET status = 0 WHERE seat_id = ?", [
      reservation.seat_id,
    ]);

    res.json({ message: "预约已取消" });
  } catch (error) {
    console.error("Cancel reservation error:", error);
    res.status(500).json({ message: "取消预约失败" });
  }
});

// 已入座
router.post("/:reservationId/checkin", authenticateToken, async (req, res) => {
  const { reservationId } = req.params;
  const userId = req.user.userId;

  try {
    const connection = await db;

    await expireOverduePendingReservations(connection);

    const [reservations] = await connection.query(
      "SELECT * FROM reservations WHERE reservation_id = ? AND user_id = ? AND res_status = 'pending'",
      [reservationId, userId],
    );

    if (reservations.length === 0) {
      return res.status(404).json({ message: "可签到预约未找到或状态异常" });
    }

    const reservation = reservations[0];

    // 设置有人成座状态
    await connection.query(
      "UPDATE reservations SET res_status = 'active', actual_check_in = NOW() WHERE reservation_id = ?",
      [reservationId],
    );

    await connection.query("UPDATE seats SET status = 2 WHERE seat_id = ?", [
      reservation.seat_id,
    ]);

    // 入座奖励：信誉分+2，最高100分
    await connection.query(
      "UPDATE users SET credit_score = LEAST(100, credit_score + 2) WHERE user_id = ?",
      [userId],
    );

    res.json({ message: "已入座，状态已更新" });
  } catch (error) {
    console.error("Checkin error:", error);
    res.status(500).json({ message: "签到失败" });
  }
});

// 离开
router.post("/:reservationId/leave", authenticateToken, async (req, res) => {
  const { reservationId } = req.params;
  const userId = req.user.userId;

  try {
    const connection = await db;

    const [reservations] = await connection.query(
      "SELECT * FROM reservations WHERE reservation_id = ? AND user_id = ? AND res_status = 'active'",
      [reservationId, userId],
    );

    if (reservations.length === 0) {
      return res.status(404).json({ message: "有效活动预约未找到" });
    }

    const reservation = reservations[0];
    const now = new Date();
    const formatMysqlDatetime = (d) => {
      const pad = (n) => String(n).padStart(2, "0");
      return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes()) +
        ":" +
        pad(d.getSeconds())
      );
    };

    await connection.query(
      "UPDATE reservations SET res_status = 'completed', end_time = ? WHERE reservation_id = ?",
      [formatMysqlDatetime(now), reservationId],
    );

    await connection.query("UPDATE seats SET status = 0 WHERE seat_id = ?", [
      reservation.seat_id,
    ]);

    res.json({ message: "已离开，座位已释放" });
  } catch (error) {
    console.error("Leave error:", error);
    res.status(500).json({ message: "离开操作失败" });
  }
});

// 获取用户的预约记录
router.get("/my", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const connection = await db;

    await expireOverduePendingReservations(connection);

    const [reservations] = await connection.query(
      `
      SELECT r.*,
             COALESCE(s.seat_number, CONCAT('已删除座位#', r.seat_id)) AS seat_number,
             COALESCE(s.area, '历史区域') AS area
      FROM reservations r
      LEFT JOIN seats s ON r.seat_id = s.seat_id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `,
      [userId],
    );

    res.json(reservations);
  } catch (error) {
    console.error("Get reservations error:", error);
    res.status(500).json({ message: "获取预约记录失败" });
  }
});

// 获取用户提醒消息
router.get("/notifications", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const connection = await db;

    await expireOverduePendingReservations(connection);

    // 1) 待签到超过10分钟的提醒（15分钟规则）
    const [pendingRows] = await connection.query(
      `SELECT r.reservation_id, r.start_time, s.seat_number, s.area,
              TIMESTAMPDIFF(MINUTE, r.start_time, NOW()) AS elapsed_minutes
       FROM reservations r
       LEFT JOIN seats s ON r.seat_id = s.seat_id
       WHERE r.user_id = ?
         AND r.res_status = 'pending'
         AND TIMESTAMPDIFF(MINUTE, r.start_time, NOW()) >= 10
         AND TIMESTAMPDIFF(MINUTE, r.start_time, NOW()) < 15
       ORDER BY r.start_time DESC`,
      [userId],
    );

    // 2) 最近24小时内的违规提醒
    const [violatedRows] = await connection.query(
      `SELECT r.reservation_id, r.end_time,
              COALESCE(s.seat_number, CONCAT('已删除座位#', r.seat_id)) AS seat_number,
              COALESCE(s.area, '历史区域') AS area
       FROM reservations r
       LEFT JOIN seats s ON r.seat_id = s.seat_id
       WHERE r.user_id = ?
         AND r.res_status = 'violated'
         AND r.end_time >= DATE_SUB(NOW(), INTERVAL 1 DAY)
       ORDER BY r.end_time DESC`,
      [userId],
    );

    const reminders = pendingRows.map((row) => {
      const remain = Math.max(0, 15 - Number(row.elapsed_minutes || 0));
      return {
        id: `pending-${row.reservation_id}`,
        type: "warning",
        title: "预约即将超时",
        message: `您在${row.area}${row.seat_number}的预约还剩${remain}分钟留存时间，请尽快到座签到。`,
        createdAt: row.start_time,
      };
    });

    const violatedAlerts = violatedRows.map((row) => ({
      id: `violated-${row.reservation_id}`,
      type: "danger",
      title: "预约已违规",
      message: `您在${row.area}${row.seat_number}的预约超过15分钟未签到，系统已判定违规并扣除5信誉分。`,
      createdAt: row.end_time,
    }));

    const notifications = [...reminders, ...violatedAlerts].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    res.json(notifications);
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ message: "获取消息提醒失败" });
  }
});

module.exports = router;
