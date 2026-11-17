// สิทธิ์เข้าโครงการ: สมาชิก / ทีม PlanBaan เมื่อลูกค้าเปิดสิทธิ์ / คนอื่นเข้าไม่ได้
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import * as C from "../src/lib/control";
import { resolveAccess } from "../src/lib/access";
import { canEditData, canGrantSupport, canManageMembers } from "../src/lib/roles";

const db = makeD1() as never as Parameters<typeof C.createProject>[0];
const p = await C.createProject(db, { slug: "suanson", name: "สวนสน", ownerEmail: "Owner@X.com" });
const other = await C.createProject(db, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
await (db as never as { prepare(s: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } })
  .prepare(`INSERT INTO platform_staff (email, role, created_at) VALUES (?, 'support', ?)`).bind("staff@planbaan.app", new Date().toISOString()).run();
const rows = (sql: string, ...v: unknown[]) => (db as never as { raw: { prepare(s: string): { all(...v: unknown[]): unknown[] } } }).raw.prepare(sql).all(...v) as Record<string, unknown>[];

await test("สร้างโครงการแล้วเจ้าของเป็น owner (อีเมลตัวเล็ก)", async () => {
  assert.equal(await C.getMembership(db, p.id, "owner@x.com"), "owner");
  const a = await resolveAccess(db, p, "OWNER@x.com");
  assert.deepEqual(a.ok && [a.role, a.via], ["owner", "member"]);
});

await test("slug ซ้ำ / ผิดรูป / คำสงวน ถูกปฏิเสธ", async () => {
  await rejects(C.createProject(db, { slug: "suanson", name: "x", ownerEmail: "a@x.com" }), /มีโครงการ/);
  await rejects(C.createProject(db, { slug: "Bad Slug", name: "x", ownerEmail: "a@x.com" }), /slug/);
  await rejects(C.createProject(db, { slug: "admin", name: "x", ownerEmail: "a@x.com" }), /slug/);
});

await test("ยังไม่ล็อกอิน / ไม่ใช่สมาชิก เข้าไม่ได้", async () => {
  assert.deepEqual(await resolveAccess(db, p, null), { ok: false, reason: "not_signed_in" });
  assert.deepEqual(await resolveAccess(db, p, "b@x.com"), { ok: false, reason: "no_access" });
});

await test("ทีม PlanBaan เข้าไม่ได้ถ้าลูกค้ายังไม่เปิดสิทธิ์ และไม่มีบันทึกการเข้าถึง", async () => {
  assert.deepEqual(await resolveAccess(db, p, "staff@planbaan.app"), { ok: false, reason: "no_access" });
  assert.deepEqual(await resolveAccess(db, p, "boss@planbaan.app", { initialAdmin: "boss@planbaan.app" }), { ok: false, reason: "no_access" });
  assert.equal(rows(`SELECT * FROM access_log`).length, 0);
});

await test("ลูกค้าเปิดสิทธิ์ → ทีมเข้าได้แบบ support และถูกบันทึกทุกครั้ง", async () => {
  await rejects(C.createSupportGrant(db, { projectId: p.id, grantedBy: "owner@x.com", hours: 5, canEdit: false, reason: "" }), /24, 48/);
  const g = await C.createSupportGrant(db, { projectId: p.id, grantedBy: "owner@x.com", hours: 24, canEdit: false, reason: "นำเข้าข้อมูลแปลง" });
  const a = await resolveAccess(db, p, "staff@planbaan.app", { action: "view", target: "/plots" });
  assert.ok(a.ok && a.role === "support" && a.via === "support" && !a.supportCanEdit && a.grantExpiresAt === g.expires_at);
  assert.equal(canEditData("support", false), false);
  const log = rows(`SELECT * FROM access_log WHERE project_id = ?`, p.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].actor, "staff@planbaan.app");
  assert.equal(log[0].target, "/plots");
});

await test("สิทธิ์ของโครงการหนึ่งใช้กับอีกโครงการไม่ได้", async () => {
  assert.deepEqual(await resolveAccess(db, other, "staff@planbaan.app"), { ok: false, reason: "no_access" });
});

await test("สิทธิ์หมดอายุแล้วเข้าไม่ได้", async () => {
  const later = new Date(Date.now() + 25 * 3600_000);
  assert.deepEqual(await resolveAccess(db, p, "staff@planbaan.app", { now: later }), { ok: false, reason: "no_access" });
});

await test("ลูกค้ายกเลิกสิทธิ์ได้ทันที", async () => {
  await C.revokeSupportGrants(db, p.id);
  assert.deepEqual(await resolveAccess(db, p, "staff@planbaan.app"), { ok: false, reason: "no_access" });
});

await test("สิทธิ์แบบแก้ไขได้", async () => {
  await C.createSupportGrant(db, { projectId: p.id, grantedBy: "owner@x.com", hours: 48, canEdit: true, reason: "" });
  const a = await resolveAccess(db, p, "staff@planbaan.app");
  assert.ok(a.ok && a.supportCanEdit);
  assert.equal(canEditData("support", true), true);
  await C.revokeSupportGrants(db, p.id);
});

await test("จัดการสมาชิก และห้ามลบหรือลดสิทธิ์เจ้าของคนสุดท้าย", async () => {
  await C.upsertMember(db, p.id, "Sale@X.com", "sales");
  assert.equal(await C.getMembership(db, p.id, "sale@x.com"), "sales");
  await rejects(C.upsertMember(db, p.id, "x@x.com", "god"), /บทบาท/);
  await rejects(C.upsertMember(db, p.id, "owner@x.com", "viewer"), /เจ้าของอย่างน้อย/);
  await rejects(C.removeMember(db, p.id, "owner@x.com"), /เจ้าของคนสุดท้าย/);
  await C.removeMember(db, p.id, "sale@x.com");
  assert.equal(await C.getMembership(db, p.id, "sale@x.com"), null);
});

await test("โครงการที่ปิดแล้วเข้าไม่ได้แม้เป็นเจ้าของ", async () => {
  assert.deepEqual(await resolveAccess(db, { ...p, status: "closed" }, "owner@x.com"), { ok: false, reason: "project_closed" });
});

await test("สิทธิ์ตามบทบาท", async () => {
  assert.ok(canManageMembers("owner") && !canManageMembers("manager"));
  assert.ok(canGrantSupport("manager") && !canGrantSupport("sales") && !canGrantSupport("support"));
  assert.ok(canEditData("sales") && !canEditData("marketing") && !canEditData("viewer"));
});

console.log("access: ผ่าน");
