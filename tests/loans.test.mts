// ระยะ 2: สินเชื่อ
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as L from "../src/lib/loans";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(raw as never, p.id);
const other = tenantDb(raw as never, q.id);
await S.createPlotsBulk(db, { zone: "A", count: 5 });
const lead = await S.createLead(db, { name: "คุณอนันต์", plotCode: "A01" }, "s@x.com");
const early = await S.createLead(db, { name: "คุณยังไม่จอง" }, "s@x.com");
await S.moveLead(db, lead.id, "booked", "s@x.com");
const plot = async () => (await S.getPlotByCode(db, "A01"))?.sale_status;
const apps = () => L.appsOf(db, lead.id);

await test("จัดการสินเชื่อได้เฉพาะลูกค้าที่จองหรือยื่นกู้", async () => {
  await rejects(L.addBank(db, early.id, "ออมสิน", "s@x.com"), /เฉพาะลูกค้าที่จอง/);
  assert.deepEqual((await L.loanCases(db)).map((c) => c.lead.id), [lead.id]);
});

await test("เช็กลิสต์เอกสาร เก็บเฉพาะรายการที่รู้จัก", async () => {
  await L.setDocs(db, lead.id, ["id_card", "statement", "passport_scan"]);
  const l = await db.get("leads", lead.id);
  assert.deepEqual(L.docsOf(l!), ["id_card", "statement"]);
  assert.equal(L.summarize(l!, []).docsDone, 2);
});

await test("เพิ่มธนาคาร: ต้องอยู่ในรายการ และห้ามซ้ำ", async () => {
  await rejects(L.addBank(db, lead.id, "ธนาคารปลอม", "s@x.com"), /รายการ/);
  await L.addBank(db, lead.id, "ธอส.", "s@x.com");
  await L.addBank(db, lead.id, "กสิกรไทย", "s@x.com");
  await rejects(L.addBank(db, lead.id, "ธอส.", "s@x.com"), /ไว้แล้ว/);
  assert.equal((await apps()).length, 2);
});

await test("ยื่นธนาคารแรก → ลูกค้าเลื่อนเป็นยื่นกู้ และแปลงเป็นสียื่นกู้", async () => {
  const [a] = await apps();
  await L.setAppStatus(db, a.id, "submitted", "s@x.com", { officer: "คุณเจ้าหน้าที่" });
  assert.equal((await db.get("leads", lead.id))?.stage, "loan");
  assert.equal(await plot(), "loan");
  assert.equal((await apps())[0].officer, "คุณเจ้าหน้าที่");
});

await test("ไม่ผ่านทุกธนาคาร → เริ่มนับวันถือแปลง แต่แปลงยังไม่ถูกปล่อย", async () => {
  const [a, b] = await apps();
  await L.setAppStatus(db, a.id, "rejected", "s@x.com");
  assert.equal((await db.get("leads", lead.id))?.debt_since, "");
  await L.setAppStatus(db, b.id, "rejected", "s@x.com");
  const l = await db.get("leads", lead.id);
  assert.ok(l?.debt_since);
  assert.equal(await plot(), "loan");
  const later = new Date(Date.now() + 55 * 86400_000);
  const s = L.summarize(l!, await apps(), later);
  assert.ok(s.allRejected && s.heldDays === 55 && s.holdWarning);
  await L.saveDebt(db, lead.id, { reason: "ภาระหนี้ต่อรายได้สูง", plan: "ปิดบัตรเครดิต 2 ใบ", retryAt: "2027-02-01" });
  await rejects(L.saveDebt(db, lead.id, { reason: "", plan: "", retryAt: "1/2/70" }), /วันที่/);
});

await test("ยื่นใหม่จนผ่าน → ยกเลิกการนับวันถือแปลง และย้ายไปโอนได้", async () => {
  await rejects(L.markTransferred(db, lead.id, "s@x.com"), /ยังไม่มีธนาคารอนุมัติ/);
  await L.addBank(db, lead.id, "ออมสิน", "s@x.com");
  const c = (await apps()).find((x) => x.bank === "ออมสิน")!;
  await L.setAppStatus(db, c.id, "approved", "s@x.com", { amount: 2150000 });
  const l = await db.get("leads", lead.id);
  assert.equal(l?.debt_since, "");
  assert.equal(L.summarize(l!, await apps()).bestAmount, 2150000);
  await L.markTransferred(db, lead.id, "s@x.com");
  assert.equal((await db.get("leads", lead.id))?.stage, "transferred");
  assert.equal(await plot(), "transferred");
  const h = await S.leadHistory(db, lead.id);
  assert.ok(h.some((x) => x.kind === "loan" && String(x.note).includes("ออมสิน: อนุมัติ")));
});

await test("ธนาคารไม่ขยับเกิน 7 วันถูกนับว่าค้าง", async () => {
  const l2 = await S.createLead(db, { name: "คุณรัตนา", plotCode: "A02", stage: "booked" }, "s@x.com");
  await L.addBank(db, l2.id, "กรุงไทย", "s@x.com");
  const [x] = await L.appsOf(db, l2.id);
  await L.setAppStatus(db, x.id, "appraisal", "s@x.com");
  const s = L.summarize((await db.get("leads", l2.id))!, await L.appsOf(db, l2.id), new Date(Date.now() + 8 * 86400_000));
  assert.equal(s.staleApps, 1);
});

await test("อีกโครงการแตะรายการยื่นไม่ได้", async () => {
  const [a] = await apps();
  await rejects(L.setAppStatus(other, a.id, "approved", "x@x.com"), /ไม่พบรายการ/);
  await rejects(L.removeApp(other, a.id, "x@x.com"), /ไม่พบรายการ/);
  assert.equal(await other.count("loan_apps"), 0);
});

console.log("loans: ผ่าน");
