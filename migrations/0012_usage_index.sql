-- หลังบ้าน: สรุปการใช้หน้าต่าง ๆ ทุกโครงการ (กรองตามเหตุการณ์และช่วงเวลา) ไม่ต้องอ่านทั้งตาราง
CREATE INDEX IF NOT EXISTS idx_usage_event_at ON usage_events(event, at);
