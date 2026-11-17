-- ระยะ 3: ส่วนก่อสร้าง (เสียเงิน) และโหมดรับสร้างบ้าน

-- ── ตารางระบบ ──
ALTER TABLE projects ADD COLUMN construction_enabled INTEGER NOT NULL DEFAULT 0; -- ทีมงานเปิดเมื่อโครงการซื้อส่วนก่อสร้าง
ALTER TABLE projects ADD COLUMN build_stale_days INTEGER NOT NULL DEFAULT 7;      -- เตือนเมื่อหลังไหนไม่อัปเดตเกินกี่วัน

-- ลิงก์ส่วนตัวของเจ้าของบ้าน: เก็บเฉพาะค่า hash ของ token (ข้อมูลรั่วก็เอา token ไปใช้ไม่ได้)
CREATE TABLE IF NOT EXISTS share_links (
  token_hash  TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  build_id    TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_share_links_build ON share_links(project_id, build_id);

-- ── ตารางข้อมูลโครงการ ──
-- งานก่อสร้างหนึ่งหลัง (โครงการจัดสรร: ผูกแปลง / รับสร้างบ้าน: ผูกลูกค้า)
CREATE TABLE IF NOT EXISTS builds (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  title          TEXT NOT NULL,
  plot_code      TEXT NOT NULL DEFAULT '',
  lead_id        TEXT NOT NULL DEFAULT '',
  customer_name  TEXT NOT NULL DEFAULT '',
  start_date     TEXT NOT NULL,            -- YYYY-MM-DD
  due_date       TEXT NOT NULL,            -- กำหนดส่งมอบตามสัญญา
  contract_price REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active', -- active | done | paused
  show_delay     INTEGER NOT NULL DEFAULT 1,     -- แสดงความล่าช้าในหน้าเจ้าของบ้านหรือไม่
  last_update_at TEXT NOT NULL,
  done_at        TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_builds_project ON builds(project_id, status);

-- งวดงาน + งวดเงินที่เก็บจากลูกค้า + งวดเบิกกู้ปลูกสร้าง
CREATE TABLE IF NOT EXISTS build_stages (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  build_id     TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  name         TEXT NOT NULL,
  planned_end  TEXT NOT NULL,
  done_at      TEXT NOT NULL DEFAULT '',
  pay_amount   REAL NOT NULL DEFAULT 0,
  paid_at      TEXT NOT NULL DEFAULT '',
  draw_amount  REAL NOT NULL DEFAULT 0,
  draw_status  TEXT NOT NULL DEFAULT '',   -- '' | requested | released
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_stages_project ON build_stages(project_id, build_id);

CREATE TABLE IF NOT EXISTS build_photos (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  build_id    TEXT NOT NULL,
  stage_id    TEXT NOT NULL DEFAULT '',
  r2_key      TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 0,  -- 1 = เจ้าของบ้านเห็น
  taken_by    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_photos_project ON build_photos(project_id, build_id);

-- งานเพิ่ม-ลด: ต้องให้ลูกค้ายืนยันก่อนเริ่มทำ
CREATE TABLE IF NOT EXISTS build_changes (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  build_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  amount        REAL NOT NULL DEFAULT 0,   -- บวก = งานเพิ่ม, ลบ = งานลด
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected | cancelled
  decided_at    TEXT NOT NULL DEFAULT '',
  decided_by    TEXT NOT NULL DEFAULT '',  -- "owner_link:<ชื่อที่ลูกค้าพิมพ์>" หรืออีเมลพนักงานที่บันทึกแทน
  decided_note  TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_changes_project ON build_changes(project_id, build_id);

CREATE TABLE IF NOT EXISTS build_log (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  build_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- created | stage_done | stage_undo | photo | note | change | paid | draw | finished | link
  note        TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_log_project ON build_log(project_id, build_id);
