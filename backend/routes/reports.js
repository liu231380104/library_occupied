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

// 用户提交举报（座位异常、占座等）
router.post("/", authenticateToken, async (req, res) => {
  const { seatId, description, evidence_img } = req.body;
  const reporterId = req.user.userId;

  if (!seatId) {
    return res.status(400).json({ message: "座位ID为必填字段" });
  }

  if (!description && !evidence_img) {
    return res.status(400).json({ message: "请提供举报描述或证据图片链接" });
  }

  try {
    const connection = await db;

    const [seatRows] = await connection.query(
      "SELECT * FROM seats WHERE seat_id = ?",
      [seatId],
    );

    if (seatRows.length === 0) {
      return res.status(404).json({ message: "座位不存在" });
    }

    const [result] = await connection.query(
      "INSERT INTO reports (reporter_id, seat_id, description, evidence_img, report_status) VALUES (?, ?, ?, ?, 'pending')",
      [reporterId, seatId, description || "", evidence_img || ""],
    );

    // 将被举报座位标记为异常状态，便于管理员快速排查
    await connection.query("UPDATE seats SET status = 3 WHERE seat_id = ?", [
      seatId,
    ]);

    res
      .status(201)
      .json({ message: "举报提交成功", reportId: result.insertId });
  } catch (error) {
    console.error("Submit report error:", error);
    res.status(500).json({ message: "举报提交失败" });
  }
});

// 用户查询自己的举报记录
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const connection = await db;

    const [reports] = await connection.query(
      `SELECT r.*, s.seat_number, s.area
      FROM reports r
      JOIN seats s ON r.seat_id = s.seat_id
      WHERE r.reporter_id = ?
      ORDER BY r.created_at DESC`,
      [req.user.userId],
    );

    res.json(reports);
  } catch (error) {
    console.error("Fetch my reports error:", error);
    res.status(500).json({ message: "获取我的举报记录失败" });
  }
});

// 用户查询自己的信誉分统计与记录
router.get("/my-credit-stats", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const connection = await db;

    const [userRows] = await connection.query(
      "SELECT user_id, username, credit_score FROM users WHERE user_id = ?",
      [userId],
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "用户不存在" });
    }

    const [rewardRows] = await connection.query(
      `SELECT r.reservation_id,
              COALESCE(r.actual_check_in, r.created_at) AS event_time,
              s.seat_number,
              s.area
       FROM reservations r
       JOIN seats s ON r.seat_id = s.seat_id
       WHERE r.user_id = ?
         AND (r.actual_check_in IS NOT NULL OR r.res_status IN ('active', 'completed'))
       ORDER BY event_time DESC`,
      [userId],
    );

    const [violationRows] = await connection.query(
      `SELECT r.reservation_id,
              COALESCE(r.end_time, r.created_at) AS event_time,
              s.seat_number,
              s.area
       FROM reservations r
       JOIN seats s ON r.seat_id = s.seat_id
       WHERE r.user_id = ?
         AND r.res_status = 'violated'
       ORDER BY event_time DESC`,
      [userId],
    );

    const [invalidReportRows] = await connection.query(
      `SELECT r.report_id,
              r.created_at AS event_time,
              s.seat_number,
              s.area
       FROM reports r
       JOIN seats s ON r.seat_id = s.seat_id
       WHERE r.reporter_id = ?
         AND r.report_status = 'invalid'
       ORDER BY r.created_at DESC`,
      [userId],
    );

    const records = [
      ...rewardRows.map((row) => ({
        id: `reward-${row.reservation_id}`,
        type: "reward",
        scoreChange: 2,
        reason: `预约入座奖励（${row.area}${row.seat_number}）`,
        eventTime: row.event_time,
      })),
      ...violationRows.map((row) => ({
        id: `violation-${row.reservation_id}`,
        type: "penalty",
        scoreChange: -5,
        reason: `预约超时违规（${row.area}${row.seat_number}）`,
        eventTime: row.event_time,
      })),
      ...invalidReportRows.map((row) => ({
        id: `invalid-report-${row.report_id}`,
        type: "penalty",
        scoreChange: -5,
        reason: `举报驳回扣分（${row.area}${row.seat_number}）`,
        eventTime: row.event_time,
      })),
    ].sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));

    res.json({
      profile: userRows[0],
      summary: {
        rewardCount: rewardRows.length,
        violationCount: violationRows.length,
        invalidReportCount: invalidReportRows.length,
      },
      records,
    });
  } catch (error) {
    console.error("Fetch my credit stats error:", error);
    res.status(500).json({ message: "获取我的信誉分统计失败" });
  }
});

