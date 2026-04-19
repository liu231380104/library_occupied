import axios from "axios";

// 统一 API 地址配置：优先使用环境变量，其次使用部署服务器默认地址
// CRA 环境变量需要以 REACT_APP_ 开头，例如：REACT_APP_API_ORIGIN=http://116.62.53.122:5000
export const API_ORIGIN = (process.env.REACT_APP_API_ORIGIN || "http://116.62.53.122:5000")
  .trim()
  .replace(/\/+$/, "");

export const API_BASE_URL = `${API_ORIGIN}/api`;

// 创建 axios 实例
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// 请求拦截器：添加 token
api.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器：处理错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期，清除本地存储并跳转登录
      sessionStorage.clear();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export default api;
