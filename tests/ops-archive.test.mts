// ย้ายบันทึกการใช้งานและบันทึกการเข้าถึงที่เก่าออกไป R2
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { makeD1, makeR2, test } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { archiveUsage, archiveAccessLog } from "../src/lib/ops-archive";
import { usageSummary } from "../src/lib/usage";
import { listArchives } from "../src/lib/archive";

const db = makeD1();
const r2 = makeR2();
const p = await createProject(db as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const now = new Date("2026-11-19T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();
const ev = (d: number, page: string, actor: string) =>
  db.prepare(`INSERT INTO usage_events (project_id, event, actor_hash, meta, at) VALUES (?, 'page_view', ?, ?, ?)`).bind(p.id, actor, JSON.stringify({ page }), ago(d)).run();
for (let i = 0; i < 5; i++) await ev(200, "leads", i % 2 ? "u1" : "u2");
await ev(200, "plots", "u1");
await ev(10, "leads", "u1"); // ใหม่ ต้องอยู่ต่อ
const n = async (sql: string) => Number(((await db.prepare(sql).first()) as { n: number }).n);

await test("บันทึกการใช้งานเก่ากว่า 90 วัน: สรุปรายเดือน ย้ายไฟล์ แล้วลบ ส่วนที่ใหม่อยู่ต่อ", async () => {
  assert.equal(await archiveUsage(db as never, r2 as never, { now }), 6);
  assert.equal(await n(`SELECT COUNT(*) AS n FROM usage_events`), 1);
  const m = (await db.prepare(`SELECT page, n FROM usage_monthly ORDER BY page`).all()).results;
  assert.deepEqual(m, [{ page: "leads", n: 5 }, { page: "plots", n: 1 }]);
  assert.equal(await n(`SELECT COUNT(*) AS n FROM usage_monthly_users`), 2);
  const [key] = [...r2.store.keys()].filter((k) => k.startsWith("ops/usage_events/"));
  assert.equal(gunzipSync(r2.store.get(key)).toString().trim().split("\n").length, 6);
  // รันซ้ำไม่นับซ้ำ
  assert.equal(await archiveUsage(db as never, r2 as never, { now }), 0);
  assert.equal(await n(`SELECT SUM(n) AS n FROM usage_monthly`), 6);
});

await test("หลังบ้านยังรู้ว่าใช้ล่าสุดเมื่อไร แม้เหตุการณ์ถูกย้ายออกหมด", async () => {
  await db.prepare(`DELETE FROM usage_events`).run();
  const [row] = await usageSummary(db as never, now);
  assert.equal(row.last_at, ago(200));
});

await test("บันทึกการเข้าถึงเก่ากว่า 1 ปี ย้ายไปไฟล์ของโครงการ เจ้าของดาวน์โหลดได้", async () => {
  const log = (d: number) => db.prepare(`INSERT INTO access_log (project_id, actor, via, action, target, at) VALUES (?, 'staff@pb', 'support', 'view', '/leads', ?)`).bind(p.id, ago(d)).run();
  await log(400); await log(380); await log(5);
  assert.deepEqual(await archiveAccessLog(db as never, r2 as never, { now }), { [p.id]: 2 });
  assert.equal(await n(`SELECT COUNT(*) AS n FROM access_log`), 1);
  const files = await listArchives(r2 as never, p.id);
  assert.match(files[0].name, /^access_log-\d{4}-\d{2}-\d{2}-01\.ndjson\.gz$/);
});
