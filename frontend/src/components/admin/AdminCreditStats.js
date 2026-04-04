import React, { useEffect, useState } from "react";
import api from "../../services/api";

const THEME = {
  panel: "#f8f6f2",
  card: "#f6f3ee",
  head: "#efebe4",
  border: "#d4cec4",
  text: "#5a605f",
  textStrong: "#363d3d",
  danger: "#9f6f69",
};

const AdminCreditStats = () => {
  const [creditSummary, setCreditSummary] = useState(null);
  const [creditUsers, setCreditUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCreditStats();
  }, []);

  const fetchCreditStats = async () => {
    try {
      const response = await api.get("/reports/credit-stats");
      setCreditSummary(response.data?.summary || null);
      setCreditUsers(response.data?.users || []);
      setLoading(false);
    } catch (err) {
      console.error("Fetch credit stats error:", err);
      setError("获取信誉分统计失败");
      setLoading(false);
    }
  };

  if (loading) return <div>加载中...</div>;
  if (error) return <div style={{ color: THEME.danger }}>{error}</div>;

  return (
    <div style={{ background: THEME.panel, border: `1px solid ${THEME.border}`, borderRadius: "10px", padding: "14px", color: "#454d4e" }}>
      <h2 style={{ color: THEME.textStrong }}>信誉分统计</h2>
      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            background: THEME.card,
            borderRadius: "6px",
            color: THEME.textStrong,
          }}
        >
          用户总数：{creditSummary?.total_users ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: THEME.card,
            borderRadius: "6px",
            color: THEME.textStrong,
          }}
        >
          平均信誉分：{creditSummary?.avg_credit ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: THEME.card,
            borderRadius: "6px",
            color: THEME.textStrong,
          }}
        >
          最低信誉分：{creditSummary?.min_credit ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: THEME.card,
            borderRadius: "6px",
            color: THEME.textStrong,
          }}
        >
          最高信誉分：{creditSummary?.max_credit ?? 0}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                backgroundColor: THEME.head,
                borderBottom: `2px solid ${THEME.border}`,
                color: THEME.textStrong,
              }}
            >
              <th style={{ padding: "10px", textAlign: "left" }}>用户ID</th>
              <th style={{ padding: "10px", textAlign: "left" }}>用户名</th>
              <th style={{ padding: "10px", textAlign: "left" }}>角色</th>
              <th style={{ padding: "10px", textAlign: "left" }}>账号状态</th>
              <th style={{ padding: "10px", textAlign: "left" }}>信誉分</th>
            </tr>
          </thead>
          <tbody>
            {creditUsers.map((user) => (
              <tr key={user.user_id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                <td style={{ padding: "10px" }}>{user.user_id}</td>
                <td style={{ padding: "10px" }}>{user.username}</td>
                <td style={{ padding: "10px" }}>
                  {user.role === "admin" ? "管理员" : "用户"}
                </td>
                <td style={{ padding: "10px" }}>
                  {user.status === "active" ? "正常" : "冻结"}
                </td>
                <td style={{ padding: "10px" }}>{user.credit_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminCreditStats;
