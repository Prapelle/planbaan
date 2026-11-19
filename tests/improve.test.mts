// นำเข้า Excel, เบอร์ซ้ำ, แจ้งเตือน, ขั้นเริ่มต้นใช้
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as C from "../src/lib/construction";
import * as P from "../src/lib/promotions";
import { importLeads, importPlots, channelOf, stageOf } from "../src/lib/importer";
import { notifications } from "../src/lib/notify";
import { checklist, setFlag, stageOf as onboardStage } from "../src/lib/onboarding";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const db = tenantDb(raw as never, p.id);

await test("ขั้นเริ่มต้นใช้: ยังไม่ทำอะไร → ทำทีละขั้น → ติดตั้งแอป", async () => {
  let c = await checklist(db, { kind: "developer", construction: false, members: 1 });
  assert.deepEqual(c.steps.map((s) => s.done), [false, false, false, false]);
  assert.deepEqual(onboardStage("developer", {}, 0), { n: 1, label: "ยังไม่ตั้งผังแปลง" });
  await importPlots(db, [{ code: "A01" }]);
  await setFlag(db, "pwa_seen");
  c = await checklist(db, { kind: "developer", construction: false, members: 2 });
  assert.deepEqual(c.steps.map((s) => s.done), [true, true, false, true]);
});

await test("นำเข้าแปลง: สร้างใหม่ อัปเดตของเดิม ข้ามแถวผิด", async () => {
  const r = await importPlots(db, [
    { code: "a01", price: "2,390,000", house_type: "แบบ A" }, { code: "A02", price: "2,490,000", area_sqw: "52.5 ตร.ว." },
    { code: "A02" }, { code: "" }, { code: "B 01", price: "abc" }, { code: "C01", zone: "" },
  ]);
  assert.deepEqual([r.added, r.updated, r.skipped.map((s) => s.row)], [2, 1, [4, 5, 6]]);
  const a1 = await S.getPlotByCode(db, "A01");
  assert.deepEqual([a1!.price, a1!.house_type], [2390000, "แบบ A"]);
  assert.equal((await S.getPlotByCode(db, "C01"))!.zone, "C");
});

await test("นำเข้าลูกค้า: ช่องทาง/ขั้นจากคำไทย เบอร์ซ้ำข้าม จองต้องมีแปลงว่าง", async () => {
  assert.deepEqual([channelOf("เพจเฟส"), channelOf("ไลน์ OA"), channelOf("งานบ้าน"), stageOf("จองแล้ว"), stageOf("นัดดูบ้าน"), stageOf("?")], ["facebook", "line", "other", "booked", "visit_scheduled", "new"]);
  const r = await importLeads(db, [
    { name: "ก", phone: "081-234-5678", channel: "Facebook", stage: "จอง", plot_code: "A01" },
    { name: "ข", phone: "+66812345678" },                       // ซ้ำกับแถวบน
    { name: "ค", phone: "0899999999", stage: "จอง", plot_code: "A01" }, // แปลงถูกจองแล้ว → เข้าชมแล้ว
    { name: "ง", stage: "โอนแล้ว" },                                // ไม่มีแปลง → เข้าชมแล้ว
    { name: "", phone: "0800000000" },
    { name: "จ", stage: "ยกเลิก", owner_email: "S@X.com" },
  ], "o@x.com", ["s@x.com"]);
  assert.deepEqual([r.added, r.skipped.map((s) => s.row), r.notes.map((n) => n.row)], [4, [3, 6], [4, 5]]);
  const all = await db.list("leads", { limit: 100 });
  const by = (n: string) => all.find((l) => l.name === n)!;
  assert.deepEqual([by("ก").stage, by("ก").channel, by("ค").stage, by("จ").stage, by("จ").lost_reason, by("จ").owner_email], ["booked", "facebook", "visited", "lost", "other", "s@x.com"]);
  assert.equal((await S.getPlotByCode(db, "A01"))!.sale_status, "booked");
});

