/**
 * สำรองข้อมูลรายวันไป R2 (เรียกจาก cron ใน worker.ts)
 * - ส่งออกทุกตารางของทุกฐานข้อมูล (DB และ DB_xxx ถ้ามี) เป็น NDJSON บีบอัด gzip
 * - ไฟล์: backups/YYYY-MM-DD/<binding>/<table>.ndjson.gz
 * - ลบชุดที่เก่ากว่า retentionDays
 * ชั้นแรกของการกู้คืนยังเป็น D1 Time Travel (ย้อนจุดเวลาได้ในตัว) — ไฟล์ชุดนี้ใช้เมื่อ Time Travel ไม่พอ
 */
import type { D1Like, R2Like } from "./d1";
import { SHARD_OK } from "./d1";

const PAGE = 1000;
const TABLE_OK = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function shardBindings(env: Record<string, unknown>): string[] {
  return Object.keys(env).filter((k) => SHARD_OK.test(k) && env[k] && typeof (env[k] as D1Like).prepare === "function").sort();
}

async function listTables(db: D1Like): Promise<string[]> {
  const r = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name`).all<{ name: string }>();
  return r.results.map((x) => x.name).filter((n) => TABLE_OK.test(n));
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function dumpTable(db: D1Like, table: string): Promise<{ ndjson: string; rows: number }> {
  if (!TABLE_OK.test(table)) throw new Error(`ชื่อตารางไม่ถูกต้อง: ${table}`);
  const lines: string[] = [];
  for (let off = 0; ; off += PAGE) {
    const r = await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${off}`).all();
    for (const row of r.results) lines.push(JSON.stringify(row));
    if (r.results.length < PAGE) break;
  }
  return { ndjson: lines.join("\n") + (lines.length ? "\n" : ""), rows: lines.length };
}

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function runBackup(env: Record<string, unknown> & { BACKUPS?: R2Like }, opts: { retentionDays?: number; now?: Date } = {}) {
  const bucket = env.BACKUPS;
  if (!bucket) throw new Error("ไม่พบ R2 binding ชื่อ BACKUPS");
  const now = opts.now ?? new Date();
  const day = dayKey(now);
  const summary: { binding: string; table: string; rows: number }[] = [];

  for (const binding of shardBindings(env)) {
    const db = env[binding] as D1Like;
    for (const table of await listTables(db)) {
      const { ndjson, rows } = await dumpTable(db, table);
      await bucket.put(`backups/${day}/${binding}/${table}.ndjson.gz`, await gzip(ndjson), { httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" } });
      summary.push({ binding, table, rows });
    }
  }
  await bucket.put(`backups/${day}/_manifest.json`, JSON.stringify({ at: now.toISOString(), tables: summary }, null, 2));

  const removed = await pruneBackups(bucket, opts.retentionDays ?? 30, now);
  return { day, tables: summary.length, rows: summary.reduce((a, s) => a + s.rows, 0), removedDays: removed };
}

/** ลบโฟลเดอร์ backups/YYYY-MM-DD/ ที่เก่ากว่าที่กำหนด */
export async function pruneBackups(bucket: R2Like, retentionDays: number, now = new Date()): Promise<string[]> {
  const cutoff = dayKey(new Date(now.getTime() - retentionDays * 86400_000));
  const oldDays = new Set<string>();
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "backups/", cursor });
    for (const o of page.objects) {
      const m = /^backups\/(\d{4}-\d{2}-\d{2})\//.exec(o.key);
      if (m && m[1] < cutoff) { oldDays.add(m[1]); keys.push(o.key); }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
  return [...oldDays].sort();
}
