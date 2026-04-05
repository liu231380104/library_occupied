/**
 * 从 JWT token 中解析用户信息
 * @param {string} token - JWT token
 * @returns {object|null} 解析后的用户对象 {userId, username, role} 或 null
 */
export const parseToken = (token) => {
  if (!token) return null;

  try {
    // JWT 格式：header.payload.signature
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // 解码 payload (第二部分，Base64URL + UTF-8)
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const decoded = typeof TextDecoder !== "undefined"
      ? new TextDecoder("utf-8").decode(bytes)
      : decodeURIComponent(Array.from(bytes).map((b) => `%${b.toString(16).padStart(2, "0")}`).join(""));
    // 解析 JSON
    const user = JSON.parse(decoded);
    return user;
  } catch (err) {
    console.error("Token parse error:", err);
    return null;
  }
};

/**
 * 获取当前用户的 role
 * @returns {string} "admin" 或 "user" 或 null
 */
export const getUserRole = () => {
  const token = sessionStorage.getItem("token");
  const user = parseToken(token);
  return user?.role || null;
};

/**
 * 获取当前用户信息
 * @returns {object|null} {userId, username, role} 或 null
 */
export const getCurrentUser = () => {
  const token = sessionStorage.getItem("token");
  return parseToken(token);
};
