/**
 * บันทึกเหตุการณ์การใช้งานสำหรับ back office
 * - เก็บแค่ "เกิดอะไร" (เปิดหน้า, เพิ่มลูกค้า 1 ราย ฯลฯ) ไม่เก็บเนื้อหาข้อมูลลูกค้า
 * - ผู้ใช้เก็บเป็นค่า hash (นับคนที่ใช้งานได้ แต่ย้อนกลับเป็นอีเมลไม่ได้)
 * - meta รับเฉพาะตัวเลขและข้อความสั้นจากรายการที่กำหนด
 */
import { type D1Like, nowIso } from "./d1";

export const USAGE_EVENTS = [
  "login", "page_view", "member_added", "member_removed", "support_granted", "support_revoked",
  "plot_created", "plot_updated", "lead_created", "lead_stage_changed", "export",
] as const;
export type UsageEvent = (typeof USAGE_EVENTS)[number];

const META_KEY = /^[a-z_]{1,24}$/;
const META_VAL = /^[a-z0-9_\-/]{0,40}$/;

export function cleanMeta(meta: Record<string, string | number> = {}): string {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!META_KEY.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string" && META_VAL.test(v)) out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

export async function hashActor(email: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${email.trim().toLowerCase()}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function logUsage(db: D1Like, e: { projectId: string; event: UsageEvent; email?: string | null; salt: string; meta?: Record<string, string | number> }) {
  if (!(USAGE_EVENTS as readonly string[]).includes(e.event)) throw new Error(`ไม่รู้จักเหตุการณ์ ${e.event}`);
  const actor = e.email ? await hashActor(e.email, e.salt) : "";
  await db.prepare(`INSERT INTO usage_events (project_id, event, actor_hash, meta, at) VALUES (?, ?, ?, ?, ?)`)
    .bind(e.projectId, e.event, actor, cleanMeta(e.meta), nowIso()).run();
}

/** สรุปต่อโครงการสำหรับ back office: ใช้ล่าสุดเมื่อไร, ผู้ใช้งานใน 7 วัน, จำนวนเหตุการณ์ใน 7 วัน */
export async function usageSummary(db: D1Like, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const r = await db.prepare(`
    SELECT p.id, p.slug, p.name, p.kind, p.province, p.status, p.created_at,
      (SELECT MAX(at) FROM usage_events u WHERE u.project_id = p.id) AS last_at,
      (SELECT COUNT(DISTINCT actor_hash) FROM usage_events u WHERE u.project_id = p.id AND u.at >= ? AND actor_hash <> '') AS users_7d,
      (SELECT COUNT(*) FROM usage_events u WHERE u.project_id = p.id AND u.at >= ?) AS events_7d,
      (SELECT COUNT(*) FROM memberships m WHERE m.project_id = p.id) AS members
    FROM projects p ORDER BY p.created_at DESC`).bind(since, since)
    .all<{ id: string; slug: string; name: string; kind: string; province: string; status: string; created_at: string; last_at: string | null; users_7d: number; events_7d: number; members: number }>();
  return r.results;
}
