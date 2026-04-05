// 预约/签到逻辑路由
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const {
  getCreditReminder,
  syncUserStatusByCredit,
  syncUserStatusesByCredit,
} = require("../utils/creditPolicy");

const router = express.Router();

const AUTO_MODES = new Set(["balanced", "quick", "quiet"]);

function normalizeAutoMode(rawMode) {
  const mode = String(rawMode || "balanced").trim().toLowerCase();
  return AUTO_MODES.has(mode) ? mode : "balanced";
}

function extractSeatNumberWeight(seatNumber) {
  const num = Number(String(seatNumber || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : 9999;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function scoreAutoCandidate(candidate, ctx) {
  const {
    mode,
    topPreferredArea,
    maxPersonalUse,
    maxRisk,
    maxHot,
    minSeatNumber,
    maxSeatNumber,
  } = ctx;

  const personalUseNorm = clamp01(candidate.personalUse / Math.max(1, maxPersonalUse));
  const riskNorm = clamp01(candidate.risk / Math.max(1, maxRisk));
  const hotNorm = clamp01(candidate.hotness / Math.max(1, maxHot));
  const seatRange = Math.max(1, maxSeatNumber - minSeatNumber);
  const quickNorm = clamp01((maxSeatNumber - candidate.seatNumberWeight) / seatRange);
  const areaHit = topPreferredArea && candidate.area === topPreferredArea ? 1 : 0;

  let score = 50;
  const breakdown = {
    areaPreference: 0,
    personalHabit: 0,
    riskAvoidance: 0,
    quietAvoidHot: 0,
    quickReachable: 0,
  };

  if (mode === "quick") {
    breakdown.quickReachable = quickNorm * 28;
    breakdown.personalHabit = personalUseNorm * 16;
    breakdown.areaPreference = areaHit * 12;
    breakdown.riskAvoidance = -riskNorm * 10;
    breakdown.quietAvoidHot = -hotNorm * 4;
  } else if (mode === "quiet") {
    breakdown.riskAvoidance = -riskNorm * 24;
    breakdown.quietAvoidHot = -hotNorm * 20;
    breakdown.areaPreference = areaHit * 10;
    breakdown.personalHabit = personalUseNorm * 8;
    breakdown.quickReachable = quickNorm * 4;
  } else {
    // balanced
    breakdown.areaPreference = areaHit * 14;
    breakdown.personalHabit = personalUseNorm * 16;
    breakdown.riskAvoidance = -riskNorm * 18;
    breakdown.quietAvoidHot = -hotNorm * 8;
    breakdown.quickReachable = quickNorm * 8;
  }

  score += breakdown.areaPreference;
  score += breakdown.personalHabit;
  score += breakdown.riskAvoidance;
  score += breakdown.quietAvoidHot;
  score += breakdown.quickReachable;

  const reasons = [];
  if (areaHit) reasons.push("匹配你常用区域");
  if (personalUseNorm >= 0.6) reasons.push("与你历史使用习惯接近");
  if (riskNorm <= 0.2) reasons.push("近期被举报风险较低");
  if (mode === "quiet" && hotNorm <= 0.35) reasons.push("近期热度较低，更安静");
  if (mode === "quick" && quickNorm >= 0.6) reasons.push("优先推荐更易快速到达的座位");
  if (reasons.length === 0) reasons.push("综合当前空闲情况给出最优候选");

  return {
    ...candidate,
    score: Number(score.toFixed(3)),
    scoreBreakdown: breakdown,
    reasons,
  };
}

function buildNotificationPayload(payload) {
  if (!payload) return null;
  try {
    return JSON.stringify(payload);
  } catch (err) {
    return null;
  }
}

function parseNotificationPayload(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return null;
  }
}

async function upsertNotificationHistory(connection, {
  userId,
  eventType = "info",
  title,
  message,
  source,
  sourceKey,
  payload = null,
}) {
  if (!userId || !title || !message || !source || !sourceKey) return;

  await connection.query(
    `INSERT INTO notification_history
       (user_id, event_type, title, message, source, source_key, payload_json, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       event_type = VALUES(event_type),
       title = VALUES(title),
       message = VALUES(message),
       payload_json = VALUES(payload_json),
       is_read = 0,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, eventType, title, message, source, sourceKey, buildNotificationPayload(payload)],
  );
}

// 处理超时未签到预约：超过15分钟自动记为违规并扣5信誉分
const expireOverduePendingReservations = async (connection) => {
  const [overdueRows] = await connection.query(
    `SELECT r.reservation_id, r.user_id, r.seat_id,
            COALESCE(s.seat_number, CONCAT('已删除座位#', r.seat_id)) AS seat_number,
            COALESCE(s.area, '历史区域') AS area
     FROM reservations r
     LEFT JOIN seats s ON r.seat_id = s.seat_id
     WHERE r.res_status = 'pending'
       AND r.created_at <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
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

  for (const row of overdueRows) {
    await upsertNotificationHistory(connection, {
      userId: row.user_id,
      eventType: "danger",
      title: "预约已超时未签到",
      message: `您在${row.area}${row.seat_number}的预约已超过15分钟未签到，系统已判定违规并扣除5信誉分。`,
      source: "reservation",
      sourceKey: `violated-${row.reservation_id}`,
      payload: {
        reservationId: row.reservation_id,
        seatId: row.seat_id,
        seatNumber: row.seat_number,
        area: row.area,
      },
    });
  }

  await syncUserStatusesByCredit(connection, userIds);
};

// 处理长时间未响应的入座确认提示
const expirePendingPresencePrompts = async (connection) => {
  await connection.query(
    `UPDATE reservation_presence_prompts
     SET prompt_status = 'expired', responded_at = NOW()
     WHERE prompt_status = 'pending'
       AND created_at <= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
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

    const currentUser = await syncUserStatusByCredit(connection, userId);
    if (currentUser?.status === "frozen") {
      return res.status(403).json({ message: "账号信誉分过低，当前已冻结，暂时无法预约" });
    }

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

    const [seatInfoRows] = await connection.query(
      "SELECT seat_number, area FROM seats WHERE seat_id = ? LIMIT 1",
      [seatId],
    );
    const seatInfo = seatInfoRows[0] || { seat_number: String(seatId), area: "未知区域" };

    await upsertNotificationHistory(connection, {
      userId,
      eventType: "success",
      title: "预约成功",
      message: `您已成功预约 ${seatInfo.area}${seatInfo.seat_number}，系统将保留15分钟。`,
      source: "reservation",
      sourceKey: `created-${result.insertId}`,
      payload: {
        reservationId: result.insertId,
        seatId,
        seatNumber: seatInfo.seat_number,
        area: seatInfo.area,
      },
    });

    res.status(201).json({
      message: "预约成功，系统将保留15分钟",
      reservationId: result.insertId,
    });
  } catch (error) {
    console.error("Reservation error:", error);
    res.status(500).json({ message: "预约失败，请稍后重试" });
  }
});

// 一键智能预约：自动选择当前可用座位（可按区域筛选）
router.post("/auto", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const requestedArea = typeof req.body?.area === "string" ? req.body.area.trim() : "";
  const mode = normalizeAutoMode(req.body?.strategy?.mode || req.body?.mode);

  try {
    const connection = await db;

    await expireOverduePendingReservations(connection);

    const currentUser = await syncUserStatusByCredit(connection, userId);
    if (currentUser?.status === "frozen") {
      return res.status(403).json({ message: "账号信誉分过低，当前已冻结，暂时无法预约" });
    }

    const [existingReservations] = await connection.query(
      "SELECT reservation_id FROM reservations WHERE user_id = ? AND res_status IN ('pending', 'active') LIMIT 1",
      [userId],
    );

    if (existingReservations.length > 0) {
      return res.status(400).json({ message: "您已有未完成的预约，请先完成或取消后再预约" });
    }

    const [availableSeatRows] = requestedArea
      ? await connection.query(
        `SELECT seat_id, seat_number, area
         FROM seats
         WHERE status = 0 AND area = ?
         ORDER BY CAST(REGEXP_REPLACE(seat_number, '[^0-9]', '') AS UNSIGNED) ASC, seat_number ASC
         LIMIT 200`,
        [requestedArea],
      )
      : await connection.query(
        `SELECT seat_id, seat_number, area
         FROM seats
         WHERE status = 0
         ORDER BY CAST(REGEXP_REPLACE(seat_number, '[^0-9]', '') AS UNSIGNED) ASC, seat_number ASC
         LIMIT 200`,
      );

    if (!Array.isArray(availableSeatRows) || availableSeatRows.length === 0) {
      return res.status(404).json({
        message: requestedArea
          ? `区域 ${requestedArea} 当前无可预约座位`
          : "当前无可预约座位",
      });
    }

    const candidateSeatIds = availableSeatRows.map((row) => row.seat_id);

    const [userAreaPrefRows] = await connection.query(
      `SELECT COALESCE(s.area, '') AS area, COUNT(*) AS cnt
       FROM reservations r
       LEFT JOIN seats s ON r.seat_id = s.seat_id
       WHERE r.user_id = ?
         AND r.res_status IN ('completed', 'active')
         AND r.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY s.area`,
      [userId],
    );

    const [userSeatPrefRows] = await connection.query(
      `SELECT seat_id, COUNT(*) AS cnt
       FROM reservations
       WHERE user_id = ?
         AND res_status IN ('completed', 'active')
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY seat_id`,
      [userId],
    );

    const [seatRiskRows] = await connection.query(
      `SELECT seat_id,
              SUM(CASE WHEN report_status = 'valid' THEN 1 ELSE 0 END) AS valid_cnt,
              SUM(CASE WHEN report_status = 'pending' THEN 1 ELSE 0 END) AS pending_cnt
       FROM reports
       WHERE seat_id IN (?)
         AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY seat_id`,
      [candidateSeatIds],
    );

    const [seatHotRows] = await connection.query(
      `SELECT seat_id, COUNT(*) AS hot_cnt
       FROM reservations
       WHERE seat_id IN (?)
         AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY seat_id`,
      [candidateSeatIds],
    );

    const userSeatUseMap = new Map(
      (userSeatPrefRows || []).map((row) => [Number(row.seat_id), Number(row.cnt) || 0]),
    );
    const riskMap = new Map(
      (seatRiskRows || []).map((row) => [
        Number(row.seat_id),
        (Number(row.valid_cnt) || 0) * 2 + (Number(row.pending_cnt) || 0),
      ]),
    );
    const hotMap = new Map(
      (seatHotRows || []).map((row) => [Number(row.seat_id), Number(row.hot_cnt) || 0]),
    );

    const topPreferredArea = (userAreaPrefRows || [])
      .map((row) => ({ area: String(row.area || ""), cnt: Number(row.cnt) || 0 }))
      .sort((a, b) => b.cnt - a.cnt)[0]?.area || "";

    const rawCandidates = availableSeatRows.map((seat) => ({
      seat_id: seat.seat_id,
      seat_number: seat.seat_number,
      area: seat.area,
      seatNumberWeight: extractSeatNumberWeight(seat.seat_number),
      personalUse: userSeatUseMap.get(Number(seat.seat_id)) || 0,
      risk: riskMap.get(Number(seat.seat_id)) || 0,
      hotness: hotMap.get(Number(seat.seat_id)) || 0,
    }));

    const maxPersonalUse = Math.max(1, ...rawCandidates.map((item) => item.personalUse));
    const maxRisk = Math.max(1, ...rawCandidates.map((item) => item.risk));
    const maxHot = Math.max(1, ...rawCandidates.map((item) => item.hotness));
    const minSeatNumber = Math.min(...rawCandidates.map((item) => item.seatNumberWeight));
    const maxSeatNumber = Math.max(...rawCandidates.map((item) => item.seatNumberWeight));

    const scoredCandidates = rawCandidates
      .map((candidate) => scoreAutoCandidate(candidate, {
        mode,
        topPreferredArea,
        maxPersonalUse,
        maxRisk,
        maxHot,
        minSeatNumber,
        maxSeatNumber,
      }))
      .sort((a, b) => b.score - a.score);

    const tx = await connection.getConnection();
    try {
      await tx.beginTransaction();

      const topCandidates = scoredCandidates.slice(0, 10);
      const topCandidateIds = topCandidates.map((item) => item.seat_id);
      const [lockRows] = await tx.query(
        `SELECT seat_id, seat_number, area
         FROM seats
         WHERE status = 0 AND seat_id IN (?)
         FOR UPDATE`,
        [topCandidateIds],
      );

      if (!Array.isArray(lockRows) || lockRows.length === 0) {
        await tx.rollback();
        return res.status(409).json({
          message: "可预约座位已被抢占，请再试一次",
        });
      }

      const lockMap = new Map(lockRows.map((row) => [Number(row.seat_id), row]));
      const pickedScored = topCandidates.find((item) => lockMap.has(Number(item.seat_id)));

      if (!pickedScored) {
        await tx.rollback();
        return res.status(409).json({ message: "可预约座位状态变化较快，请重试" });
      }

      const pickedSeat = lockMap.get(Number(pickedScored.seat_id));

      const [result] = await tx.query(
        "INSERT INTO reservations (user_id, seat_id, start_time, end_time, res_status) VALUES (?, ?, NOW(), NOW(), 'pending')",
        [userId, pickedSeat.seat_id],
      );

      await tx.query("UPDATE seats SET status = 1 WHERE seat_id = ?", [pickedSeat.seat_id]);

      await upsertNotificationHistory(tx, {
        userId,
        eventType: "success",
        title: "一键智能预约成功",
        message: `已为您自动预约 ${pickedSeat.area}${pickedSeat.seat_number}，系统将保留15分钟。`,
        source: "reservation",
        sourceKey: `auto-created-${result.insertId}`,
        payload: {
          reservationId: result.insertId,
          seatId: pickedSeat.seat_id,
          seatNumber: pickedSeat.seat_number,
          area: pickedSeat.area,
          mode,
          score: pickedScored.score,
          reasons: pickedScored.reasons,
        },
      });

      await tx.commit();

      res.status(201).json({
        message: `已为您自动预约 ${pickedSeat.area}${pickedSeat.seat_number}，系统将保留15分钟`,
        reservationId: result.insertId,
        strategy: {
          mode,
          considered: scoredCandidates.length,
          reasons: pickedScored.reasons,
          score: pickedScored.score,
          scoreBreakdown: pickedScored.scoreBreakdown,
        },
        seat: {
          seat_id: pickedSeat.seat_id,
          seat_number: pickedSeat.seat_number,
          area: pickedSeat.area,
        },
      });
    } catch (txError) {
      try {
        await tx.rollback();
      } catch (rollbackErr) {
        // ignore rollback error and return original tx error
      }
      throw txError;
    } finally {
      tx.release();
    }
  } catch (error) {
    console.error("Auto reservation error:", error);
    res.status(500).json({ message: "一键预约失败，请稍后重试" });
  }
});

// 用户响应“检测到有人入座，是否本人？”提示
router.post("/presence-prompts/:promptId/respond", authenticateToken, async (req, res) => {
  const promptId = Number(req.params.promptId);
  const userId = req.user.userId;
  const isSelf = req.body?.isSelf;

  if (!Number.isInteger(promptId) || promptId <= 0) {
    return res.status(400).json({ message: "无效的提示ID" });
  }
  if (typeof isSelf !== "boolean") {
    return res.status(400).json({ message: "请提供 isSelf(true/false)" });
  }

  try {
    const connection = await db;
    await expireOverduePendingReservations(connection);
    await expirePendingPresencePrompts(connection);

    const tx = await connection.getConnection();
    try {
      await tx.beginTransaction();

      const [rows] = await tx.query(
        `SELECT p.prompt_id, p.prompt_status, p.reservation_id, p.seat_id,
                r.res_status
         FROM reservation_presence_prompts p
         JOIN reservations r ON r.reservation_id = p.reservation_id
         WHERE p.prompt_id = ? AND p.user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [promptId, userId],
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        await tx.rollback();
        return res.status(404).json({ message: "该确认提示不存在或无权限操作" });
      }

      const prompt = rows[0];
      if (prompt.prompt_status !== "pending") {
        await tx.rollback();
        return res.status(400).json({ message: "该确认提示已处理" });
      }

      if (isSelf) {
        let autoCheckedIn = false;
        if (prompt.res_status === "pending") {
          await tx.query(
            "UPDATE reservations SET res_status = 'active', actual_check_in = NOW() WHERE reservation_id = ?",
            [prompt.reservation_id],
          );
          await tx.query("UPDATE seats SET status = 2 WHERE seat_id = ?", [prompt.seat_id]);
          await tx.query(
            "UPDATE users SET credit_score = LEAST(100, credit_score + 2) WHERE user_id = ?",
            [userId],
          );
          await syncUserStatusByCredit(tx, userId);
          autoCheckedIn = true;
        }

        await tx.query(
          "UPDATE reservation_presence_prompts SET prompt_status = 'confirmed', responded_at = NOW() WHERE prompt_id = ?",
          [promptId],
        );
        await tx.query(
          `UPDATE reservation_presence_prompts
           SET prompt_status = 'expired', responded_at = NOW()
           WHERE reservation_id = ? AND prompt_status = 'pending' AND prompt_id <> ?`,
          [prompt.reservation_id, promptId],
        );

        await upsertNotificationHistory(tx, {
          userId,
          eventType: "success",
          title: autoCheckedIn ? "已自动签到" : "已确认本人入座",
          message: autoCheckedIn
            ? "系统已根据你的确认自动完成签到，状态已更新为“已入座”。"
            : "你已确认该座位为本人入座。",
          source: "presence",
          sourceKey: `prompt-confirmed-${promptId}`,
          payload: {
            promptId,
            reservationId: prompt.reservation_id,
            seatId: prompt.seat_id,
            autoCheckedIn,
          },
        });

        await tx.commit();
        return res.json({
          message: autoCheckedIn ? "已确认本人入座，系统已自动签到为“已入座”" : "已确认本人入座",
          autoCheckedIn,
        });
      }

      await tx.query(
        "UPDATE reservation_presence_prompts SET prompt_status = 'rejected', responded_at = NOW() WHERE prompt_id = ?",
        [promptId],
      );
      if (prompt.res_status === "pending") {
        await tx.query("UPDATE seats SET status = 3 WHERE seat_id = ?", [prompt.seat_id]);
      }

      await upsertNotificationHistory(tx, {
        userId,
        eventType: "warning",
        title: "已记录：不是本人入座",
        message: "你已反馈该座位不是本人入座，系统会继续将其视为异常占座进行处理。",
        source: "presence",
        sourceKey: `prompt-rejected-${promptId}`,
        payload: {
          promptId,
          reservationId: prompt.reservation_id,
          seatId: prompt.seat_id,
        },
      });

      await tx.commit();
      return res.json({ message: "已记录反馈，系统将继续保持该预约等待你本人入座" });
    } catch (txError) {
      try {
        await tx.rollback();
      } catch (rollbackErr) {
        // ignore rollback error and return original tx error
      }
      throw txError;
    } finally {
      tx.release();
    }
  } catch (error) {
    console.error("Respond presence prompt error:", error);
    res.status(500).json({ message: "处理确认提示失败，请稍后重试" });
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

    await upsertNotificationHistory(connection, {
      userId,
      eventType: "info",
      title: "预约已取消",
      message: `您在座位 #${reservation.seat_id} 的预约已取消。`,
      source: "reservation",
      sourceKey: `cancelled-${reservationId}`,
      payload: {
        reservationId,
        seatId: reservation.seat_id,
      },
    });

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

    await upsertNotificationHistory(connection, {
      userId,
      eventType: "success",
      title: "已入座",
      message: `您已在预约座位 #${reservation.seat_id} 完成入座签到，状态已更新。`,
      source: "reservation",
      sourceKey: `checkin-${reservationId}`,
      payload: {
        reservationId,
        seatId: reservation.seat_id,
      },
    });

    await syncUserStatusByCredit(connection, userId);

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

    await upsertNotificationHistory(connection, {
      userId,
      eventType: "info",
      title: "已离开，座位已释放",
      message: `您在座位 #${reservation.seat_id} 的预约已完成，座位已释放。`,
      source: "reservation",
      sourceKey: `leave-${reservationId}`,
      payload: {
        reservationId,
        seatId: reservation.seat_id,
      },
    });

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
    await expirePendingPresencePrompts(connection);

    const [userRows] = await connection.query(
      "SELECT user_id, username, credit_score, status FROM users WHERE user_id = ? LIMIT 1",
      [userId],
    );

    const lowCreditReminder = userRows[0]
      ? getCreditReminder(
          userRows[0].credit_score,
          userRows[0].user_id,
          userRows[0].username,
          userRows[0].status,
        )
      : null;

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

    for (const reminder of reminders) {
      await upsertNotificationHistory(connection, {
        userId,
        eventType: reminder.type,
        title: reminder.title,
        message: reminder.message,
        source: "reservation",
        sourceKey: reminder.id,
        payload: {
          kind: "pending-reminder",
          createdAt: reminder.createdAt,
          message: reminder.message,
        },
      });
    }

    for (const violatedAlert of violatedAlerts) {
      await upsertNotificationHistory(connection, {
        userId,
        eventType: violatedAlert.type,
        title: violatedAlert.title,
        message: violatedAlert.message,
        source: "reservation",
        sourceKey: violatedAlert.id,
        payload: {
          kind: "violated",
          createdAt: violatedAlert.createdAt,
          message: violatedAlert.message,
        },
      });
    }

    if (lowCreditReminder) {
      await upsertNotificationHistory(connection, {
        userId,
        eventType: lowCreditReminder.type || "warning",
        title: lowCreditReminder.title,
        message: lowCreditReminder.message,
        source: "credit",
        sourceKey: `credit-${userId}`,
        payload: lowCreditReminder,
      });
    }

    const [historyRows] = await connection.query(
      `SELECT notification_id, event_type, title, message, source, source_key, payload_json, is_read, created_at, updated_at
       FROM notification_history
       WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 100`,
      [userId],
    );

    const notifications = historyRows.map((row) => {
      const payload = parseNotificationPayload(row.payload_json);
      return {
        id: `history-${row.notification_id}`,
        type: row.event_type || "info",
        title: row.title,
        message: row.message,
        createdAt: row.updated_at || row.created_at,
        persisted: true,
        source: row.source,
        sourceKey: row.source_key,
        isRead: Boolean(row.is_read),
        action: payload?.promptId ? { promptId: payload.promptId } : undefined,
      };
    });

    res.json(notifications);
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ message: "获取消息提醒失败" });
  }
});

module.exports = router;
