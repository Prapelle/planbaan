-- สรุปการใช้งานรายเดือน (ก่อนย้ายเหตุการณ์ที่เก่ากว่า 90 วันไป R2) ให้หลังบ้านยังดูย้อนหลังได้
CREATE TABLE IF NOT EXISTS usage_monthly (
  project_id TEXT NOT NULL,
  month      TEXT NOT NULL,                 -- YYYY-MM เวลาไทย
  event      TEXT NOT NULL,
  page       TEXT NOT NULL DEFAULT '',
  n          INTEGER NOT NULL DEFAULT 0,
  last_at    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, month, event, page)
);
-- ผู้ใช้ (hash) ที่มีการใช้งานในเดือนนั้น ใช้นับจำนวนคนต่อเดือนโดยไม่นับซ้ำ
CREATE TABLE IF NOT EXISTS usage_monthly_users (
  project_id TEXT NOT NULL,
  month      TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  PRIMARY KEY (project_id, month, actor_hash)
);
