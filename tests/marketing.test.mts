// ระยะ 2: การตลาด
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as M from "../src/lib/marketing";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(raw as never, p.id);
const other = tenantDb(raw as never, q.id);
const month = M.thisMonth();
const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

const FB = `﻿Reporting starts,Reporting ends,Campaign name,Amount spent (THB),Results
${day(1)},${day(1)},บ้านเดี่ยวโปรปีใหม่,"1,200.50",3
${day(2)},${day(2)},บ้านเดี่ยวโปรปีใหม่,800,2
${day(2)},${day(2)},"Retarget, ผู้เคยดู",300,0
,,,"2,301",5
`;
const GOOGLE = `Campaign performance report
"1 November 2026 - 30 November 2026"
Day,Campaign,Cost,Clicks
${day(3)},Search บุรีรัมย์,500.00,40
Total: Account,--,500.00,40
`;
const THAI_TIKTOK = `วันที่\tชื่อแคมเปญ\tค่าใช้จ่าย
${day(4).split("-").reverse().join("/").replace(/\d{4}$/, (y) => String(Number(y) + 543))}\tวิดีโอบ้านตัวอย่าง\t250
`;

await test("อ่าน CSV Facebook: ข้ามแถวรวม ตัวเลขมีคอมมา ชื่อมีคอมมาในเครื่องหมายคำพูด", () => {
  const r = M.parseAdsCsv(FB, "facebook");
  assert.equal(r.rows.length, 3);
  assert.equal(r.total, 2300.5);
  assert.equal(r.rows[2].campaign, "Retarget, ผู้เคยดู");
  assert.ok(r.warnings.some((w) => w.includes("วันเริ่มรายงาน")));
});

await test("อ่าน CSV Google: หาแถวหัวตารางที่อยู่ใต้หัวรายงาน", () => {
  const r = M.parseAdsCsv(GOOGLE, "google");
  assert.deepEqual(r.rows, [{ day: day(3), channel: "google", campaign: "Search บุรีรัมย์", amount: 500 }]);
});

await test("อ่านไฟล์หัวตารางภาษาไทย คั่นด้วย tab วันที่แบบ พ.ศ.", () => {
  const r = M.parseAdsCsv(THAI_TIKTOK, "tiktok");
  assert.equal(r.rows[0].day, day(4));
  assert.equal(r.rows[0].amount, 250);
});

await test("ไฟล์ที่ไม่ใช่รายงานโฆษณา แจ้งให้ชัด", () => {
  assert.throws(() => M.parseAdsCsv("name,phone\nก,1", "facebook"), /ไม่พบคอลัมน์/);
  assert.throws(() => M.parseAdsCsv(FB, "myspace"), /ช่องทาง/);
});

await test("นำเข้าซ้ำไม่นับซ้ำ (แทนที่แถวเดิม)", async () => {
  const r = M.parseAdsCsv(FB, "facebook");
  const a = await M.upsertSpend(db, r.rows, "csv");
  assert.deepEqual([a.added, a.replaced], [3, 0]);
  const b = await M.upsertSpend(db, r.rows, "csv");
  assert.deepEqual([b.added, b.replaced], [0, 3]);
  assert.equal((await M.marketingReport(db, month)).total.spend, 2300.5);
});

await test("ต้นทุนต่อลูกค้า/เข้าชม/จอง นับลูกค้าที่เคยเข้าชมแล้วไม่ซื้อด้วย", async () => {
  await S.createPlotsBulk(db, { zone: "A", count: 3 });
  const l1 = await S.createLead(db, { name: "ก", channel: "facebook", plotCode: "A01" }, "s@x.com");
  const l2 = await S.createLead(db, { name: "ข", channel: "facebook" }, "s@x.com");
  await S.createLead(db, { name: "ค", channel: "facebook" }, "s@x.com");
  await S.createLead(db, { name: "ง", channel: "walkin" }, "s@x.com");
  await S.moveLead(db, l1.id, "visited", "s@x.com");
  await S.moveLead(db, l1.id, "booked", "s@x.com");
  await S.moveLead(db, l2.id, "visited", "s@x.com");
  await S.moveLead(db, l2.id, "lost", "s@x.com", { lostReason: "competitor" }); // เข้าชมแล้วไม่ซื้อ ยังนับเป็นการเข้าชม
  const rep = await M.marketingReport(db, month);
  const fb = rep.channels.find((c) => c.channel === "facebook")!;
  assert.deepEqual([fb.leads, fb.visits, fb.bookings], [3, 2, 1]);
  assert.deepEqual(M.cost(fb), { perLead: 767, perVisit: 1150, perBooking: 2301 });
  const walk = rep.channels.find((c) => c.channel === "walkin")!;
  assert.equal(M.cost(walk).perLead, null); // ไม่มีค่าใช้จ่าย ไม่แสดงต้นทุน
});

await test("งบต่อช่องทาง: ตั้ง แก้ ลบเป็น 0", async () => {
  await M.setBudget(db, month, { facebook: "5,000", google: "2000", tiktok: "" });
  await M.setBudget(db, month, { facebook: "6000", google: "0" });
  const rep = await M.marketingReport(db, month);
  assert.equal(rep.budgetByChannel.facebook, 6000);
  assert.equal(rep.budgetByChannel.google, 0);
  assert.equal(rep.total.budget, 6000);
  await rejects(M.setBudget(db, "2026-13", {}), /เดือน/);
});

await test("กรอกเองและลบ / ล้างทั้งเดือนของช่องทาง", async () => {
  await M.addSpend(db, { day: day(5), channel: "agent", campaign: "ค่านายหน้า", amount: "10000" });
  await rejects(M.addSpend(db, { day: "5/11", channel: "agent", amount: "1" }), /วันที่/);
  await rejects(M.addSpend(db, { day: day(5), channel: "agent", amount: "-3" }), /จำนวนเงิน/);
  let rep = await M.marketingReport(db, month);
  const row = rep.recentSpend.find((r) => r.channel === "agent")!;
  await M.removeSpend(db, String(row.id));
  assert.equal(await M.clearSpend(db, month, "facebook"), 3);
  rep = await M.marketingReport(db, month);
  assert.equal(rep.total.spend, 0);
});

await test("แนวโน้ม 6 เดือน และข้อมูลไม่รั่วข้ามโครงการ", async () => {
  await M.upsertSpend(other, [{ day: day(1), channel: "facebook", campaign: "x", amount: 99999 }], "csv");
  await M.upsertSpend(db, [{ day: `${M.shiftMonth(month, -2)}-15`, channel: "google", campaign: "", amount: 700 }], "csv");
  const rep = await M.marketingReport(db, month);
  assert.equal(rep.trend.length, 6);
  assert.equal(rep.trend[3].spend, 700);
  assert.equal(rep.trend[5].spend, 0);
  assert.equal(M.shiftMonth("2026-01", -1), "2025-12");
});
