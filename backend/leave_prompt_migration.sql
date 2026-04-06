-- Add reservation leave confirmation prompt table for release/retain flow.
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
