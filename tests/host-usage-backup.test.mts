// subdomain → โครงการ, การบันทึกการใช้งาน, การสำรองข้อมูล
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { makeD1, makeR2, test, rejects } from "./helpers/fake-cf.mjs";
import { resolveHost, isAllowedRedirect } from "../src/lib/host";
import { logUsage, usageSummary, cleanMeta, hashActor } from "../src/lib/usage";
import { runBackup, pruneBackups } from "../src/lib/backup";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";

await test("resolveHost", async () => {
  const B = "planbaan.app";
  assert.deepEqual(resolveHost("suanson.planbaan.app", B), { kind: "project", slug: "suanson" });
  assert.deepEqual(resolveHost("SuanSon.PlanBaan.app:443", B), { kind: "project", slug: "suanson" });
  assert.deepEqual(resolveHost("planbaan.app", B), { kind: "root" });
  assert.deepEqual(resolveHost("www.planbaan.app", B), { kind: "root" });
  assert.deepEqual(resolveHost("a.b.planbaan.app", B), { kind: "unknown" });
  assert.deepEqual(resolveHost("admin.planbaan.app", B), { kind: "unknown" });
  assert.deepEqual(resolveHost("evilplanbaan.app", B), { kind: "unknown" });
  assert.deepEqual(resolveHost("planbaan.xyz.workers.dev", B), { kind: "dev" });
  assert.deepEqual(resolveHost("localhost:3000", ""), { kind: "dev" });
});

await test("redirect หลังล็อกอินไปได้เฉพาะโดเมนของเรา", async () => {
  const B = "planbaan.app", O = "https://planbaan.app";
  assert.ok(isAllowedRedirect("https://suanson.planbaan.app/plots", B, O));
  assert.ok(isAllowedRedirect("/home", B, O));
  assert.ok(!isAllowedRedirect("https://evil.com/", B, O));
  assert.ok(!isAllowedRedirect("https://planbaan.app.evil.com/", B, O));
  assert.ok(!isAllowedRedirect("http://suanson.planbaan.app/", B, O));
});

const db = makeD1();
const p = await createProject(db as never, { slug: "suanson", name: "สวนสน", ownerEmail: "a@x.com" });

await test("บันทึกการใช้งาน: ไม่มีอีเมลและเนื้อหาข้อมูลลูกค้า", async () => {
  await logUsage(db as never, { projectId: p.id, event: "lead_created", email: "a@x.com", salt: "s", meta: { channel: "facebook", n: 1, name: "คุณวิชัย 0812345678" } });
  await logUsage(db as never, { projectId: p.id, event: "page_view", email: "a@x.com", salt: "s", meta: { page: "/plots" } });
  const rows = db.raw.prepare(`SELECT * FROM usage_events`).all() as Record<string, string>[];
  assert.equal(rows.length, 2);
  for (const r of rows) assert.ok(!JSON.stringify(r).includes("a@x.com") && !JSON.stringify(r).includes("0812345678"));
  assert.equal(rows[0].meta, JSON.stringify({ channel: "facebook", n: 1 }));
  assert.equal(rows[0].actor_hash, await hashActor("A@x.com ", "s"));
  assert.equal(cleanMeta({ "bad key": "x", ok: "../../etc" }), "");
  await rejects(logUsage(db as never, { projectId: p.id, event: "nope" as never, salt: "s" }), /ไม่รู้จักเหตุการณ์/);
});

await test("สรุปการใช้งานต่อโครงการ", async () => {
  const s = await usageSummary(db as never);
  assert.equal(s.length, 1);
  assert.equal(s[0].users_7d, 1);
  assert.equal(s[0].events_7d, 2);
  assert.equal(s[0].members, 1);
});

await test("สำรองข้อมูล: ทุกตารางลง R2 อ่านกลับได้", async () => {
  await tenantDb(db as never, p.id).insert("plots", { code: "A01", price: 2390000 });
  const r2 = makeR2();
  const res = await runBackup({ DB: db, BACKUPS: r2, OTHER: 1 } as never, { now: new Date("2026-11-17T20:00:00Z") });
  assert.equal(res.day, "2026-11-17");
  const plots = gunzipSync(r2.store.get("backups/2026-11-17/DB/plots.ndjson.gz")).toString().trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(plots.length, 1);
  assert.equal(plots[0].code, "A01");
  for (const t of ["projects", "memberships", "leads", "usage_events", "support_grants", "access_log", "platform_staff"]) {
    assert.ok(r2.store.has(`backups/2026-11-17/DB/${t}.ndjson.gz`), t);
  }
  assert.ok(r2.store.has("backups/2026-11-17/_manifest.json"));
});

await test("สำรองข้อมูล: ลบชุดที่เก่ากว่า 30 วัน", async () => {
  const r2 = makeR2();
  for (const d of ["2026-09-01", "2026-10-17", "2026-10-18", "2026-11-16"]) await r2.put(`backups/${d}/DB/plots.ndjson.gz`, "x");
  await r2.put("other/keep.txt", "x");
  const removed = await pruneBackups(r2 as never, 30, new Date("2026-11-17T20:00:00Z"));
  assert.deepEqual(removed, ["2026-09-01", "2026-10-17"]);
  assert.deepEqual([...r2.store.keys()].sort(), ["backups/2026-10-18/DB/plots.ndjson.gz", "backups/2026-11-16/DB/plots.ndjson.gz", "other/keep.txt"]);
});

console.log("host-usage-backup: ผ่าน");
