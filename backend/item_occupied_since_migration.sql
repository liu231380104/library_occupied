-- Add item occupancy start time to seats.
ALTER TABLE seats ADD COLUMN IF NOT EXISTS item_occupied_since DATETIME DEFAULT NULL AFTER status;