// 管理员查询所有举报
router.get("/", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "权限不足" });
  }

  try {
    const connection = await db;

    const [reports] = await connection.query(
      `SELECT r.*, u.username AS reporter_name, u.credit_score AS reporter_credit_score, s.seat_number, s.area
      FROM reports r
      JOIN users u ON r.reporter_id = u.user_id
      JOIN seats s ON r.seat_id = s.seat_id
      ORDER BY r.created_at DESC`,
    );

    res.json(reports);
  } catch (error) {
    console.error("Fetch reports error:", error);
    res.status(500).json({ message: "获取举报列表失败" });
  }
});

// 管理员查询用户信誉分统计
router.get("/credit-stats", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "权限不足" });
  }

  try {
    const connection = await db;

    const [summaryRows] = await connection.query(
      `SELECT
        COUNT(*) AS total_users,
        ROUND(AVG(credit_score), 2) AS avg_credit,
        MIN(credit_score) AS min_credit,
        MAX(credit_score) AS max_credit
      FROM users`,
    );

    const [users] = await connection.query(
      `SELECT user_id, username, credit_score, status, role
      FROM users
      ORDER BY credit_score ASC, username ASC`,
    );

    res.json({
      summary: summaryRows[0] || {
        total_users: 0,
        avg_credit: 0,
        min_credit: 0,
        max_credit: 0,
      },
      users,
    });
  } catch (error) {
    console.error("Fetch credit stats error:", error);
    res.status(500).json({ message: "获取信誉分统计失败" });
  }
});

// 管理员更新举报审核状态
router.patch("/:reportId", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "权限不足" });
  }

  const { reportId } = req.params;
  const { report_status, admin_remark } = req.body;

  if (!["pending", "valid", "invalid"].includes(report_status)) {
    return res.status(400).json({ message: "无效的举报状态" });
  }

  try {
    const connection = await db;

    const [existingRows] = await connection.query(
      "SELECT report_id, reporter_id, seat_id, report_status, created_at FROM reports WHERE report_id = ?",
      [reportId],
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ message: "举报记录不存在" });
    }

    const currentReport = existingRows[0];

    await connection.query(
      "UPDATE reports SET report_status = ?, admin_remark = ? WHERE report_id = ?",
      [report_status, admin_remark || "", reportId],
    );

    // 从待审核 -> 属实时，自动扣除被举报用户 5 信誉分
    if (
      currentReport.report_status === "pending" &&
      report_status === "valid"
    ) {
      const [targetRows] = await connection.query(
        `SELECT user_id
         FROM reservations
         WHERE seat_id = ?
           AND created_at <= ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [currentReport.seat_id, currentReport.created_at],
      );

      if (targetRows.length > 0) {
        await connection.query(
          "UPDATE users SET credit_score = GREATEST(0, credit_score - 5) WHERE user_id = ?",
          [targetRows[0].user_id],
        );
      }
    }

    // 从待审核 -> 驳回时，扣除举报人 5 信誉分（恶意/无效举报惩罚）
    if (
      currentReport.report_status === "pending" &&
      report_status === "invalid"
    ) {
      await connection.query(
        "UPDATE users SET credit_score = GREATEST(0, credit_score - 5) WHERE user_id = ?",
        [currentReport.reporter_id],
      );
    }

    res.json({ message: "举报状态更新成功" });
  } catch (error) {
    console.error("Update report status error:", error);
    res.status(500).json({ message: "更新举报状态失败" });
  }
});

module.exports = router;
