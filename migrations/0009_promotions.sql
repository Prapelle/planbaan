-- ราคาขายจริงและโปรโมชั่นต่อลูกค้า + ชุดโปรโมชั่นของโครงการ + การอนุมัติส่วนลด

-- ราคาขายจริง (0 = เท่าราคาตั้งของแปลง) และการอนุมัติส่วนลดล่าสุด
ALTER TABLE leads ADD COLUMN sale_price REAL NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN discount_approved REAL NOT NULL DEFAULT 0;   -- ยอดส่วนลดรวมที่อนุมัติไว้ (ลดเพิ่มเกินนี้ต้องอนุมัติใหม่)
ALTER TABLE leads ADD COLUMN discount_approved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN discount_approved_at TEXT NOT NULL DEFAULT '';

-- ชุดโปรโมชั่นที่เจ้าของ/ผู้จัดการตั้งไว้ ให้ฝ่ายขายกดเลือก
CREATE TABLE IF NOT EXISTS promotions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- cash (หักรายรับ) | gift (ของแถม = ต้นทุน) | transfer (ฟรีค่าโอน/จดจำนอง = ต้นทุน)
  default_value REAL NOT NULL DEFAULT 0,    -- 0 = ฝ่ายขายใส่มูลค่าเอง
  valid_until   TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD หรือว่าง = ไม่หมดเขต
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promotions_project ON promotions(project_id);

-- โปรโมชั่นที่ลูกค้าแต่ละรายได้ (เก็บชื่อ/ประเภท/มูลค่าไว้ แก้ชุดโปรภายหลังไม่กระทบรายเก่า)
CREATE TABLE IF NOT EXISTS lead_promos (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  lead_id     TEXT NOT NULL,
  promo_id    TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  value       REAL NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_promos_project ON lead_promos(project_id, lead_id);

-- ค่าตั้งทั่วไปของโครงการ เช่น เกณฑ์อนุมัติส่วนลด (approve_pct)
CREATE TABLE IF NOT EXISTS project_settings (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (project_id, key)
);
CREATE INDEX IF NOT EXISTS idx_project_settings_project ON project_settings(project_id);
