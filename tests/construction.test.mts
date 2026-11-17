// ระยะ 3: ส่วนก่อสร้าง
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject, createShareLink, resolveShareLink, revokeShareLinks, activeShareLink, setConstruction, getProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as C from "../src/lib/construction";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com", kind: "builder" });
const db = tenantDb(raw as never, p.id);
const other = tenantDb(raw as never, q.id);
await S.createPlotsBulk(db, { zone: "A", count: 3 });
const today = S.bkkDate();
const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const plot = async (c: string) => (await S.getPlotByCode(db, c))?.house_status;

let build: Record<string, unknown>;
await test("สร้างงานจากแปลง: งวดมาตรฐาน 5 งวด กระจายกำหนดเสร็จถึงวันส่งมอบ ห้ามซ้ำแปลงเดิม", async () => {
  build = await C.createBuild(db, { plotCode: "a01", startDate: plus(-100), dueDate: plus(50), price: "2,500,000" }, "o@x.com");
  assert.equal(build.title, "แปลง A01");
  const st = await C.stagesOf(db, String(build.id));
  assert.deepEqual(st.map((s) => s.name), C.DEFAULT_STAGES);
  assert.equal(st[4].planned_end, plus(50));
  await rejects(C.createBuild(db, { plotCode: "A01", startDate: plus(0), dueDate: plus(10) }, "o@x.com"), /ยังไม่เสร็จ/);
  await rejects(C.createBuild(db, { plotCode: "Z9", startDate: plus(0), dueDate: plus(10) }, "o@x.com"), /ไม่พบแปลง/);
  await rejects(C.createBuild(db, { title: "x", startDate: plus(10), dueDate: plus(0) }, "o@x.com"), /หลังวันเริ่ม/);
});

await test("ติ๊กงวดตามลำดับ → สถานะบ้านในผังเปลี่ยนเอง / ยกเลิกได้เฉพาะงวดล่าสุด", async () => {
  const st = await C.stagesOf(db, String(build.id));
  await rejects(C.setStageDone(db, String(st[1].id), true, "f@x.com"), /ก่อนหน้า/);
  assert.equal(await plot("A01"), "not_started");
  await C.setStageDone(db, String(st[0].id), true, "f@x.com", "เทคานแล้ว");
  assert.equal(await plot("A01"), "building");
  await C.setStageDone(db, String(st[1].id), true, "f@x.com");
  await rejects(C.setStageDone(db, String(st[0].id), false, "f@x.com"), /หลังสุด/);
  await C.setStageDone(db, String(st[1].id), false, "f@x.com");
  assert.equal((await C.stagesOf(db, String(build.id)))[1].done_at, "");
});

await test("สรุป: % ความคืบหน้า ช้ากว่าแผน ไม่อัปเดตเกินกำหนด งวดเงินรอเก็บ", async () => {
  const st = await C.stagesOf(db, String(build.id));
  await C.updateStage(db, String(st[0].id), { payAmount: "500,000" }, "o@x.com");
  await C.updateStage(db, String(st[1].id), { plannedEnd: plus(-3) }, "o@x.com");
  const board = await C.buildBoard(db, 7);
  const s = board.all[0];
  assert.deepEqual([s.pct, s.doneCount, s.current?.name, s.lateDays], [20, 1, "โครงสร้าง", 3]);
  assert.deepEqual([s.payDue, s.payDueCount], [500000, 1]);
  assert.equal(s.stale, false);
  const later = C.summarize(s.build, s.stages, [], { staleDays: 7, now: new Date(Date.now() + 9 * 86400_000) });
  assert.equal(later.stale, true);
  await C.setPaid(db, String(st[0].id), true, "o@x.com");
  assert.equal((await C.buildBoard(db, 7)).all[0].payDue, 0);
});

await test("เบิกกู้ปลูกสร้างได้เมื่องวดเสร็จแล้ว", async () => {
  const st = await C.stagesOf(db, String(build.id));
  await rejects(C.setDraw(db, String(st[2].id), "requested", "o@x.com"), /เสร็จแล้ว/);
  await C.updateStage(db, String(st[0].id), { drawAmount: "400000" }, "o@x.com");
  await C.setDraw(db, String(st[0].id), "requested", "o@x.com");
  assert.equal((await C.buildBoard(db, 7)).all[0].drawPending, 1);
  await C.setDraw(db, String(st[0].id), "released", "o@x.com");
  assert.equal((await C.buildBoard(db, 7)).all[0].drawPending, 0);
  await rejects(C.setDraw(db, String(st[0].id), "paid", "o@x.com"), /ไม่ถูกต้อง/);
});

await test("งานเพิ่ม-ลด: ลูกค้ายืนยันผ่านลิงก์ต้องพิมพ์ชื่อ / พนักงานบันทึกแทนต้องมีหมายเหตุ / ตัดสินใจซ้ำไม่ได้", async () => {
  const add = await C.addChange(db, String(build.id), { title: "เพิ่มกันสาดหน้าบ้าน", amount: "35,000" }, "o@x.com");
  const cut = await C.addChange(db, String(build.id), { title: "ไม่เอาตู้ครัว", amount: "-20000" }, "o@x.com");
  await rejects(C.addChange(db, String(build.id), { title: "x", amount: "0" }, "o@x.com"), /ราคา/);
  await rejects(C.decideChange(db, String(add.id), "confirmed", "owner_link:"), /ชื่อ/);
  await C.decideChange(db, String(add.id), "confirmed", "owner_link:สมชาย ใจดี");
  await rejects(C.decideChange(db, String(add.id), "rejected", "owner_link:สมชาย"), /ตัดสินใจไปแล้ว/);
  await rejects(C.decideChange(db, String(cut.id), "confirmed", "o@x.com"), /หมายเหตุ/);
  await C.decideChange(db, String(cut.id), "confirmed", "o@x.com", "ลูกค้ายืนยันทาง LINE 17 พ.ย.");
  const c = await db.get("build_changes", String(add.id));
  assert.deepEqual([c?.status, c?.decided_by], ["confirmed", "owner_link:สมชาย ใจดี"]);
  assert.equal((await C.buildBoard(db, 7)).all[0].changesConfirmed, 15000);
});

