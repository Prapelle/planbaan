import "server-only";
import { controlDb, getEnv, shardDb } from "@/lib/d1";
import { resolveShareLink } from "@/lib/control";
import { tenantDb } from "@/lib/tenant-db";

/** ลิงก์เจ้าของบ้าน → โครงการ + ฐานข้อมูลของโครงการนั้น + งาน (null = ลิงก์ใช้ไม่ได้) */
export async function openShare(token: string) {
  const env = await getEnv();
  const r = await resolveShareLink(controlDb(env), token);
  if (!r || !r.project.construction_enabled || r.project.status === "closed") return null;
  const db = tenantDb(shardDb(env, r.project.shard), r.project.id);
  const build = await db.get("builds", r.buildId);
  if (!build) return null;
  return { env, project: r.project, db, build };
}
