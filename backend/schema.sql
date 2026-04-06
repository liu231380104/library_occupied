-- 数据库初始化脚本
-- 创建数据库
CREATE DATABASE IF NOT EXISTS library_seat_system;
USE library_seat_system;

-- 1. 用户表：存储基本信息与信誉分
CREATE TABLE IF NOT EXISTS `users` (
  `user_id` VARCHAR(20) PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `credit_score` INT DEFAULT 100,    -- 初始信誉分
  `status` ENUM('active', 'frozen') DEFAULT 'active',
  `role` ENUM('user', 'admin') DEFAULT 'user'  -- 添加角色字段
);

-- 2. 座位表：存储物理位置与实时状态
CREATE TABLE IF NOT EXISTS `seats` (
  `seat_id` INT AUTO_INCREMENT PRIMARY KEY,
  `seat_number` VARCHAR(20) NOT NULL UNIQUE, -- 如 "A-101"
  `area` VARCHAR(50) NOT NULL,              -- 如 "二楼阅览室"
  -- 状态码建议：0-空闲(绿), 1-已预约(黄), 2-已占用(红), 3-异常占座(灰)
  `status` TINYINT DEFAULT 0,
  `item_occupied_since` DATETIME DEFAULT NULL,
  `last_updated` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. 预约表：连接用户与座位
CREATE TABLE IF NOT EXISTS `reservations` (
  `reservation_id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` VARCHAR(20) NOT NULL,           -- 对接你已有的 users.user_id
  `seat_id` INT NOT NULL,
  `start_time` DATETIME NOT NULL,
  `end_time` DATETIME NOT NULL,
  `actual_check_in` DATETIME DEFAULT NULL,  -- 扫码签到时间
  -- 状态：pending-待签到, active-已入座, completed-正常结束, cancelled-已取消, violated-违规
  `res_status` ENUM('pending', 'active', 'completed', 'cancelled', 'violated') DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
  FOREIGN KEY (`seat_id`) REFERENCES `seats`(`seat_id`) ON DELETE CASCADE
);

-- 4. 举报表：记录违规证据
CREATE TABLE IF NOT EXISTS `reports` (
  `report_id` INT AUTO_INCREMENT PRIMARY KEY,
  `reporter_id` VARCHAR(20) NOT NULL,        -- 举报人学号
  `seat_id` INT NOT NULL,
  `evidence_img` VARCHAR(255) NOT NULL,     -- 图片存储路径/URL
  `description` TEXT,                        -- 举报描述
  -- 状态：pending-待审核, valid-属实(扣分), invalid-驳回
  `report_status` ENUM('pending', 'valid', 'invalid') DEFAULT 'pending',
  `reported_seat_status` TINYINT DEFAULT NULL,     -- 举报提交时座位状态快照（用于驳回恢复）
  `admin_remark` TEXT,                       -- 管理员处理意见
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`reporter_id`) REFERENCES `users`(`user_id`),
  FOREIGN KEY (`seat_id`) REFERENCES `seats`(`seat_id`)
);

-- 5. 入座确认提示表：用于“检测到有人入座，是否本人”交互
CREATE TABLE IF NOT EXISTS `reservation_presence_prompts` (
  `prompt_id` INT AUTO_INCREMENT PRIMARY KEY,
  `reservation_id` INT NOT NULL,
  `user_id` VARCHAR(20) NOT NULL,
  `seat_id` INT NOT NULL,
  `prompt_status` ENUM('pending', 'confirmed', 'rejected', 'expired') DEFAULT 'pending',
  `detected_at` DATETIME NOT NULL,
  `responded_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_presence_user_status` (`user_id`, `prompt_status`, `created_at`),
  INDEX `idx_presence_reservation` (`reservation_id`, `prompt_status`),
  FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`reservation_id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
  FOREIGN KEY (`seat_id`) REFERENCES `seats`(`seat_id`) ON DELETE CASCADE
);

-- 6. 离座确认提示表：用于“检测到离座，是否释放座位”交互
CREATE TABLE IF NOT EXISTS `reservation_leave_prompts` (
  `prompt_id` INT AUTO_INCREMENT PRIMARY KEY,
  `reservation_id` INT NOT NULL,
  `user_id` VARCHAR(20) NOT NULL,
  `seat_id` INT NOT NULL,
  `prompt_status` ENUM('pending', 'released', 'retained', 'expired') DEFAULT 'pending',
  `detected_at` DATETIME NOT NULL,
  `responded_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_leave_user_status` (`user_id`, `prompt_status`, `created_at`),
  INDEX `idx_leave_reservation` (`reservation_id`, `prompt_status`),
  FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`reservation_id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
  FOREIGN KEY (`seat_id`) REFERENCES `seats`(`seat_id`) ON DELETE CASCADE
);

-- 7. 消息历史表：保存用户可见的提醒、确认、签到等消息
CREATE TABLE IF NOT EXISTS `notification_history` (
  `notification_id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` VARCHAR(20) NOT NULL,
  `event_type` ENUM('info', 'success', 'warning', 'danger', 'question') NOT NULL DEFAULT 'info',
  `title` VARCHAR(120) NOT NULL,
  `message` TEXT NOT NULL,
  `source` VARCHAR(60) NOT NULL,
  `source_key` VARCHAR(120) NOT NULL,
  `payload_json` TEXT DEFAULT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_notification_source` (`user_id`, `source`, `source_key`),
  INDEX `idx_notification_user_updated` (`user_id`, `updated_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE
);

-- 不再默认预置A区座位。
-- 请通过管理员页面“视频座位配置（测试）”生成并确认后写入 seats 表。