await test("ส่งมอบ: ต้องครบทุกงวด → ผังเป็นพร้อมโอน และนับเงินเฉพาะเดือนที่ยังสร้าง", async () => {
  await rejects(C.finishBuild(db, String(build.id), "o@x.com"), /ทุกงวด/);
  for (const s of await C.stagesOf(db, String(build.id))) await C.setStageDone(db, String(s.id), true, "f@x.com");
  assert.equal(await plot("A01"), "ready");
  await C.finishBuild(db, String(build.id), "o@x.com");
  const b = await db.get("builds", String(build.id));
  assert.equal(b?.status, "done");
  await rejects(C.addChange(db, String(build.id), { title: "x", amount: "1" }, "o@x.com"), /ส่งมอบแล้ว/);
  const thisMonth = today.slice(0, 7);
  assert.equal(C.billableInMonth([b!], thisMonth), 1);
  assert.equal(C.billableInMonth([b!], "2099-01"), 0);
  assert.equal(C.billableInMonth([{ id: "x", start_date: "2099-02-01", done_at: "" }], thisMonth), 0);
});

await test("ลิงก์เจ้าของบ้าน: เก็บเฉพาะ hash ออกใหม่แล้วลิงก์เก่าใช้ไม่ได้ ยกเลิกได้", async () => {
  const t1 = await createShareLink(raw as never, p.id, String(build.id), "o@x.com");
  assert.match(t1, /^[A-Za-z0-9_-]{43}$/);
  const stored = raw.raw.prepare("SELECT token_hash FROM share_links").all().map((r: { token_hash: string }) => r.token_hash);
  assert.ok(!stored.includes(t1));
  assert.equal((await resolveShareLink(raw as never, t1))?.buildId, build.id);
  const t2 = await createShareLink(raw as never, p.id, String(build.id), "o@x.com");
  assert.equal(await resolveShareLink(raw as never, t1), null);
  assert.equal((await resolveShareLink(raw as never, t2))?.project.slug, "suanson");
  assert.ok(await activeShareLink(raw as never, p.id, String(build.id)));
  await revokeShareLinks(raw as never, p.id, String(build.id));
  assert.equal(await resolveShareLink(raw as never, t2), null);
  assert.equal(await resolveShareLink(raw as never, "../../etc"), null);
});

await test("รูปหน้างาน: key ต้องอยู่ใต้โฟลเดอร์ของงานนั้นในโครงการตัวเอง เผยแพร่/ซ่อน ลบ", async () => {
  await rejects(C.addPhoto(db, String(build.id), { key: `files/${q.id}/build/${build.id}/x.jpg` }, "f@x.com"), /ไฟล์/);
  const ph = await C.addPhoto(db, String(build.id), { key: `${C.photoPrefix(p.id, String(build.id))}a.jpg`, caption: "เทพื้น" }, "f@x.com");
  assert.equal(ph.published, 0);
  await C.setPhotoPublished(db, String(ph.id), true);
  assert.equal((await db.get("build_photos", String(ph.id)))?.published, 1);
  assert.match(await C.removePhoto(db, String(ph.id)), /a\.jpg$/);
});

await test("รับสร้างบ้าน: สร้างจากลูกค้า ชื่องานตั้งเอง ไม่ต้องมีแปลง และแยกจากโครงการอื่น", async () => {
  const lead = await S.createLead(other, { name: "คุณมานี" }, "b@x.com");
  await S.moveLead(other, lead.id, "booked", "b@x.com", { requirePlot: false });
  const b = await C.createBuild(other, { leadId: lead.id, startDate: plus(0), dueDate: plus(150) }, "b@x.com");
  assert.equal(b.title, "บ้านคุณมานี");
  await rejects(C.createBuild(other, { leadId: lead.id, startDate: plus(0), dueDate: plus(150) }, "b@x.com"), /ยังไม่เสร็จ/);
  await rejects(C.getBuild(db, String(b.id)), /ไม่พบ/);
  assert.equal((await C.buildBoard(db, 7)).all.length, 1);
  assert.equal(S.stageLabels("builder").booked, "เซ็นสัญญา");
  await rejects(S.moveLead(other, (await S.createLead(other, { name: "x" }, "b")).id, "booked", "b"), /เลือกแปลง/);
});

await test("ทีมงานเปิด/ปิดส่วนก่อสร้างและตั้งวันเตือน", async () => {
  await setConstruction(raw as never, p.id, { enabled: true, staleDays: 5 });
  const pr = await getProject(raw as never, p.id);
  assert.deepEqual([pr?.construction_enabled, pr?.build_stale_days], [1, 5]);
  await rejects(setConstruction(raw as never, p.id, { staleDays: 0 }), /1–60/);
});
