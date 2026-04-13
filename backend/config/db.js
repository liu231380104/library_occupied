const mysql = require("mysql2/promise");
require("dotenv").config();

const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = parseInt(process.env.DB_PORT, 10) || 3306;
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "123456";
const DB_NAME = process.env.DB_NAME || "library_seat_system";

// Use a pool to avoid "connection closed" errors and to allow concurrent queries
const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.getConnection().then((conn) => {
  conn.release();
  console.log(`Connected to MySQL database ${DB_NAME} at ${DB_HOST}:${DB_PORT} as ${DB_USER}`);
}).catch((err) => {
  console.error("Database pool connection failed:", err);
  if (err && err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('MySQL access denied — 请检查 DB_USER / DB_PASSWORD 是否正确，并确认 DB_HOST / DB_PORT 指向正确的 MySQL 实例。');
  }
});

const db = Promise.resolve(pool);
module.exports = db;