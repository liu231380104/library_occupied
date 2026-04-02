-- 更新座位号为 A1-A4, B1-B4, C1-C4, D1-D4 格式
USE library_seat_system;

UPDATE seats SET seat_number = 'A1' WHERE seat_id = 1;
UPDATE seats SET seat_number = 'A2' WHERE seat_id = 2;
UPDATE seats SET seat_number = 'A3' WHERE seat_id = 3;
UPDATE seats SET seat_number = 'A4' WHERE seat_id = 4;
UPDATE seats SET seat_number = 'B1' WHERE seat_id = 5;
UPDATE seats SET seat_number = 'B2' WHERE seat_id = 6;
UPDATE seats SET seat_number = 'B3' WHERE seat_id = 7;
UPDATE seats SET seat_number = 'B4' WHERE seat_id = 8;
UPDATE seats SET seat_number = 'C1' WHERE seat_id = 9;
UPDATE seats SET seat_number = 'C2' WHERE seat_id = 10;
UPDATE seats SET seat_number = 'C3' WHERE seat_id = 11;
UPDATE seats SET seat_number = 'C4' WHERE seat_id = 12;
UPDATE seats SET seat_number = 'D1' WHERE seat_id = 13;
UPDATE seats SET seat_number = 'D2' WHERE seat_id = 14;
UPDATE seats SET seat_number = 'D3' WHERE seat_id = 15;
UPDATE seats SET seat_number = 'D4' WHERE seat_id = 16;