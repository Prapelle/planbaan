// ระยะ 2: ย้ายประวัติเก่า, รูปผัง, back office
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { makeD1, makeR2, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject, getProject, setPlanImage, listStaff, upsertStaff, removeStaff } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import { runArchive, listArchives } from "../src/lib/archive";
import { placePlot, unplacePlot, sniffImage, planKey } from "../src/lib/planmap";
import { logUsage, projectUsage, featureAdoption } from "../src/lib/usage";
import * as S from "../src/lib/sales";

const raw = makeD1();
const r2 = makeR2();
const env = { DB: raw, BACKUPS: r2 } as never;
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(raw as never, p.id);
const other = tenantDb(raw as never, q.id);

await test("ย้ายประวัติเก่ากว่า 1 ปีไป R2 แยกไฟล์ต่อโครงการ แล้วลบจากฐานข้อมูล", async () => {
  const lead = await S.createLead(db, { name: "ก" }, "s@x.com");
  await S.logContact(db, lead.id, "โทรแล้ว", "s@x.com");
  await S.createLead(other, { name: "ข" }, "s@x.com");
  // ทำให้ประวัติของโครงการแรกเก่า 400 วัน
  const old = new Date(Date.now() - 400 * 86400_000).toISOString();
  raw.raw.prepare(`UPDATE lead_activity SET created_at = ? WHERE project_id = ?`).run(old, p.id);
  const out = await runArchive(env, { days: 365 });
  assert.deepEqual(out, { suanson: 2 });
  assert.equal((await db.list("lead_activity")).length, 0);
  assert.equal((await other.list("lead_activity")).length, 1); // โครงการอื่นไม่ถูกแตะ
  const files = await listArchives(r2 as never, p.id);
  assert.equal(files.length, 1);
  assert.match(files[0].name, /^lead_activity-\d{4}-\d{2}-\d{2}-01\.ndjson\.gz$/);
  const lines = gunzipSync(r2.store.get(files[0].key)).toString().trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.project_id === p.id));
  assert.equal((await listArchives(r2 as never, q.id)).length, 0);
});

await test("ตั้งวันย้ายต่ำเกินไปไม่ได้ (อย่างน้อย 90 วัน)", async () => {
  await S.createLead(db, { name: "ใหม่" }, "s@x.com");
  assert.deepEqual(await runArchive(env, { days: 1 }), {});
});

await test("วางจุดแปลงบนรูป ตรวจค่า และเอาออกได้", async () => {
  await S.createPlotsBulk(db, { zone: "A", count: 2 });
  await placePlot(db, "a01", "12.345", 80);
  let plot = await S.getPlotByCode(db, "A01");
  assert.deepEqual([plot?.map_x, plot?.map_y], [12.35, 80]);
  await rejects(placePlot(db, "A01", 120, 5), /ตำแหน่ง/);
  await rejects(placePlot(db, "Z99", 1, 1), /ไม่พบแปลง/);
  await rejects(placePlot(other, "A01", 1, 1), /ไม่พบแปลง/); // แปลงของโครงการอื่น
  await unplacePlot(db, "A01");
  plot = await S.getPlotByCode(db, "A01");
  assert.equal(plot?.map_x, null);
});

await test("วางจุดแปลงใหม่บนรูป: สร้างแปลงพร้อมตำแหน่ง โซนจากตัวอักษรนำ ตรวจรูปแบบเลข", async () => {
  assert.equal(await placePlot(db, "c07", 10, 20, { create: true }), true);
  const pl = await S.getPlotByCode(db, "C07");
  assert.deepEqual([pl?.zone, pl?.map_x, pl?.map_y, pl?.sale_status], ["C", 10, 20, "available"]);
  assert.equal(await placePlot(db, "C07", 30, 40, { create: true }), false); // มีแล้ว = ย้ายจุด ไม่สร้างซ้ำ
  assert.equal((await db.list("plots", { where: { code: "C07" } })).length, 1);
  await rejects(placePlot(db, "Z99", 1, 1), /ไม่พบแปลง/); // ไม่ได้ขอสร้าง
  await rejects(placePlot(db, "แปลง 1", 1, 1, { create: true }), /เลขแปลง/);
  await rejects(placePlot(db, "", 1, 1, { create: true }), /เลือกหรือพิมพ์/);
});

await test("ตรวจชนิดรูปจากเนื้อไฟล์ และ key ต้องอยู่ใต้โครงการตัวเอง", async () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]))?.ext, "png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext, "jpg");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  const key = planKey(p.id, "png");
  await setPlanImage(raw as never, p.id, key);
  assert.equal((await getProject(raw as never, p.id))?.plan_image, key);
  await rejects(setPlanImage(raw as never, p.id, planKey(q.id, "png")), /key/);
});

await test("back office: การใช้งานรายโครงการ และฟีเจอร์ที่ถูกใช้ (ไม่มีเนื้อหาลูกค้า)", async () => {
  for (const page of ["home", "marketing", "marketing"]) await logUsage(raw as never, { projectId: p.id, event: "page_view", email: "o@x.com", salt: "s", meta: { page } });
  await logUsage(raw as never, { projectId: q.id, event: "page_view", email: "b@x.com", salt: "s", meta: { page: "marketing" } });
  const u = await projectUsage(raw as never, p.id);
  assert.equal(u.users, 1);
  assert.deepEqual(u.byPage.map((x) => [x.page, x.n]), [["marketing", 2], ["home", 1]]);
  assert.equal(u.daily.length, 1);
  const a = await featureAdoption(raw as never);
  assert.deepEqual(a.find((x) => x.page === "marketing"), { page: "marketing", projects: 2, views: 3 });
});

await test("ทีม PlanBaan: เพิ่ม เปลี่ยนบทบาท ลบ (ลบตัวเองไม่ได้)", async () => {
  await upsertStaff(raw as never, "Staff@X.com", "support");
  await upsertStaff(raw as never, "staff@x.com", "admin");
  assert.deepEqual((await listStaff(raw as never)).map((s) => [s.email, s.role]), [["staff@x.com", "admin"]]);
  await rejects(removeStaff(raw as never, "staff@x.com", "staff@x.com"), /ตัวเอง/);
  await removeStaff(raw as never, "staff@x.com", "boss@x.com");
  assert.equal((await listStaff(raw as never)).length, 0);
  await rejects(upsertStaff(raw as never, "bad", "admin"), /อีเมล/);
});
