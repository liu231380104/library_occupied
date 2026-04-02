import React, { useEffect, useState } from "react";
import api from "../../services/api";

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
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div>
      <h2>信誉分统计</h2>
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
            background: "#f4f4f4",
            borderRadius: "6px",
          }}
        >
          用户总数：{creditSummary?.total_users ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "#f4f4f4",
            borderRadius: "6px",
          }}
        >
          平均信誉分：{creditSummary?.avg_credit ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "#f4f4f4",
            borderRadius: "6px",
          }}
        >
          最低信誉分：{creditSummary?.min_credit ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "#f4f4f4",
            borderRadius: "6px",
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
                backgroundColor: "#f4f4f4",
                borderBottom: "2px solid #ddd",
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
              <tr key={user.user_id} style={{ borderBottom: "1px solid #ddd" }}>
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
