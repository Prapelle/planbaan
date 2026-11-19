// ระยะ 1: ผังแปลง ลูกค้า การเลื่อนขั้น สถานะแปลงตามลูกค้า และภาพรวม
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb, rowCountsByProject } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";

const raw = makeD1();
const db0 = raw as never;
const p = await createProject(db0, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(db0, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(db0, p.id);
const other = tenantDb(db0, q.id);
const plot = (code: string) => S.getPlotByCode(db, code);

await test("สร้างแปลงทีละโซน ข้ามรหัสที่มีอยู่", async () => {
  assert.deepEqual(await S.createPlotsBulk(db, { zone: "a", count: 12, houseType: "ชั้นเดียว", price: 2390000 }), { created: 12, skipped: 0 });
  assert.deepEqual(await S.createPlotsBulk(db, { zone: "A", count: 3, start: 11 }), { created: 1, skipped: 2 });
  const codes = (await db.list("plots", { limit: 100 })).sort(S.byCode).map((r) => r.code);
  assert.equal(codes[0], "A01");
  assert.equal(codes.at(-1), "A13");
  await rejects(S.createPlotsBulk(db, { zone: "A B", count: 1 }), /โซน/);
  await rejects(S.createPlotsBulk(db, { zone: "B", count: 0 }), /จำนวน/);
  await S.createPlotsBulk(db, { zone: "B", count: 120 });
  assert.equal((await plot("B120"))?.zone, "B");
});

await test("เพิ่มลูกค้า: ต้องมีชื่อ ช่องทางถูกต้อง แปลงต้องมีจริง", async () => {
  await rejects(S.createLead(db, { name: " " }, "s@x.com"), /ชื่อ/);
  await rejects(S.createLead(db, { name: "x", channel: "myspace" }, "s@x.com"), /ช่องทาง/);
  await rejects(S.createLead(db, { name: "x", plotCode: "Z99" }, "s@x.com"), /ไม่พบแปลง/);
  const l = await S.createLead(db, { name: "คุณวิชัย", phone: "081-234-5678", channel: "facebook" }, "S@x.com");
  assert.equal(l.phone, "0812345678");
  assert.equal(l.owner_email, "s@x.com");
  assert.equal((await S.leadHistory(db, l.id))[0].kind, "created");
});

let a: { id: string }, b: { id: string };
await test("จองต้องมีแปลง และแปลงเปลี่ยนสีตามขั้นของลูกค้า", async () => {
  a = await S.createLead(db, { name: "คุณสุดา", channel: "google" }, "s@x.com");
  await S.moveLead(db, a.id, "visited", "s@x.com");
  await rejects(S.moveLead(db, a.id, "booked", "s@x.com"), /เลือกแปลง/);
  await S.updateLead(db, a.id, { plotCode: "a02" }, "s@x.com");
  await S.moveLead(db, a.id, "booked", "s@x.com");
  assert.equal((await plot("A02"))?.sale_status, "booked");
  await S.moveLead(db, a.id, "loan", "s@x.com");
  assert.equal((await plot("A02"))?.sale_status, "loan");
  const h = await S.leadHistory(db, a.id);
  assert.ok(h.some((x) => x.kind === "stage" && x.from_stage === "booked" && x.to_stage === "loan"));
});

await test("แปลงที่มีคนจองแล้ว คนอื่นจองซ้ำไม่ได้", async () => {
  b = await S.createLead(db, { name: "คุณกมล", channel: "walkin", plotCode: "A02" }, "s@x.com"); // ผูกแปลงตอนยังไม่จองได้
  await rejects(S.moveLead(db, b.id, "booked", "s@x.com"), /มีลูกค้าจองแล้ว/);
  await rejects(S.createLead(db, { name: "คุณเอ", plotCode: "A02", stage: "booked" }, "s@x.com"), /มีลูกค้าจองแล้ว/);
});

await test("ลูกค้าถอยขั้นหรือไม่ซื้อ แปลงกลับเป็นว่าง", async () => {
  await S.moveLead(db, a.id, "lost", "s@x.com", { lostReason: "price" });
  assert.equal((await plot("A02"))?.sale_status, "available");
  await S.moveLead(db, b.id, "booked", "s@x.com");
  assert.equal((await plot("A02"))?.sale_status, "booked");
});

await test("ย้ายแปลงของลูกค้า: แปลงเก่าว่าง แปลงใหม่จอง", async () => {
  await S.updateLead(db, b.id, { plotCode: "A03" }, "s@x.com");
  assert.equal((await plot("A02"))?.sale_status, "available");
  assert.equal((await plot("A03"))?.sale_status, "booked");
});

await test("ตั้งสถานะแปลงเอง: ได้แค่ ว่าง/ให้เช่า และห้ามทับแปลงที่มีคนจอง", async () => {
  await S.updatePlot(db, "A05", { saleStatus: "rent", price: 2490000, houseStatus: "ready" });
  assert.equal((await plot("A05"))?.sale_status, "rent");
  await rejects(S.updatePlot(db, "A05", { saleStatus: "booked" }), /หน้าลูกค้า/);
  await rejects(S.updatePlot(db, "A03", { saleStatus: "available" }), /มีลูกค้าจองอยู่/);
  await rejects(S.updatePlot(db, "A05", { houseStatus: "flying" }), /สถานะบ้าน/);
});

await test("ลบแปลงที่มีลูกค้าผูกไม่ได้", async () => {
  await rejects(S.deletePlot(db, "A03"), /ลบไม่ได้/);
  await S.deletePlot(db, "A13");
  assert.equal(await plot("A13"), null);
});

await test("บันทึกการติดต่อ อัปเดตวันติดต่อล่าสุดและนัดครั้งถัดไป", async () => {
  await rejects(S.logContact(db, b.id, "", "s@x.com"), /บันทึก/);
  await S.logContact(db, b.id, "โทรแล้ว ลูกค้าขอเอกสารสินเชื่อ", "s@x.com", S.bkkDate(new Date(Date.now() + 2 * 86400_000)));
  const l = await db.get("leads", b.id);
  assert.equal(l?.next_follow_at, S.bkkDate(new Date(Date.now() + 2 * 86400_000)));
  assert.equal((await S.leadHistory(db, b.id))[0].note, "โทรแล้ว ลูกค้าขอเอกสารสินเชื่อ");
});

await test("ค้างติดตามเกิน 3 วัน และภาพรวม", async () => {
  const later = new Date(Date.now() + 5 * 86400_000);
  const o = await S.overview(db, later);
  assert.equal(o.totalLeads, 3);
  assert.equal(o.reachedBooked, 1);
  assert.equal(o.byStage.lost, 1);
  assert.equal(o.stale.length, 2); // ไม่นับคนที่ไม่ซื้อ
  assert.equal(o.plotStatus.booked, 1);
  assert.equal(o.plotStatus.rent, 1);
  assert.equal(o.followToday.length, 1);
  assert.deepEqual(o.byChannel.find((c) => c.channel === "walkin"), { channel: "walkin", leads: 1, visited: 1, booked: 1 });
  const nowO = await S.overview(db);
  assert.equal(nowO.stale.length, 0);
  assert.equal(nowO.followToday.length, 0); // นัดอีก 2 วัน ยังไม่ถึง
});

await test("ข้อมูลของอีกโครงการไม่ถูกแตะ", async () => {
  assert.equal(await other.count("plots"), 0);
  await rejects(S.moveLead(other, b.id, "loan", "x@x.com"), /ไม่พบลูกค้า/);
  await rejects(S.updatePlot(other, "A03", { price: 1 }), /ไม่พบแปลง/);
  const counts = await rowCountsByProject(db0);
  assert.ok(counts[p.id] > 100);
  assert.equal(counts[q.id], undefined);
});

await test("ขั้นถัดไป/ก่อนหน้า", async () => {
  assert.equal(S.neighborStage("new", 1), "contacted");
  assert.equal(S.neighborStage("new", -1), null);
  assert.equal(S.neighborStage("transferred", 1), null);
  assert.equal(S.neighborStage("lost", -1), "new");
});

await test("คุยกับฐานข้อมูลไม่กี่รอบ (กันช้าเมื่อฐานข้อมูลอยู่ไกล)", async () => {
  const c = (raw as unknown as { calls: { n: number } }).calls;
  const rounds = async (fn: () => Promise<unknown>) => { const s0 = c.n; await fn(); return c.n - s0; };
  assert.ok(await rounds(() => S.createPlotsBulk(db, { zone: "C", count: 40 })) <= 2, "เพิ่ม 40 แปลง");
  const l = await S.createLead(db, { name: "คุณรอบ", plotCode: "C01" }, "s@x.com");
  assert.ok(await rounds(() => S.createLead(db, { name: "คุณรอบสอง", plotCode: "C02" }, "s@x.com")) <= 3, "เพิ่มลูกค้า");
  assert.ok(await rounds(() => S.moveLead(db, l.id, "contacted", "s@x.com")) <= 4, "เลื่อนขั้น");
  assert.ok(await rounds(() => S.updateLead(db, l.id, { plotCode: "C03" }, "s@x.com")) <= 6, "ย้ายแปลง");
  assert.ok(await rounds(() => S.logContact(db, l.id, "โทรแล้ว", "s@x.com")) <= 2, "บันทึกการติดต่อ");
});

await test("เขียนเป็นชุดยังผูกโครงการ และอ้าง id ข้ามโครงการไม่ได้", async () => {
  const [r] = await other.batch([{ kind: "insert", table: "plots", data: { code: "Z1" } }]);
  assert.equal(r.project_id, q.id);
  await other.batch([{ kind: "update", table: "leads", id: b.id, patch: { name: "แฮ็ก" } }]);
  assert.notEqual((await db.get("leads", b.id))?.name, "แฮ็ก");
  await rejects(other.batch([{ kind: "insert", table: "plots", data: { code: "Z2", project_id: p.id } }]), /project_id/);
});

console.log("sales: ผ่าน");
