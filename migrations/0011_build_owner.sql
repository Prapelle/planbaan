-- ผู้รับผิดชอบงานก่อสร้างแต่ละหลัง (อีเมลสมาชิกในโครงการ)
ALTER TABLE builds ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';
