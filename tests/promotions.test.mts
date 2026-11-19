// ราคาขายจริงและโปรโมชั่น
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as C from "../src/lib/construction";
import * as K from "../src/lib/costs";
import * as P from "../src/lib/promotions";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(raw as never, p.id);
const other = tenantDb(raw as never, q.id);
await S.createPlotsBulk(db, { zone: "A", count: 3, price: 2500000 });

await test("ชุดโปรเริ่มต้นเติมให้ครั้งแรกครั้งเดียว ลบหมดแล้วไม่เติมซ้ำ หมดเขต/ปิดแล้วไม่ให้เลือก", async () => {
  const rows = await P.catalog(db);
  assert.deepEqual(rows.map((r) => r.name), ["ส่วนลดเงินสด", "ฟรีค่าโอน", "ฟรีค่าจดจำนอง", "แอร์ 2 เครื่อง"]);
  assert.equal((await P.catalog(db)).length, 4);
  for (const r of rows) await P.removePromo(other.projectId === db.projectId ? other : db, r.id);
  assert.equal((await P.catalog(db)).length, 0);
  await P.savePromo(db, { name: "โปรปีใหม่ ส่วนลด", kind: "cash", value: "50,000", validUntil: "2026-01-31" });
  await P.savePromo(db, { name: "แอร์", kind: "gift", value: "30000" });
  await P.savePromo(db, { name: "ปิดแล้ว", kind: "gift", value: "1", active: false });
  assert.deepEqual(P.available(await P.catalog(db), "2026-11-19").map((r) => r.name), ["แอร์"]);
  await rejects(P.savePromo(db, { name: "x", kind: "free", value: "1" }), /ประเภท/);
  await rejects(P.savePromo(db, { name: "", kind: "gift", value: "1" }), /ชื่อ/);
});

let lead: { id: string };
await test("สรุปราคา: ราคาตั้งจากแปลง ราคาขายจริง ส่วนลดเงินสด ของแถม ฟรีค่าโอน และ % เทียบเกณฑ์ 3%", async () => {
  lead = await S.createLead(db, { name: "คุณวิชัย", plotCode: "A01" }, "s@x.com");
  let { summary } = await P.priceOf(db, lead.id);
  assert.deepEqual([summary.list, summary.sale, summary.totalDiscount, summary.needsApproval, summary.threshold], [2500000, 2500000, 0, false, 3]);
  await P.setSalePrice(db, lead.id, "2,450,000");
  const [aircon] = P.available(await P.catalog(db), "2026-11-19");
  await P.addLeadPromo(db, lead.id, { promoId: aircon.id, value: "30000" }, "s@x.com");
  await P.addLeadPromo(db, lead.id, { name: "ฟรีค่าโอน", kind: "transfer", value: "25000" }, "s@x.com");
  await rejects(P.addLeadPromo(db, lead.id, { name: "x", kind: "cash", value: "0" }, "s"), /มูลค่า/);
  ({ summary } = await P.priceOf(db, lead.id));
  assert.deepEqual([summary.priceCut, summary.gift, summary.transfer, summary.totalDiscount, summary.pct], [50000, 30000, 25000, 105000, 4.2]);
  assert.equal(summary.needsApproval, true);
});

await test("เกินเกณฑ์: เลื่อนเข้าขั้นจองไม่ได้จนผู้จัดการอนุมัติ / ลดเพิ่มหลังอนุมัติต้องอนุมัติใหม่", async () => {
  await rejects(S.moveLead(db, lead.id, "booked", "s@x.com"), /เกินเกณฑ์ 3%/);
  await S.moveLead(db, lead.id, "visited", "s@x.com"); // ขั้นก่อนจองยังเลื่อนได้
  await P.approveDiscount(db, lead.id, "mgr@x.com");
  await S.moveLead(db, lead.id, "booked", "s@x.com");
  await P.addLeadPromo(db, lead.id, { name: "ส่วนลดเงินสด", kind: "cash", value: "10000" }, "s@x.com");
  const { summary } = await P.priceOf(db, lead.id);
  assert.equal(summary.needsApproval, true); // เกินยอดที่อนุมัติไว้
  // ลูกค้าอยู่ขั้นจองแล้ว การเลื่อนต่อ (จอง → ยื่นกู้) ไม่ติดเงื่อนไขนี้
  await S.moveLead(db, lead.id, "loan", "s@x.com");
  // ปรับเกณฑ์เป็น 5% → ไม่ต้องอนุมัติ
  await P.setApprovePct(db, "5");
  assert.equal((await P.priceOf(db, lead.id)).summary.needsApproval, false);
  await rejects(P.setApprovePct(db, "0"), /เกณฑ์/);
});

await test("ส่วนลดไม่เกินเกณฑ์จองได้เลย / ไม่มีแปลงไม่คิดส่วนลด", async () => {
  const l2 = await S.createLead(db, { name: "คุณมาลี", plotCode: "A02" }, "s@x.com");
  await P.addLeadPromo(db, l2.id, { name: "แอร์", kind: "gift", value: "30000" }, "s@x.com"); // 1.2%
  await S.moveLead(db, l2.id, "booked", "s@x.com");
  const l3 = await S.createLead(db, { name: "ยังไม่เลือกแปลง" }, "s@x.com");
  await P.addLeadPromo(db, l3.id, { name: "แอร์", kind: "gift", value: "999999" }, "s@x.com");
  assert.equal((await P.priceOf(db, l3.id)).summary.needsApproval, false);
});

await test("กำไร: รายรับ = ราคาขายจริง − ส่วนลดเงินสด ของแถม/ฟรีค่าโอนเข้าเป็นต้นทุนเอง", async () => {
  const b = await C.createBuild(db, { plotCode: "A01", startDate: "2026-10-01", dueDate: "2027-04-01", price: "9,999,999" }, "o@x.com");
  const r = (await K.profitReport(db)).rows.find((x) => x.build.id === b.id)!;
  assert.equal(r.revenue, 2450000 - 10000); // ราคาขายจริงจากหน้าลูกค้า ชนะราคาที่ใส่ในงานก่อสร้าง
  const line = (c: string) => r.lines.find((l) => l.cat === c)!;
  assert.deepEqual([line("giveaway").actual, line("giveaway").promo, line("transfer").actual], [30000, 30000, 25000]);
});

await test("โปรไม่รั่วข้ามโครงการ", async () => {
  await rejects(P.addLeadPromo(other, lead.id, { name: "x", kind: "gift", value: "1" }, "b"), /ไม่พบลูกค้า/);
  assert.equal((await other.list("lead_promos")).length, 0);
});
