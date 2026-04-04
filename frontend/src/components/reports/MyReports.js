import React, { useEffect, useState } from "react";
import api from "../../services/api";

const MyReports = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMyReports();
  }, []);

  const fetchMyReports = async () => {
    try {
      const response = await api.get("/reports/my");
      setReports(response.data);
      setLoading(false);
    } catch (err) {
      setError("获取举报记录失败");
      setLoading(false);
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case "pending":
        return "待审核";
      case "valid":
        return "已通过";
      case "invalid":
        return "已驳回";
      default:
        return "未知";
    }
  };

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case "pending":
        return { bg: "#eee2d1", text: "#6f5740", border: "#c4ab87" };
      case "valid":
        return { bg: "#e1ebe5", text: "#476457", border: "#8ca79a" };
      case "invalid":
        return { bg: "#f0e1df", text: "#7a4f4a", border: "#b78a84" };
      default:
        return { bg: "#ecefee", text: "#596263", border: "#9aa2a0" };
    }
  };

  if (loading) return <div>加载举报记录中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ marginTop: "30px", background: "#fcfbf8", border: "1px solid #d8d2c9", borderRadius: "10px", padding: "14px" }}>
      <h3>我的举报记录</h3>
      {reports.length === 0 ? (
        <p>暂无举报记录</p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "15px",
          }}
        >
          <thead>
              <tr style={{ backgroundColor: "#f1eee8" }}>
              <th style={{ border: "1px solid #d8d2c9", padding: "8px" }}>座位</th>
              <th style={{ border: "1px solid #d8d2c9", padding: "8px" }}>区域</th>
              <th style={{ border: "1px solid #d8d2c9", padding: "8px" }}>描述</th>
              <th style={{ border: "1px solid #d8d2c9", padding: "8px" }}>证据</th>
              <th style={{ border: "1px solid #d8d2c9", padding: "8px" }}>状态</th>
              <th style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                管理员备注
              </th>
              <th style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                提交时间
              </th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.report_id}>
                <td style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                  {report.seat_number}
                </td>
                <td style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                  {report.area}
                </td>
                <td style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                  {report.description || "无"}
                </td>
                <td style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                  {report.evidence_img ? (
                    <a
                      href={report.evidence_img}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      查看
                    </a>
                  ) : (
                    "无"
                  )}
                </td>
                <td style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                  <span style={{
                    backgroundColor: getStatusBadgeStyle(report.report_status).bg,
                    color: getStatusBadgeStyle(report.report_status).text,
                    border: `1px solid ${getStatusBadgeStyle(report.report_status).border}`,
                    padding: "2px 8px",
                    borderRadius: "999px",
                    fontWeight: 600,
                  }}>
                    {getStatusText(report.report_status)}
                  </span>
                </td>
                <td style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                  {report.admin_remark || "无"}
                </td>
                <td style={{ border: "1px solid #d8d2c9", padding: "8px" }}>
                  {new Date(report.created_at).toLocaleString("zh-CN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default MyReports;
