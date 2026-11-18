-- ต้นทุนและกำไรรายหลัง (เห็นเฉพาะเจ้าของโครงการและบทบาทบัญชี)

-- ต้นทุนที่ดินและถมดินต่อแปลง และเนื้อที่ (ตารางวา) ใช้หารที่ดิน/ค่าส่วนกลางตามเนื้อที่
ALTER TABLE plots ADD COLUMN land_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE plots ADD COLUMN area_sqw REAL NOT NULL DEFAULT 0;

-- ต้นทุนที่บันทึกต่อหลัง (ซื้อรวมหลายหลัง = หลายแถวที่มี batch_id เดียวกัน)
CREATE TABLE IF NOT EXISTS build_costs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  build_id    TEXT NOT NULL,
  category    TEXT NOT NULL,             -- material | labor | transfer | giveaway | commission | other
  stage_id    TEXT NOT NULL DEFAULT '',
  item        TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL DEFAULT 0,
  cost_date   TEXT NOT NULL,             -- YYYY-MM-DD
  entered_by  TEXT NOT NULL DEFAULT '',
  batch_id    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_costs_project ON build_costs(project_id, build_id);

-- งบต้นทุนแม่แบบต่อแบบบ้าน (house_type '' = แบบที่ไม่ได้ตั้ง/รับสร้างบ้าน)
CREATE TABLE IF NOT EXISTS cost_budgets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  house_type  TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (project_id, house_type, category)
);
CREATE INDEX IF NOT EXISTS idx_cost_budgets_project ON cost_budgets(project_id);

-- ค่าตั้งต้นทุนของโครงการ: shared_total, shared_mode (equal|area), land_mode (plot|area), land_total
CREATE TABLE IF NOT EXISTS cost_settings (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (project_id, key)
);
CREATE INDEX IF NOT EXISTS idx_cost_settings_project ON cost_settings(project_id);
