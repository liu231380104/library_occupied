-- Add reservation presence confirmation prompt table for auto check-in flow.
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

