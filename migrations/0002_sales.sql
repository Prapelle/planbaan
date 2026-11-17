-- PlanBaan ระยะ 1: ลูกค้าและผังแปลง
ALTER TABLE leads ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN next_follow_at TEXT NOT NULL DEFAULT '';  -- วันนัดติดตามครั้งถัดไป YYYY-MM-DD

-- ประวัติของลูกค้าแต่ละราย: สร้าง เลื่อนขั้น บันทึกการติดต่อ แก้ไข (ใช้คิดผลงานรายคนในระยะ 2)
CREATE TABLE IF NOT EXISTS lead_activity (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  lead_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- created | stage | contact | edit
  from_stage  TEXT NOT NULL DEFAULT '',
  to_stage    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_activity_project ON lead_activity(project_id, lead_id, created_at);
