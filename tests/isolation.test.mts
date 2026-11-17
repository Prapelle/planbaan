// ข้อมูลของโครงการหนึ่งต้องไม่รั่วไปอีกโครงการ — เทสต์นี้คือเงื่อนไขผ่านระยะ 0
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { tenantDb, TENANT_TABLES } from "../src/lib/tenant-db";
import { createProject } from "../src/lib/control";

const db = makeD1();
const pA = await createProject(db as never, { slug: "suanson", name: "สวนสน", ownerEmail: "a@x.com" });
const pB = await createProject(db as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const A = tenantDb(db as never, pA.id);
const B = tenantDb(db as never, pB.id);

const a1 = await A.insert("plots", { code: "A01", zone: "A", price: 2390000 });
const b1 = await B.insert("plots", { code: "A01", zone: "A", price: 3190000 }); // รหัสแปลงซ้ำกันข้ามโครงการได้
const aL = await A.insert("leads", { name: "คุณวิชัย", phone: "0800000001", channel: "facebook" });
const bL = await B.insert("leads", { name: "คุณนภา", phone: "0800000002", channel: "google" });
await A.insert("lead_activity", { lead_id: aL.id, kind: "created" });
await B.insert("lead_activity", { lead_id: bL.id, kind: "created" });
await A.insert("loan_apps", { lead_id: aL.id, bank: "ออมสิน" });
await A.insert("marketing_spend", { day: "2026-11-01", month: "2026-11", channel: "facebook", amount: 1 });
await B.insert("marketing_spend", { day: "2026-11-01", month: "2026-11", channel: "facebook", amount: 2 });
await A.insert("marketing_budget", { month: "2026-11", channel: "facebook", amount: 1 });
await B.insert("marketing_budget", { month: "2026-11", channel: "facebook", amount: 2 });
await B.insert("loan_apps", { lead_id: bL.id, bank: "ออมสิน" });

for (const t of Object.keys(TENANT_TABLES) as (keyof typeof TENANT_TABLES)[]) {
  await test(`list(${t}) เห็นเฉพาะข้อมูลโครงการตัวเอง`, async () => {
    for (const [dbx, pid] of [[A, pA.id], [B, pB.id]] as const) {
      const rows = await dbx.list(t);
      assert.ok(rows.length > 0);
      assert.ok(rows.every((r) => r.project_id === pid));
    }
  });
}

await test("get ข้ามโครงการได้ null", async () => {
  assert.equal(await B.get("plots", a1.id), null);
  assert.equal(await A.get("leads", (await B.list("leads"))[0].id), null);
  assert.equal((await A.get("plots", a1.id))?.price, 2390000);
});

await test("update ข้ามโครงการไม่มีผล", async () => {
  assert.equal(await B.update("plots", a1.id, { price: 1 }), false);
  assert.equal((await A.get("plots", a1.id))?.price, 2390000);
  assert.equal(await A.update("plots", a1.id, { price: 2490000 }), true);
});

await test("remove ข้ามโครงการไม่มีผล", async () => {
  assert.equal(await B.remove("leads", aL.id), false);
  assert.ok(await A.get("leads", aL.id));
});

await test("list ด้วยเงื่อนไขยังกรองตามโครงการ", async () => {
  const rows = await A.list("plots", { where: { code: "A01" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, a1.id);
  assert.equal(await B.count("plots", { code: "A01" }), 1);
});

await test("insert/update ตั้ง project_id หรือ id เองไม่ได้", async () => {
  await rejects(A.insert("plots", { code: "X1", project_id: pB.id }), /project_id/);
  await rejects(A.update("plots", a1.id, { project_id: pB.id }), /project_id/);
  await rejects(A.insert("plots", { code: "X2", id: "fixed" }), /คอลัมน์ id/);
  assert.equal(await B.count("plots"), 1);
});

await test("ตารางระบบและคอลัมน์แปลกปลอมถูกปฏิเสธ", async () => {
  await rejects(A.list("memberships" as never), /ไม่รู้จักตาราง/);
  await rejects(A.list("plots", { where: { "1=1 OR project_id": "x" } as never }), /คอลัมน์/);
  await rejects(A.list("plots", { orderBy: "price; DROP TABLE plots" }), /เรียงตาม/);
  await rejects(A.insert("plots", { 'code") VALUES (1);--': "x" } as never), /คอลัมน์/);
});

await test("ค่าที่มีอักขระพิเศษถูกเก็บเป็นข้อความ ไม่ใช่คำสั่ง", async () => {
  const evil = "x' OR '1'='1";
  await A.insert("leads", { name: evil });
  assert.equal(await A.count("leads", { name: evil }), 1);
  assert.equal(await B.count("leads", { name: evil }), 0);
});

await test("exportAll ส่งออกเฉพาะโครงการตัวเอง", async () => {
  const ex = await B.exportAll();
  assert.equal(ex.plots.length, 1);
  assert.equal(ex.plots[0].id, b1.id);
  assert.ok(ex.leads.every((r) => r.project_id === pB.id));
});

await test("ต้องระบุโครงการ", async () => {
  assert.throws(() => tenantDb(db as never, ""), /projectId/);
});

console.log("isolation: ผ่าน");
