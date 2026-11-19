-- ปฏิทิน: นัดหมายที่ผู้ใช้เพิ่มเอง (วันที่อื่นในปฏิทินดึงจากข้อมูลที่มีอยู่แล้ว ไม่ได้เก็บซ้ำ)
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  title        TEXT NOT NULL,
  event_date   TEXT NOT NULL,             -- YYYY-MM-DD
  event_month  TEXT NOT NULL,             -- YYYY-MM (ไว้กรองรายเดือน)
  event_time   TEXT NOT NULL DEFAULT '',  -- HH:MM หรือว่าง = ทั้งวัน
  note         TEXT NOT NULL DEFAULT '',
  lead_id      TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, event_month);
