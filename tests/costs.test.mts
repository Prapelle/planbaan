// ต้นทุนและกำไรรายหลัง
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as C from "../src/lib/construction";
import * as K from "../src/lib/costs";
import { canSeeCosts, canEditCosts } from "../src/lib/roles";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(raw as never, p.id);
const other = tenantDb(raw as never, q.id);
const today = S.bkkDate();
const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

await S.createPlotsBulk(db, { zone: "A", count: 4 });
for (const code of ["A01", "A02", "A03", "A04"]) {
  const pl = await S.getPlotByCode(db, code);
  await db.update("plots", pl!.id, { house_type: "3 ห้องนอน", price: 2000000 });
}
const b1 = await C.createBuild(db, { plotCode: "A01", startDate: plus(-60), dueDate: plus(60), price: "2,450,000" }, "o@x.com");
const b2 = await C.createBuild(db, { plotCode: "A02", startDate: plus(-60), dueDate: plus(60) }, "o@x.com");

await test("สิทธิ์: เห็นเฉพาะเจ้าของ บัญชี และทีมช่วยเหลือที่ได้รับสิทธิ์ ผู้จัดการและโฟร์แมนไม่เห็น", () => {
  assert.deepEqual(["owner", "accountant", "manager", "sales", "foreman", "viewer"].map((r) => canSeeCosts(r as never)), [true, true, false, false, false, false]);
  assert.equal(canEditCosts("support" as never, false), false);
  assert.equal(canEditCosts("accountant" as never), true);
});

await test("บันทึกต้นทุน: หลังเดียวพร้อมงวด / แบ่งหลายหลังเท่ากัน เศษไปหลังแรก / ลบทั้งชุด", async () => {
  const [stage] = await C.stagesOf(db, String(b1.id));
  await K.addCosts(db, { buildIds: [String(b1.id)], category: "material", item: "เหล็กเส้น", amount: "120,000", date: today, stageId: String(stage.id) }, "acc@x.com");
  const r = await K.addCosts(db, { buildIds: [String(b1.id), String(b2.id)], category: "material", item: "ปูน", amount: "10000.01", date: today }, "acc@x.com");
  assert.deepEqual([r.count, r.first, r.each], [2, 5000.01, 5000]);
  await rejects(K.addCosts(db, { buildIds: [String(b1.id), String(b2.id)], category: "material", item: "x", amount: "1", date: today, stageId: String(stage.id) }, "a"), /หลังเดียว/);
  await rejects(K.addCosts(db, { buildIds: [String(b1.id)], category: "land", item: "x", amount: "1", date: today }, "a"), /หมวด/);
  await rejects(K.addCosts(db, { buildIds: [String(b1.id)], category: "labor", item: "x", amount: "0", date: today }, "a"), /จำนวนเงิน/);
  await rejects(K.addCosts(db, { buildIds: ["nope"], category: "labor", item: "x", amount: "5", date: today }, "a"), /ไม่พบ/);
  const batch = (await db.list("build_costs", { where: { item: "ปูน (แบ่ง 2 หลัง)" } }))[0];
  assert.equal(await K.removeCost(db, String(batch.id)), 2);
  assert.equal((await db.list("build_costs")).length, 1);
});

await test("กำไร: รายรับ + งานเพิ่มที่ยืนยัน, ที่ดิน, ส่วนกลางเฉลี่ย, งบแม่แบบตามแบบบ้าน, ใช้เร็วกว่างานเตือนล่วงหน้า", async () => {
  await K.setBudgetTemplate(db, "3 ห้องนอน", { material: "600000", labor: "400000", transfer: "30000" });
  await K.setSetting(db, "shared_total", "100,000");
  await K.setPlotLand(db, { A01: { land: "500000" }, A02: { land: "500000" } });
  const ch = await C.addChange(db, String(b1.id), { title: "กันสาด", amount: "50000" }, "o@x.com");
  await C.decideChange(db, String(ch.id), "confirmed", "owner_link:สมชาย");
  // งานคืบหน้า 2/5 = 40% แต่ใช้วัสดุ 120,000 + 300,000 = 70% ของงบ → เตือน
  const [s1, s2] = await C.stagesOf(db, String(b1.id));
  await C.setStageDone(db, String(s1.id), true, "f@x.com");
  await C.setStageDone(db, String(s2.id), true, "f@x.com");
  await K.addCosts(db, { buildIds: [String(b1.id)], category: "material", item: "อิฐ", amount: "300000", date: today }, "acc@x.com");
  const rep = await K.profitReport(db);
  const r = rep.rows.find((x) => x.build.id === b1.id)!;
  assert.equal(r.revenue, 2500000);
  const line = (c: string) => r.lines.find((l) => l.cat === c)!;
  assert.deepEqual([line("land").actual, line("shared").actual], [500000, 25000]); // 100,000 ÷ 4 แปลง
  assert.equal(line("material").actual, 420000);
  assert.equal(line("material").paceWarn, 450000); // 420,000 ÷ 0.4 = 1,050,000 − งบ 600,000
  assert.ok(r.flags.includes("วัสดุใช้เร็วกว่างาน"));
  assert.equal(r.projectedTotal, 500000 + 600000 + 400000 + 30000 + 25000); // คำเตือนไม่หักกำไร
  assert.equal(r.profit, 2500000 - r.projectedTotal);
  const r2 = rep.rows.find((x) => x.build.id === b2.id)!;
  assert.equal(r2.revenue, 2000000); // ไม่มีราคาสัญญา ใช้ราคาแปลง
  assert.equal(rep.rows[0].margin <= rep.rows[1].margin, true); // เรียงกำไรน้อยไปมาก
});