await test("เพิ่มลูกค้าเบอร์ซ้ำ: ไม่ให้เพิ่มจนกว่ายืนยัน", async () => {
  await rejects(S.createLead(db, { name: "ก ซ้ำ", phone: "0812345678" }, "s"), /มีอยู่แล้ว: ก/);
  await S.createLead(db, { name: "ก ซ้ำ", phone: "0812345678" }, "s", { allowDuplicate: true });
  assert.equal((await S.findByPhone(db, "081 234 5678", "nope"))?.name !== undefined, true);
});

await test("แจ้งเตือนตามบทบาท: ฝ่ายขายเห็นลูกค้าตัวเอง ผู้จัดการเห็นรออนุมัติ โฟร์แมนเห็นแต่บ้าน", async () => {
  const mine = await S.createLead(db, { name: "นัดวันนี้", nextFollowAt: S.bkkDate(), ownerEmail: "s@x.com" }, "s@x.com");
  await S.createLead(db, { name: "ของคนอื่น", nextFollowAt: S.bkkDate(), ownerEmail: "t@x.com" }, "t@x.com");
  const disc = await S.createLead(db, { name: "ลดเยอะ", plotCode: "A02" }, "s@x.com");
  await P.addLeadPromo(db, disc.id, { name: "ส่วนลด", kind: "cash", value: "200000" }, "s@x.com");
  const b = await C.createBuild(db, { title: "บ้านช้า", startDate: "2026-01-01", dueDate: "2026-03-01", ownerEmail: "f@x.com" }, "o");
  const base = { kind: "developer", construction: true, staleDays: 7 };
  const sales = await notifications(db, { ...base, role: "sales", email: "s@x.com" });
  assert.ok(sales.some((n) => n.key === `follow-${mine.id}`) && !sales.some((n) => n.title.includes("ของคนอื่น")) && !sales.some((n) => n.group === "รออนุมัติ"));
  const mgr = await notifications(db, { ...base, role: "manager", email: "m@x.com" });
  assert.ok(mgr.some((n) => n.key === `approve-${disc.id}` && n.href.endsWith("#price")) && mgr.some((n) => n.key === `late-${b.id}`));
  const fm = await notifications(db, { ...base, role: "foreman", email: "f@x.com" });
  assert.deepEqual(fm.map((n) => n.group), ["ก่อสร้าง"]);
  assert.equal((await notifications(db, { ...base, role: "foreman", email: "other@x.com" })).length, 0);
});

await test("รอบสาม: นำเข้าของรับสร้างบ้าน ใช้คำของรับสร้าง และเซ็นสัญญาไม่ต้องมีแปลง / โฟร์แมนเห็นบ้านที่ยังไม่กำหนดผู้รับผิดชอบ", async () => {
  const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com", kind: "builder" });
  const bdb = tenantDb(raw as never, q.id);
  assert.deepEqual(["เซ็นสัญญาแล้ว", "กำลังก่อสร้าง", "ส่งมอบแล้ว", "เสนอแบบ", "ดูที่ดิน", "ไม่สร้าง"].map(stageOf), ["booked", "loan", "transferred", "visited", "visit_scheduled", "lost"]);
  const r = await importLeads(bdb, [{ name: "ลูกค้าสร้างบ้าน", stage: "เซ็นสัญญา" }], "b@x.com", [], "builder");
  assert.deepEqual([r.added, r.notes.length, (await bdb.list("leads"))[0].stage], [1, 0, "booked"]);
  const nb = await C.createBuild(db, { title: "ยังไม่มีผู้รับผิดชอบ", startDate: "2026-01-01", dueDate: "2026-02-01" }, "o");
  const fm = await notifications(db, { kind: "developer", construction: true, staleDays: 7, role: "foreman", email: "other@x.com" });
  assert.ok(fm.some((n) => n.key === `late-${nb.id}`));
});
