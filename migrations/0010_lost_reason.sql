-- เหตุผลที่ลูกค้าไม่ซื้อ / ไม่สร้าง
ALTER TABLE leads ADD COLUMN lost_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN lost_note TEXT NOT NULL DEFAULT '';
