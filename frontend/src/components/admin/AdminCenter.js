import React, { useState, useEffect } from "react";
import api from "../../services/api";

const AdminCenter = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const response = await api.get("/reports");
      setReports(response.data);
      setLoading(false);
    } catch (err) {
      console.error("Fetch reports error:", err);
      setError("获取举报记录失败");
      setLoading(false);
    }
  };

  const handleUpdateReportStatus = async (reportId, newStatus) => {
    try {
      await api.patch(`/reports/${reportId}`, {
        report_status: newStatus,
      });
      setReports(
        reports.map((r) =>
          r.report_id === reportId ? { ...r, report_status: newStatus } : r,
        ),
      );
      alert("举报状态已更新");
    } catch (err) {
      console.error("Update report status error:", err);
      alert("更新举报状态失败");
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: { bg: "#ffc107", text: "待审核" },
      valid: { bg: "#28a745", text: "属实" },
      invalid: { bg: "#dc3545", text: "驳回" },
    };
    const s = statusMap[status] || statusMap.pending;
    return (
      <span
        style={{
          backgroundColor: s.bg,
          color: "#fff",
          padding: "4px 8px",
          borderRadius: "4px",
          fontSize: "12px",
        }}
      >
        {s.text}
      </span>
    );
  };

  if (loading) return <div>加载中...</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div>
      <h2>举报中心</h2>

      <p>共 {reports.length} 条举报记录</p>

      {reports.length === 0 ? (
        <p>暂无举报记录</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "20px",
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: "#f4f4f4",
                  borderBottom: "2px solid #ddd",
                }}
              >
                <th style={{ padding: "10px", textAlign: "left" }}>举报ID</th>
                <th style={{ padding: "10px", textAlign: "left" }}>举报人</th>
                <th style={{ padding: "10px", textAlign: "left" }}>信誉分</th>
                <th style={{ padding: "10px", textAlign: "left" }}>座位</th>
                <th style={{ padding: "10px", textAlign: "left" }}>描述</th>
                <th style={{ padding: "10px", textAlign: "left" }}>证据图片</th>
                <th style={{ padding: "10px", textAlign: "left" }}>状态</th>
                <th style={{ padding: "10px", textAlign: "left" }}>操作</th>
                <th style={{ padding: "10px", textAlign: "left" }}>举报时间</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.report_id}
                  style={{ borderBottom: "1px solid #ddd" }}
                >
                  <td style={{ padding: "10px" }}>{report.report_id}</td>
                  <td style={{ padding: "10px" }}>
                    {report.reporter_name || "未知"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {report.reporter_credit_score ?? "未知"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {report.seat_number}({report.area})
                  </td>
                  <td style={{ padding: "10px", maxWidth: "200px" }}>
                    {report.description || "无"}
                  </td>
                  <td style={{ padding: "10px" }}>
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
                  <td style={{ padding: "10px" }}>
                    {getStatusBadge(report.report_status)}
                  </td>
                  <td style={{ padding: "10px" }}>
                    {report.report_status === "pending" ? (
                      <div style={{ display: "flex", gap: "5px" }}>
                        <button
                          onClick={() =>
                            handleUpdateReportStatus(report.report_id, "valid")
                          }
                          style={{
                            padding: "4px 8px",
                            backgroundColor: "#28a745",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          通过
                        </button>
                        <button
                          onClick={() =>
                            handleUpdateReportStatus(
                              report.report_id,
                              "invalid",
                            )
                          }
                          style={{
                            padding: "4px 8px",
                            backgroundColor: "#dc3545",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          驳回
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: "#999" }}>已处理</span>
                    )}
                  </td>
                  <td style={{ padding: "10px", fontSize: "12px" }}>
                    {report.created_at
                      ? new Date(report.created_at).toLocaleString("zh-CN")
                      : "未知"}
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

export default AdminCenter;
