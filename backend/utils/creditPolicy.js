const getCreditThreshold = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
};

const CREDIT_WARNING_THRESHOLD = getCreditThreshold("CREDIT_WARNING_THRESHOLD", 70);
const CREDIT_FREEZE_THRESHOLD = getCreditThreshold("CREDIT_FREEZE_THRESHOLD", 60);

const getCreditStatus = (creditScore) =>
  Number(creditScore) < CREDIT_FREEZE_THRESHOLD ? "frozen" : "active";

const getCreditReminder = (creditScore, userId, username, status) => {
  const score = Number(creditScore) || 0;
  if (score > CREDIT_WARNING_THRESHOLD) return null;

  const frozen = status === "frozen" || score < CREDIT_FREEZE_THRESHOLD;
  return {
    id: frozen ? `credit-frozen-${userId}` : `credit-warning-${userId}`,
    type: frozen ? "danger" : "warning",
    title: frozen ? "账号已冻结" : "信誉分提醒",
    message: frozen
      ? `${username || "您的账号"}信誉分已低于${CREDIT_FREEZE_THRESHOLD}分，账号已冻结，请尽快提升信誉分。`
      : `${username || "您的账号"}当前信誉分为${score}分，已低于${CREDIT_WARNING_THRESHOLD}分，请注意保持良好使用记录。`,
    createdAt: new Date().toISOString(),
  };
};

const syncUserStatusByCredit = async (connection, userId) => {
  if (!userId) return null;

  const [rows] = await connection.query(
    "SELECT user_id, credit_score, status FROM users WHERE user_id = ? LIMIT 1",
    [userId],
  );

  if (rows.length === 0) return null;

  const current = rows[0];
  const nextStatus = getCreditStatus(current.credit_score);
  if (current.status !== nextStatus) {
    await connection.query("UPDATE users SET status = ? WHERE user_id = ?", [nextStatus, userId]);
  }

  return { ...current, status: nextStatus };
};

const syncUserStatusesByCredit = async (connection, userIds = []) => {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  const results = [];
  for (const userId of uniqueIds) {
    const result = await syncUserStatusByCredit(connection, userId);
    if (result) results.push(result);
  }
  return results;
};

const syncAllUserStatusesByCredit = async (connection) => {
  await connection.query(
    `UPDATE users
     SET status = CASE WHEN credit_score < ? THEN 'frozen' ELSE 'active' END`,
    [CREDIT_FREEZE_THRESHOLD],
  );
};

module.exports = {
  CREDIT_WARNING_THRESHOLD,
  CREDIT_FREEZE_THRESHOLD,
  getCreditStatus,
  getCreditReminder,
  syncUserStatusByCredit,
  syncUserStatusesByCredit,
  syncAllUserStatusesByCredit,
};

