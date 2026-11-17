-- PlanBaan ระยะ 0: ตารางระบบ + ตารางโครงการชุดแรก
-- กติกา: ตารางข้อมูลของโครงการ (tenant) ทุกตารางต้องมีคอลัมน์ project_id และอ่าน/เขียนผ่าน src/lib/tenant-db.ts เท่านั้น

-- ── ตารางระบบ (control) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,              -- ใช้เป็น subdomain: <slug>.<BASE_DOMAIN>
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'developer', -- developer = โครงการจัดสรร, builder = รับสร้างบ้าน
  province    TEXT NOT NULL DEFAULT '',
  shard       TEXT NOT NULL DEFAULT 'DB',        -- binding ของฐานข้อมูลที่เก็บข้อมูลโครงการนี้
  status      TEXT NOT NULL DEFAULT 'active',    -- active | readonly | closed
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  email       TEXT NOT NULL,
  role        TEXT NOT NULL,                     -- owner | manager | sales | marketing | viewer
  created_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, email)
);
CREATE INDEX IF NOT EXISTS idx_memberships_email ON memberships(email);

-- ทีม PlanBaan (back office) — เห็นสถิติการใช้งาน แต่ไม่เห็นข้อมูลโครงการ เว้นแต่ลูกค้าเปิดสิทธิ์ให้
CREATE TABLE IF NOT EXISTS platform_staff (
  email       TEXT PRIMARY KEY,
  role        TEXT NOT NULL DEFAULT 'support',   -- admin | support
  created_at  TEXT NOT NULL
);

-- ลูกค้าเปิดสิทธิ์ให้ทีมช่วยเหลือชั่วคราว
CREATE TABLE IF NOT EXISTS support_grants (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  granted_by  TEXT NOT NULL,
  can_edit    INTEGER NOT NULL DEFAULT 0,
  reason      TEXT NOT NULL DEFAULT '',
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_grants_project ON support_grants(project_id, expires_at);

-- บันทึกทุกครั้งที่ทีมช่วยเหลือเข้าดู/แก้ข้อมูลโครงการ (ลูกค้าเปิดดูได้)
CREATE TABLE IF NOT EXISTS access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  actor       TEXT NOT NULL,
  via         TEXT NOT NULL,                     -- support
  action      TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_log_project ON access_log(project_id, at);

-- เหตุการณ์การใช้งาน (back office) — ไม่มีเนื้อหาข้อมูลลูกค้า, ผู้ใช้เก็บเป็นค่า hash
CREATE TABLE IF NOT EXISTS usage_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  event       TEXT NOT NULL,
  actor_hash  TEXT NOT NULL DEFAULT '',
  meta        TEXT NOT NULL DEFAULT '',          -- ตัวเลขหรือชื่อหน้าเท่านั้น ห้ามใส่ข้อมูลลูกค้า
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_events(project_id, at);

-- ── ตารางข้อมูลโครงการ (tenant) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS plots (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  code          TEXT NOT NULL,                   -- เช่น A01
  zone          TEXT NOT NULL DEFAULT '',
  house_type    TEXT NOT NULL DEFAULT '',
  price         INTEGER NOT NULL DEFAULT 0,
  house_status  TEXT NOT NULL DEFAULT 'not_started', -- not_started | building | ready
  sale_status   TEXT NOT NULL DEFAULT 'available',   -- available | booked | loan | transferred | rent
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_plots_project ON plots(project_id);

CREATE TABLE IF NOT EXISTS leads (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL DEFAULT '',
  channel          TEXT NOT NULL DEFAULT '',
  stage            TEXT NOT NULL DEFAULT 'new',  -- new | contacted | visit_scheduled | visited | booked | loan | transferred
  plot_code        TEXT NOT NULL DEFAULT '',
  owner_email      TEXT NOT NULL DEFAULT '',
  last_contact_at  TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project_id, stage);
