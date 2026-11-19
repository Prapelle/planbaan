// ข้อแก้จากการตรวจเทียบแผน (2026-11-19)
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as L from "../src/lib/loans";
import * as C from "../src/lib/construction";
import * as K from "../src/lib/costs";
import * as P from "../src/lib/promotions";
import { teamReport } from "../src/lib/team";
import { thisMonth } from "../src/lib/marketing";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const db = tenantDb(raw as never, p.id);
await S.createPlotsBulk(db, { zone: "A", count: 4, price: 2000000 });

await test("ลบธนาคาร: ที่เหลือไม่ผ่านทุกธนาคาร → เริ่มนับแก้หนี้ / ลบจนหมด → เลิกนับ", async () => {
  const l = await S.createLead(db, { name: "แก้หนี้", plotCode: "A01" }, "s");
  await S.moveLead(db, l.id, "booked", "s");
  await L.addBank(db, l.id, "ธอส.", "s"); await L.addBank(db, l.id, "ออมสิน", "s");
  const [a, b] = await L.appsOf(db, l.id);
  await L.setAppStatus(db, a.id, "rejected", "s");
  await L.setAppStatus(db, b.id, "submitted", "s");
  assert.equal((await db.get("leads", l.id))!.debt_since, "");
  await L.removeApp(db, b.id, "s");
  assert.ok((await db.get("leads", l.id))!.debt_since, "เหลือแต่ธนาคารที่ไม่ผ่าน ต้องเริ่มนับ");
  await L.removeApp(db, a.id, "s");
  assert.equal((await db.get("leads", l.id))!.debt_since, "");
});

await test("ลูกค้าจองแล้วเอาแปลงออกไม่ได้ (รับสร้างบ้านไม่บังคับ)", async () => {
  const l = await S.createLead(db, { name: "จองแล้ว", plotCode: "A02" }, "s");
  await S.moveLead(db, l.id, "booked", "s");
  await rejects(S.updateLead(db, l.id, { plotCode: "" }, "s"), /ต้องมีแปลง/);
  await S.updateLead(db, l.id, { plotCode: "A03" }, "s"); // ย้ายแปลงได้
  assert.equal((await S.getPlotByCode(db, "A02"))!.sale_status, "available");
  assert.equal((await S.getPlotByCode(db, "A03"))!.sale_status, "booked");
});

await test("ลบแปลงที่มีงานก่อสร้างไม่ได้", async () => {
  await C.createBuild(db, { plotCode: "A04", startDate: "2026-11-01", dueDate: "2027-05-01" }, "o");
  await rejects(S.deletePlot(db, "A04"), /งานก่อสร้าง/);
});

await test("กำไร: ใช้ราคาและโปรของผู้ซื้อ ไม่ใช่ลูกค้าที่แค่สนใจแปลงเดียวกัน", async () => {
  const buyer = await S.createLead(db, { name: "ผู้ซื้อ", plotCode: "A04" }, "s");
  await P.setSalePrice(db, buyer.id, "1,950,000");
  await S.moveLead(db, buyer.id, "booked", "s");
  const browser = await S.createLead(db, { name: "แค่สนใจ", plotCode: "A04" }, "s"); // อัปเดตล่าสุด แต่ยังไม่จอง
  await P.setSalePrice(db, browser.id, "1,000,000");
  await P.addLeadPromo(db, browser.id, { name: "แอร์", kind: "gift", value: "50000" }, "s");
  const r = (await K.profitReport(db)).rows.find((x) => x.plotCode === "A04")!;
  assert.equal(r.revenue, 1950000);
  assert.equal(r.lines.find((x) => x.cat === "giveaway")!.promo, 0);
});

await test("ผลงานรายคน: ข้ามขั้นไปยื่นกู้ยังนับการเข้าชมและการจอง", async () => {
  const l = await S.createLead(db, { name: "ข้ามขั้น", ownerEmail: "a@x.com" }, "a@x.com");
  await S.moveLead(db, l.id, "loan", "a@x.com", { requirePlot: false });
  const row = (await teamReport(db, thisMonth(), [{ email: "a@x.com", role: "sales" }])).rows.find((r) => r.email === "a@x.com")!;
  assert.deepEqual([row.visits, row.bookings], [1, 1]);
});

await test("อ่านเฉพาะคอลัมน์ที่ขอ (back office ไม่แตะชื่อลูกค้า)", async () => {
  const [b] = await db.list("builds", { columns: ["start_date", "status"], limit: 1 });
  assert.equal(b.customer_name, undefined);
  assert.equal(b.start_date, "2026-11-01");
  await rejects(db.list("builds", { columns: ["nope"] }), /คอลัมน์/);
});

