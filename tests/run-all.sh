#!/usr/bin/env bash
# รันเทสต์ทั้งหมด: npm test
set -e
cd "$(dirname "$0")/.."
echo "== isolation (ข้อมูลไม่รั่วข้ามโครงการ)"; npx tsx tests/isolation.test.mts
echo "== guard (ไม่มี SQL ถึงตารางโครงการนอก tenant-db)"; npx tsx tests/guard.test.mts
echo "== access (สมาชิก / สิทธิ์ทีมช่วยเหลือ)"; npx tsx tests/access.test.mts
echo "== sales (ผังแปลง ลูกค้า ภาพรวม)"; npx tsx tests/sales.test.mts
echo "== loans (สินเชื่อ)"; npx tsx tests/loans.test.mts
echo "== marketing (การตลาด)"; npx tsx tests/marketing.test.mts
echo "== entitlement (สิทธิ์ใช้งาน)"; npx tsx tests/entitlement.test.mts
echo "== team (ผลงานรายคน)"; npx tsx tests/team.test.mts
echo "== archive / plan map / back office"; npx tsx tests/archive-map-office.test.mts
echo "== construction (ก่อสร้าง)"; npx tsx tests/construction.test.mts
echo "== costs (ต้นทุนและกำไร)"; npx tsx tests/costs.test.mts
echo "== calendar (ปฏิทิน)"; npx tsx tests/calendar.test.mts
echo "== promotions (ราคาขายและโปรโมชั่น)"; npx tsx tests/promotions.test.mts
echo "== host / usage / backup"; npx tsx tests/host-usage-backup.test.mts
echo "ทุกเทสต์ผ่าน"
