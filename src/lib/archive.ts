/**
 * ย้ายประวัติลูกค้าเก่า (lead_activity) ไปเก็บถาวรใน R2 เพื่อให้ฐานข้อมูลเล็กและเร็ว
 * - เก่ากว่า ARCHIVE_DAYS วัน (ค่าเริ่มต้น 365) ย้ายเป็นไฟล์ archive/<project_id>/lead_activity-<วันที่>-<ลำดับ>.ndjson.gz แล้วลบจากฐานข้อมูล
 * - เขียนไฟล์สำเร็จก่อนจึงลบ ถ้าเขียนไม่ได้จะไม่ลบ
 * - ทำทีละโครงการผ่าน tenantDb (ไม่ข้ามโครงการ) ลูกค้าดาวน์โหลดไฟล์ของตัวเองได้ที่หน้าส่งออกข้อมูล
 */
import { type R2Like, type WorkerEnv, controlDb, shardDb } from "./d1";
import { listProjects } from "./control";
import { tenantDb } from "./tenant-db";
import { gzip } from "./backup";

const BATCH = 2000;
export const archivePrefix = (projectId: string) => `archive/${projectId}/`;

export async function archiveProject(env: WorkerEnv, bucket: R2Like, project: { id: string; shard: string }, days: number, now = new Date()) {
  const db = tenantDb(shardDb(env, project.shard), project.id);
  const cutoff = new Date(now.getTime() - days * 86400_000).toISOString();
  const day = now.toISOString().slice(0, 10);
  let moved = 0;
  for (let part = 1; part <= 50; part++) {
    const rows = await db.list("lead_activity", { before: cutoff, limit: BATCH });
    if (!rows.length) break;
    const key = `${archivePrefix(project.id)}lead_activity-${day}-${String(part).padStart(2, "0")}.ndjson.gz`;
    await bucket.put(key, await gzip(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"), { httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" } });
    await db.removeMany("lead_activity", rows.map((r) => r.id));
    moved += rows.length;
    if (rows.length < BATCH) break;
  }
  return moved;
}

export async function runArchive(env: WorkerEnv, opts: { days?: number; now?: Date } = {}) {
  const bucket = env.BACKUPS;
  if (!bucket) throw new Error("ไม่พบ R2 binding ชื่อ BACKUPS");
  const days = Math.max(90, opts.days ?? 365); // กันตั้งค่าผิดจนย้ายประวัติใหม่ออก
  const out: Record<string, number> = {};
  for (const p of await listProjects(controlDb(env))) {
    try { const n = await archiveProject(env, bucket, p, days, opts.now); if (n) out[p.slug] = n; }
    catch (e) { console.error("archive failed", p.slug, e); }
  }
  return out;
}

export async function listArchives(bucket: R2Like, projectId: string) {
  const out: { name: string; key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: archivePrefix(projectId), cursor });
    for (const o of page.objects) out.push({ key: o.key, name: o.key.slice(archivePrefix(projectId).length), size: Number(o.size ?? 0) });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.name.localeCompare(a.name));
}
