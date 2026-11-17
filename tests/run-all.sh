#!/usr/bin/env bash
# รันเทสต์ทั้งหมด: npm test
set -e
cd "$(dirname "$0")/.."
echo "== isolation (ข้อมูลไม่รั่วข้ามโครงการ)"; npx tsx tests/isolation.test.mts
echo "== guard (ไม่มี SQL ถึงตารางโครงการนอก tenant-db)"; npx tsx tests/guard.test.mts
echo "== access (สมาชิก / สิทธิ์ทีมช่วยเหลือ)"; npx tsx tests/access.test.mts
echo "== sales (ผังแปลง ลูกค้า ภาพรวม)"; npx tsx tests/sales.test.mts
echo "== host / usage / backup"; npx tsx tests/host-usage-backup.test.mts
echo "ทุกเทสต์ผ่าน"
