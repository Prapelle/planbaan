/**
 * ย้ายบันทึกระบบเก่าออกจากฐานข้อมูลหลัก (ทำทุกคืนหลังสำรองข้อมูล)
 * - usage_events เก่ากว่า USAGE_KEEP_DAYS (90): สรุปเป็นรายเดือนใน usage_monthly แล้วย้ายแถวไปไฟล์ ops/usage_events/ ใน R2
 *   (ไฟล์ภายในทีม ลูกค้าไม่เห็น · ไม่มีข้อมูลลูกค้าอยู่แล้ว)
 * - access_log เก่ากว่า ACCESS_KEEP_DAYS (365): ย้ายไป archive/<project_id>/access_log-*.ndjson.gz
 *   เจ้าของโครงการดาวน์โหลดได้ที่หน้าส่งออกข้อมูล (สัญญาว่าลูกค้าตรวจได้เสมอว่าทีมเราเข้าดูอะไร)
 * ทุกขั้น: เขียนไฟล์สำเร็จก่อน → สรุปและลบในชุดเดียวกัน (D1 batch ทำทั้งชุดหรือไม่ทำเลย) จึงไม่นับซ้ำแม้งานหยุดกลางทาง
 */
import { type D1Like, type R2Like } from "./d1";
import { gzip } from "./backup";
import { archivePrefix } from "./archive";

export const USAGE_KEEP_DAYS = 90;
export const ACCESS_KEEP_DAYS = 365;
const CHUNK = 2000;
const MAX_CHUNKS = 50;

type Ev = { id: number; project_id: string; event: string; actor_hash: string; meta: string; at: string };
const nd = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const put = async (bucket: R2Like, key: string, rows: unknown[]) =>
  bucket.put(key, await gzip(nd(rows)), { httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" } });

export async function archiveUsage(db: D1Like, bucket: R2Like, opts: { days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - Math.max(30, opts.days ?? USAGE_KEEP_DAYS) * 86400_000).toISOString();
  const day = now.toISOString().slice(0, 10);
  let moved = 0;
  for (let part = 1; part <= MAX_CHUNKS; part++) {
    const rows = (await db.prepare(`SELECT id, project_id, event, actor_hash, meta, at FROM usage_events WHERE at < ? ORDER BY id LIMIT ${CHUNK}`).bind(cutoff).all<Ev>()).results;
    if (!rows.length) break;
    const lo = rows[0].id, hi = rows[rows.length - 1].id;
    await put(bucket, `ops/usage_events/${day}-${String(part).padStart(2, "0")}.ndjson.gz`, rows);
    const range = `id BETWEEN ? AND ? AND at < ?`;
    await db.batch([
      db.prepare(`INSERT INTO usage_monthly (project_id, month, event, page, n, last_at)
        SELECT project_id, substr(datetime(at, '+7 hours'), 1, 7), event, COALESCE(json_extract(NULLIF(meta, ''), '$.page'), ''), COUNT(*), MAX(at)
        FROM usage_events WHERE ${range} GROUP BY 1, 2, 3, 4
        ON CONFLICT (project_id, month, event, page) DO UPDATE SET n = n + excluded.n, last_at = MAX(last_at, excluded.last_at)`).bind(lo, hi, cutoff),
      db.prepare(`INSERT OR IGNORE INTO usage_monthly_users (project_id, month, actor_hash)
        SELECT DISTINCT project_id, substr(datetime(at, '+7 hours'), 1, 7), actor_hash FROM usage_events WHERE ${range} AND actor_hash <> ''`).bind(lo, hi, cutoff),
      db.prepare(`DELETE FROM usage_events WHERE ${range}`).bind(lo, hi, cutoff),
    ]);
    moved += rows.length;
    if (rows.length < CHUNK) break;
  }
  return moved;
}

type Acc = { id: number; project_id: string; actor: string; via: string; action: string; target: string; at: string };
export async function archiveAccessLog(db: D1Like, bucket: R2Like, opts: { days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - Math.max(180, opts.days ?? ACCESS_KEEP_DAYS) * 86400_000).toISOString();
  const day = now.toISOString().slice(0, 10);
  const projects = (await db.prepare(`SELECT DISTINCT project_id FROM access_log WHERE at < ?`).bind(cutoff).all<{ project_id: string }>()).results;
  const out: Record<string, number> = {};
  for (const { project_id: pid } of projects) {
    for (let part = 1; part <= MAX_CHUNKS; part++) {
      const rows = (await db.prepare(`SELECT id, project_id, actor, via, action, target, at FROM access_log WHERE project_id = ? AND at < ? ORDER BY id LIMIT ${CHUNK}`).bind(pid, cutoff).all<Acc>()).results;
      if (!rows.length) break;
      await put(bucket, `${archivePrefix(pid)}access_log-${day}-${String(part).padStart(2, "0")}.ndjson.gz`, rows);
      await db.prepare(`DELETE FROM access_log WHERE project_id = ? AND id BETWEEN ? AND ? AND at < ?`).bind(pid, rows[0].id, rows[rows.length - 1].id, cutoff).run();
      out[pid] = (out[pid] ?? 0) + rows.length;
      if (rows.length < CHUNK) break;
    }
  }
  return out;
}

export async function runOpsArchive(env: { DB: D1Like; BACKUPS?: R2Like }, opts: { now?: Date } = {}) {
  if (!env.BACKUPS) throw new Error("ไม่พบ R2 binding ชื่อ BACKUPS");
  const usage = await archiveUsage(env.DB, env.BACKUPS, opts);
  const access = await archiveAccessLog(env.DB, env.BACKUPS, opts);
  return { usage, access };
}
