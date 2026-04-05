-- Create persistent notification history table for user-visible messages.
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

