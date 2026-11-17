// ระยะ 2: ผลงานรายคน
import assert from "node:assert/strict";
import { makeD1, test } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import { teamReport, monthRange } from "../src/lib/team";
import { thisMonth, shiftMonth } from "../src/lib/marketing";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(raw as never, p.id);
const members = [{ email: "o@x.com", role: "owner" }, { email: "a@x.com", role: "sales" }, { email: "b@x.com", role: "sales" }];
await S.createPlotsBulk(db, { zone: "A", count: 3 });
const l1 = await S.createLead(db, { name: "ก", plotCode: "A01", ownerEmail: "a@x.com" }, "a@x.com");
const l2 = await S.createLead(db, { name: "ข", ownerEmail: "a@x.com", nextFollowAt: "2020-01-01" }, "a@x.com");
await S.createLead(db, { name: "ค", ownerEmail: "b@x.com" }, "b@x.com");
await S.moveLead(db, l1.id, "visited", "a@x.com");
await S.moveLead(db, l1.id, "booked", "o@x.com"); // ผู้จัดการกดจองให้ → นับให้ผู้ดูแล a
await S.moveLead(db, l1.id, "visited", "o@x.com");
await S.moveLead(db, l1.id, "booked", "o@x.com"); // กลับไปมา ไม่นับซ้ำ
await S.logContact(db, l2.id, "โทรแล้ว", "b@x.com"); // b ช่วยโทร → นับการติดต่อให้ b
await tenantDb(raw as never, q.id).insert("leads", { name: "อื่น", owner_email: "a@x.com", stage: "new", channel: "other" });

await test("นับงานให้คนบันทึก ผลลัพธ์ให้ผู้ดูแล และไม่นับซ้ำเมื่อเลื่อนกลับไปมา", async () => {
  const r = await teamReport(db, thisMonth(), members);
  const a = r.rows.find((x) => x.email === "a@x.com")!;
  const b = r.rows.find((x) => x.email === "b@x.com")!;
  assert.deepEqual([a.newLeads, a.visits, a.bookings, a.open, a.overdue], [2, 1, 1, 2, 1]);
  assert.deepEqual([b.contacts, b.newLeads, b.bookings], [1, 1, 0]);
  assert.equal(r.rows[0].email, "a@x.com"); // จองมากสุดขึ้นก่อน
  assert.equal(r.total.newLeads, 3); // ไม่รวมโครงการอื่น
});

await test("เดือนอื่นไม่มีงานของเดือนนี้ แต่สถานะค้างยังแสดง", async () => {
  const r = await teamReport(db, shiftMonth(thisMonth(), -1), members);
  assert.equal(r.total.bookings + r.total.contacts + r.total.newLeads, 0);
  assert.equal(r.total.open, 3);
});

await test("ช่วงเดือนตามเวลาไทย", () => {
  assert.deepEqual(monthRange("2026-11"), { start: "2026-10-31T17:00:00.000Z", end: "2026-11-30T17:00:00.000Z" });
});