await test("ไม่ซื้อต้องมีเหตุผล / อื่น ๆ ต้องมีรายละเอียด / กลับมาใหม่ล้างเหตุผล / สรุปในหน้าการตลาด", async () => {
  const l = await S.createLead(db, { name: "ไม่ซื้อ", channel: "facebook" }, "s");
  await rejects(S.moveLead(db, l.id, "lost", "s"), /เหตุผล/);
  await rejects(S.moveLead(db, l.id, "lost", "s", { lostReason: "other" }), /รายละเอียด/);
  await S.moveLead(db, l.id, "lost", "s", { lostReason: "competitor", lostNote: "ซื้อโครงการ ก." });
  let row = (await db.get("leads", l.id))!;
  assert.deepEqual([row.lost_reason, row.lost_note], ["competitor", "ซื้อโครงการ ก."]);
  assert.match(String((await S.leadHistory(db, l.id))[0].note), /ซื้อโครงการอื่น · ซื้อโครงการ ก\./);
  assert.equal(S.lostLabels("builder").competitor, "เลือกบริษัทอื่น");
  const { marketingReport, thisMonth: tm } = await import("../src/lib/marketing");
  const rep = await marketingReport(db, tm());
  assert.deepEqual(rep.lostReasons.map((x) => [x.reason, x.count, x.byChannel.facebook]), [["competitor", 1, 1]]);
  await S.moveLead(db, l.id, "contacted", "s");
  row = (await db.get("leads", l.id))!;
  assert.deepEqual([row.lost_reason, row.lost_note], ["", ""]);
});

await test("การ์ดงานก่อสร้าง: ผู้รับผิดชอบ วันเหลือถึงส่งมอบ เก็บเงินแล้วกี่ % รูปล่าสุด", async () => {
  const b = await C.createBuild(db, { title: "บ้านทดสอบการ์ด", startDate: "2026-11-01", dueDate: "2026-12-31", ownerEmail: "Foreman@X.com " }, "o");
  assert.equal((await db.get("builds", b.id))!.owner_email, "foreman@x.com");
  const st = await C.stagesOf(db, b.id);
  await C.updateStage(db, st[0].id, { payAmount: "300000" }, "o");
  await C.updateStage(db, st[1].id, { payAmount: "700000" }, "o");
  await C.setStageDone(db, st[0].id, true, "f");
  await C.setPaid(db, st[0].id, true, "o");
  await C.addPhoto(db, b.id, { key: `${C.photoPrefix(db.projectId, b.id)}a.jpg` }, "f");
  await new Promise((r) => setTimeout(r, 5));
  const p2 = await C.addPhoto(db, b.id, { key: `${C.photoPrefix(db.projectId, b.id)}b.jpg` }, "f");
  const s = (await C.buildBoard(db, 7, new Date("2026-12-21T05:00:00Z"))).all.find((x) => x.build.id === b.id)!;
  assert.deepEqual([s.paidPct, s.daysLeft, s.latestPhotoId], [30, 10, p2.id]);
  await C.updateBuild(db, b.id, { ownerEmail: "" }, "o");
  assert.equal((await db.get("builds", b.id))!.owner_email, "");
});

await test("รอบสอง: แปลงให้เช่าจองไม่ได้ / ไฟล์โฆษณาวันที่แบบ เดือน/วัน/ปี / back() เก็บ # ไว้ท้าย", async () => {
  await S.createPlotsBulk(db, { zone: "R", count: 1 });
  await S.updatePlot(db, "R01", { saleStatus: "rent" });
  const l = await S.createLead(db, { name: "อยากซื้อแปลงเช่า", plotCode: "R01" }, "s");
  await rejects(S.moveLead(db, l.id, "booked", "s"), /ให้เช่า/);
  const { parseAdsCsv } = await import("../src/lib/marketing");
  const us = parseAdsCsv("Day,Cost\n11/13/2026,100\n11/2/2026,50\n", "google");
  assert.deepEqual(us.rows.map((r) => r.day), ["2026-11-13", "2026-11-02"]);
  const th = parseAdsCsv("วัน,ค่าใช้จ่าย\n13/11/2026,100\n02/11/2026,50\n", "google");
  assert.deepEqual(th.rows.map((r) => r.day), ["2026-11-13", "2026-11-02"]);
});

await test("โฟร์แมนในปฏิทิน: เห็นงานก่อสร้างและนัดทั่วไป ไม่เห็นลูกค้า / หลังหยุดชั่วคราวยังคิดเงิน", async () => {
  const Cal = await import("../src/lib/calendar");
  const l = await S.createLead(db, { name: "ลูกค้าลับ", nextFollowAt: "2026-12-05" }, "s");
  await Cal.addEvent(db, { title: "นัดลูกค้า", date: "2026-12-06", leadId: l.id }, "s");
  await Cal.addEvent(db, { title: "ประชุมผู้รับเหมา", date: "2026-12-07" }, "o");
  const b = await C.createBuild(db, { title: "บ้านปฏิทิน", customerName: "คุณลับ", startDate: "2026-11-01", dueDate: "2026-12-20" }, "o");
  const items = await Cal.monthItems(db, "2026-12", { construction: true, foreman: true });
  const text = JSON.stringify(items);
  assert.ok(text.includes("ประชุมผู้รับเหมา") && text.includes("บ้านปฏิทิน"));
  assert.ok(!text.includes("ลูกค้าลับ") && !text.includes("นัดลูกค้า") && !text.includes("คุณลับ"));
  await C.updateBuild(db, b.id, { status: "paused" }, "o");
  assert.equal(C.billableInMonth([await db.get("builds", b.id) as never], "2026-12"), 1);
});
