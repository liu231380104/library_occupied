-- Add seat status snapshot for reports so invalid reviews can restore seat status.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS reported_seat_status TINYINT DEFAULT NULL AFTER report_status;

