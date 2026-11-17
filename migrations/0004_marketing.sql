-- ระยะ 2 ชุดที่ 2: การตลาด

-- ขั้นไกลสุดที่ลูกค้าเคยไปถึง (ลำดับในเส้นทางขาย 0=ใหม่ … 6=โอนแล้ว)
-- ใช้คิดต้นทุนต่อการเข้าชม/การจอง: ลูกค้าที่เคยเข้าชมแล้วไม่ซื้อยังนับว่าเข้าชม
ALTER TABLE leads ADD COLUMN max_stage INTEGER NOT NULL DEFAULT 0;
UPDATE leads SET max_stage = CASE stage
  WHEN 'contacted' THEN 1 WHEN 'visit_scheduled' THEN 2 WHEN 'visited' THEN 3
  WHEN 'booked' THEN 4 WHEN 'loan' THEN 5 WHEN 'transferred' THEN 6 ELSE 0 END;
UPDATE leads SET max_stage = MAX(max_stage, COALESCE((
  SELECT MAX(CASE a.to_stage
    WHEN 'contacted' THEN 1 WHEN 'visit_scheduled' THEN 2 WHEN 'visited' THEN 3
    WHEN 'booked' THEN 4 WHEN 'loan' THEN 5 WHEN 'transferred' THEN 6 ELSE 0 END)
  FROM lead_activity a WHERE a.lead_id = leads.id AND a.project_id = leads.project_id), 0));

-- ค่าโฆษณาที่ใช้จริง: รายวัน ต่อช่องทาง ต่อแคมเปญ (นำเข้าซ้ำจะแทนที่แถวเดิม)
CREATE TABLE IF NOT EXISTS marketing_spend (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  day TEXT NOT NULL,          -- YYYY-MM-DD
  month TEXT NOT NULL,        -- YYYY-MM (ไว้กรอง)
  channel TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, channel, day, campaign)
);
CREATE INDEX IF NOT EXISTS idx_mkt_spend_month ON marketing_spend(project_id, month);

-- งบที่ตั้งไว้ต่อเดือนต่อช่องทาง
CREATE TABLE IF NOT EXISTS marketing_budget (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  month TEXT NOT NULL,
  channel TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, month, channel)
);
CREATE INDEX IF NOT EXISTS idx_mkt_budget_month ON marketing_budget(project_id, month);
