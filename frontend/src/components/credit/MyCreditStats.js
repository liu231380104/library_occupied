import React, { useEffect, useState } from "react";
import api from "../../services/api";

const MyCreditStats = () => {
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCreditStats();
  }, []);

  const fetchCreditStats = async () => {
    try {
      const response = await api.get("/reports/my-credit-stats");
      setProfile(response.data?.profile || null);
      setSummary(response.data?.summary || null);
      setRecords(response.data?.records || []);
      setLoading(false);
    } catch (err) {
      setError("获取信誉分统计失败");
      setLoading(false);
    }
  };

  if (loading) return <div>加载信誉分统计中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ marginTop: "24px", background: "#fcfbf8", border: "1px solid #d8d2c9", borderRadius: "10px", padding: "14px", color: "#454d4e" }}>
      <h3>我的信誉分统计</h3>
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
            background: "#f1eee8",
            borderRadius: "6px",
          }}
        >
          当前信誉分：{profile?.credit_score ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "#f1eee8",
            borderRadius: "6px",
          }}
        >
          入座奖励次数：{summary?.rewardCount ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "#f1eee8",
            borderRadius: "6px",
          }}
        >
          超时违规次数：{summary?.violationCount ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "#f1eee8",
            borderRadius: "6px",
          }}
        >
          举报驳回次数：{summary?.invalidReportCount ?? 0}
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: profile?.status === "frozen" ? "#f0e1df" : "#e1ebe5",
            borderRadius: "6px",
            color: profile?.status === "frozen" ? "#7a4f4a" : "#476457",
            border: `1px solid ${profile?.status === "frozen" ? "#b78a84" : "#8ca79a"}`,
            fontWeight: 600,
          }}
        >
          账号状态：{profile?.status === "frozen" ? "冻结" : "正常"}
        </div>
      </div>

      <h4>信誉分变动记录</h4>
      {records.length === 0 ? (
        <p>暂无信誉分变动记录</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  backgroundColor: "#f1eee8",
                  borderBottom: "2px solid #d8d2c9",
                }}
              >
                <th style={{ padding: "10px", textAlign: "left" }}>时间</th>
                <th style={{ padding: "10px", textAlign: "left" }}>原因</th>
                <th style={{ padding: "10px", textAlign: "left" }}>分值变化</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} style={{ borderBottom: "1px solid #d8d2c9" }}>
                  <td style={{ padding: "10px", fontSize: "12px", color: "#5f6768" }}>
                    {record.eventTime
                      ? new Date(record.eventTime).toLocaleString("zh-CN")
                      : "未知"}
                  </td>
                  <td style={{ padding: "10px" }}>{record.reason}</td>
                  <td
                    style={{
                      padding: "10px",
                      color: record.scoreChange >= 0 ? "#8ca79a" : "#b78a84",
                      fontWeight: "bold",
                    }}
                  >
                    {record.scoreChange >= 0
                      ? `+${record.scoreChange}`
                      : `${record.scoreChange}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MyCreditStats;
