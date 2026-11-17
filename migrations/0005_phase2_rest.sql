-- ระยะ 2 ส่วนที่เหลือ: สิทธิ์ใช้งาน (ทดลอง / ยอดซื้อ Pure Product / จ่ายเงิน), รูปผัง, ตำแหน่งแปลงบนรูป

-- สิทธิ์ใช้งาน: ใช้ได้เต็มถึงวันที่ไกลที่สุดของ 3 ค่านี้ (YYYY-MM-DD ตามเวลาไทย)
ALTER TABLE projects ADD COLUMN trial_ends_at TEXT NOT NULL DEFAULT '';  -- วันสุดท้ายของช่วงทดลอง
ALTER TABLE projects ADD COLUMN pure_until TEXT NOT NULL DEFAULT '';     -- คำนวณจากยอดซื้อ Pure Product
ALTER TABLE projects ADD COLUMN paid_until TEXT NOT NULL DEFAULT '';     -- ทีมงานขยายให้เอง (จ่ายเงิน/กรณีพิเศษ)
ALTER TABLE projects ADD COLUMN plan_image TEXT NOT NULL DEFAULT '';     -- key ของรูปผังใน R2
-- โครงการที่มีอยู่แล้ว: เริ่มนับช่วงทดลองจากวันนี้
UPDATE projects SET trial_ends_at = date('now', '+7 hours', '+60 days') WHERE trial_ends_at = '';

-- ยอดซื้อ Pure Product ต่อเดือน (ทีมงานกรอกใน back office)
CREATE TABLE IF NOT EXISTS pure_purchases (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  month       TEXT NOT NULL,          -- YYYY-MM
  amount      REAL NOT NULL DEFAULT 0,
  recorded_by TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, month)
);

-- ตำแหน่งแปลงบนรูปผัง (ร้อยละของความกว้าง/สูงของรูป) ว่าง = ยังไม่ได้วาง
ALTER TABLE plots ADD COLUMN map_x REAL;
ALTER TABLE plots ADD COLUMN map_y REAL;