await test("หลังที่ส่งมอบแล้วใช้ต้นทุนจริง ไม่ใช้งบ", async () => {
  for (const s of await C.stagesOf(db, String(b2.id))) await C.setStageDone(db, String(s.id), true, "f@x.com");
  await C.finishBuild(db, String(b2.id), "o@x.com");
  await K.addCosts(db, { buildIds: [String(b2.id)], category: "labor", item: "ค่าแรงรวม", amount: "350000", date: today }, "acc@x.com");
  const r = (await K.profitReport(db)).rows.find((x) => x.build.id === b2.id)!;
  assert.equal(r.lines.find((l) => l.cat === "material")!.projected, 0);
  assert.equal(r.lines.find((l) => l.cat === "labor")!.projected, 350000);
  assert.equal(r.done, true);
});

await test("ค่าการตลาดจากต้นทุนต่อการจองของช่องทางลูกค้าที่จองแปลงนั้น", async () => {
  const lead = await S.createLead(db, { name: "ก", channel: "facebook", plotCode: "A01" }, "s@x.com");
  await S.moveLead(db, lead.id, "booked", "s@x.com");
  await db.insert("marketing_spend", { day: today, month: today.slice(0, 7), channel: "facebook", campaign: "x", amount: 18000, source: "manual" });
  const r = (await K.profitReport(db)).rows.find((x) => x.build.id === b1.id)!;
  assert.equal(r.lines.find((l) => l.cat === "marketing")!.actual, 18000);
});

await test("ต้นทุนไม่รั่วข้ามโครงการ", async () => {
  assert.equal((await K.profitReport(other)).rows.length, 0);
  await rejects(K.addCosts(other, { buildIds: [String(b1.id)], category: "labor", item: "x", amount: "5", date: today }, "a"), /ไม่พบ/);
});

await test("หารตามตารางวา: ที่ดินราคารวมและค่าส่วนกลางแบ่งตามเนื้อที่ แปลงที่ไม่ใส่ตร.ว.ถูกเตือน", async () => {
  await K.setPlotLand(db, { A01: { area: "60" }, A02: { area: "40" }, A03: { area: "50" }, A04: { area: "50" } });
  await K.setSetting(db, "land_mode", "area");
  await K.setSetting(db, "land_total", "2,000,000");
  await K.setSetting(db, "shared_mode", "area");
  const rep = await K.profitReport(db);
  const line = (id: unknown, c: string) => rep.rows.find((x) => x.build.id === id)!.lines.find((l) => l.cat === c)!.actual;
  assert.equal(rep.totalArea, 200);
  assert.equal(line(b1.id, "land"), 600000);   // 2,000,000 × 60/200
  assert.equal(line(b2.id, "land"), 400000);   // × 40/200
  assert.equal(line(b1.id, "shared"), 30000);  // 100,000 × 60/200
  await K.setPlotLand(db, { A02: { area: "0" } });
  const rep2 = await K.profitReport(db);
  assert.equal(rep2.missingArea, 1);
  assert.ok(rep2.rows.find((x) => x.build.id === b2.id)!.flags.includes("ยังไม่ใส่ตร.ว."));
  // ค่าที่ใส่รายแปลงยังอยู่ สลับกลับได้
  await K.setSetting(db, "land_mode", "plot");
  assert.equal((await K.profitReport(db)).rows.find((x) => x.build.id === b1.id)!.lines.find((l) => l.cat === "land")!.actual, 500000);
  await rejects(K.setSetting(db, "shared_mode", "magic"), /วิธีหาร/);
  await rejects(K.setPlotLand(db, { A01: { area: "-5" } }), /เนื้อที่/);
});

await test("รับสร้างบ้าน: หารตามตร.ว.ไม่มีผล ใช้หารเท่ากันต่อหลัง", async () => {
  await K.setSetting(other, "shared_total", "90000");
  await K.setSetting(other, "shared_mode", "area");
  const l = await S.createLead(other, { name: "ข" }, "b@x.com");
  await C.createBuild(other, { leadId: l.id, startDate: plus(0), dueDate: plus(100) }, "b@x.com");
  const rep = await K.profitReport(other, { kind: "builder" });
  assert.equal(rep.sharedMode, "equal");
  assert.equal(rep.rows[0].lines.find((x) => x.cat === "shared")!.actual, 90000);
});
