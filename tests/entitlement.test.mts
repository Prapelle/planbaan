// ระยะ 2: สิทธิ์ใช้งาน (ทดลอง / Pure Product / ขยายให้ / ดูอย่างเดียว)
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject, getProject } from "../src/lib/control";
import * as E from "../src/lib/entitlement";

const cfg = { ...E.ENT, pureMin: 30000, warnDays: 14, graceDays: 14 };
const at = (d: string) => new Date(`${d}T05:00:00Z`); // เวลาไทยวันเดียวกัน

await test("ช่วงทดลอง: ใช้ได้ → ใกล้หมด → ผ่อนผัน → ดูอย่างเดียว", () => {
  const p = { trial_ends_at: "2026-12-31" };
  assert.equal(E.entitlementOf(p, at("2026-12-01"), cfg).state, "active");
  const w = E.entitlementOf(p, at("2026-12-20"), cfg);
  assert.deepEqual([w.state, w.daysLeft, w.source], ["expiring", 11, "trial"]);
  assert.equal(E.entitlementOf(p, at("2027-01-14"), cfg).state, "grace");
  const r = E.entitlementOf(p, at("2027-01-15"), cfg);
  assert.deepEqual([r.state, r.readonly, r.readonlyFrom], ["readonly", true, "2027-01-15"]);
});

await test("ใช้วันที่ไกลที่สุดของ ทดลอง / Pure / ขยายให้ และปิดเองได้", () => {
  const e = E.entitlementOf({ trial_ends_at: "2026-10-01", pure_until: "2027-02-28", paid_until: "2026-12-31" }, at("2026-12-01"), cfg);
  assert.deepEqual([e.state, e.source, e.until], ["active", "pure", "2027-02-28"]);
  assert.equal(E.entitlementOf({ trial_ends_at: "2099-01-01", status: "readonly" }, at("2026-12-01"), cfg).state, "readonly");
  assert.equal(E.entitlementOf({}, at("2026-12-01"), cfg).readonly, false); // ไม่มีข้อมูล = ไม่ล็อก
});

await test("ยอดซื้อ 3 เดือนติดกันถึงขั้นต่ำ → ใช้ได้ถึงสิ้นเดือนถัดไป", () => {
  assert.equal(E.pureUntil([{ month: "2026-09", amount: 10000 }, { month: "2026-10", amount: 10000 }, { month: "2026-11", amount: 10000 }], cfg), "2026-12-31");
  assert.equal(E.pureUntil([{ month: "2026-09", amount: 10000 }, { month: "2026-11", amount: 19999 }], cfg), ""); // ไม่ถึง
  assert.equal(E.pureUntil([{ month: "2026-12", amount: 30000 }], cfg), "2027-01-31"); // ข้ามปี
});

await test("บันทึกยอดซื้อใน back office คำนวณสิทธิ์ใหม่ / ยอด 0 = ลบ", async () => {
  const raw = makeD1();
  const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
  assert.match(String((await getProject(raw as never, p.id))?.trial_ends_at), /^\d{4}-\d{2}-\d{2}$/);
  await E.recordPurchase(raw as never, p.id, "2026-11", "35,000", "staff@x.com");
  assert.equal((await getProject(raw as never, p.id))?.pure_until, E.ENT.pureMin <= 35000 ? "2026-12-31" : "");
  await E.recordPurchase(raw as never, p.id, "2026-11", "0", "staff@x.com");
  assert.equal((await getProject(raw as never, p.id))?.pure_until, "");
  await rejects(E.recordPurchase(raw as never, p.id, "2026-13", 1, "s"), /เดือน/);
  await E.setAccess(raw as never, p.id, { paidUntil: "2027-06-30", status: "readonly" });
  const after = await getProject(raw as never, p.id);
  assert.deepEqual([after?.paid_until, after?.status], ["2027-06-30", "readonly"]);
  await rejects(E.setAccess(raw as never, p.id, { status: "deleted" }), /สถานะ/);
});
