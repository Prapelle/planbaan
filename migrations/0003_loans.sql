-- PlanBaan ระยะ 2: สินเชื่อ
-- เอกสาร: เก็บเฉพาะว่าครบหรือไม่ (รายการคั่นด้วยจุลภาค) ไม่เก็บไฟล์
ALTER TABLE leads ADD COLUMN loan_docs TEXT NOT NULL DEFAULT '';
-- แก้หนี้: เมื่อไม่ผ่านทุกธนาคาร
ALTER TABLE leads ADD COLUMN debt_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN debt_plan TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN debt_retry_at TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN debt_since TEXT NOT NULL DEFAULT '';   -- วันที่ไม่ผ่านครบทุกธนาคาร (นับวันถือแปลง)

-- การยื่นกู้แต่ละธนาคาร (ลูกค้า 1 ราย ยื่นได้หลายธนาคาร)
CREATE TABLE IF NOT EXISTS loan_apps (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  lead_id     TEXT NOT NULL,
  bank        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'preparing',  -- preparing | submitted | more_docs | appraisal | approved | rejected
  amount      INTEGER NOT NULL DEFAULT 0,          -- วงเงินที่อนุมัติ (บาท)
  officer     TEXT NOT NULL DEFAULT '',            -- เจ้าหน้าที่ธนาคาร
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (project_id, lead_id, bank)
);
CREATE INDEX IF NOT EXISTS idx_loan_apps_project ON loan_apps(project_id, lead_id);
