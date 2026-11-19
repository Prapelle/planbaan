/**
 * บันทึกเหตุการณ์การใช้งานสำหรับ back office
 * - เก็บแค่ "เกิดอะไร" (เปิดหน้า, เพิ่มลูกค้า 1 ราย ฯลฯ) ไม่เก็บเนื้อหาข้อมูลลูกค้า
 * - ผู้ใช้เก็บเป็นค่า hash (นับคนที่ใช้งานได้ แต่ย้อนกลับเป็นอีเมลไม่ได้)
 * - meta รับเฉพาะตัวเลขและข้อความสั้นจากรายการที่กำหนด
 */
import { type D1Like, nowIso } from "./d1";

export const USAGE_EVENTS = [
  "login", "page_view", "member_added", "member_removed", "support_granted", "support_revoked",
  "plot_created", "plot_updated", "lead_created", "lead_stage_changed", "export", "marketing_import", "marketing_updated", "pwa_opened", "import",
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
    SELECT p.id, p.slug, p.name, p.kind, p.province, p.status, p.created_at, p.trial_ends_at, p.pure_until, p.paid_until, p.construction_enabled,
      COALESCE((SELECT MAX(at) FROM usage_events u WHERE u.project_id = p.id),
        (SELECT MAX(last_at) FROM usage_monthly m WHERE m.project_id = p.id)) AS last_at,
      (SELECT COUNT(DISTINCT actor_hash) FROM usage_events u WHERE u.project_id = p.id AND u.at >= ? AND actor_hash <> '') AS users_7d,
      (SELECT COUNT(*) FROM usage_events u WHERE u.project_id = p.id AND u.at >= ?) AS events_7d,
      (SELECT COUNT(*) FROM memberships m WHERE m.project_id = p.id) AS members
    FROM projects p ORDER BY p.created_at DESC`).bind(since, since)
    .all<{ id: string; slug: string; name: string; kind: string; province: string; status: string; created_at: string; trial_ends_at: string; pure_until: string; paid_until: string; construction_enabled: number; last_at: string | null; users_7d: number; events_7d: number; members: number }>();
  return r.results;
}

/** การใช้งานของโครงการเดียว N วันล่าสุด: แยกตามเหตุการณ์ ตามหน้า และรายวัน (ไม่มีเนื้อหาข้อมูลลูกค้า) */
export async function projectUsage(db: D1Like, projectId: string, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const [byEvent, byPage, daily, users] = await Promise.all([
    db.prepare(`SELECT event, COUNT(*) AS n FROM usage_events WHERE project_id = ? AND at >= ? GROUP BY event ORDER BY n DESC`).bind(projectId, since).all<{ event: string; n: number }>(),
    db.prepare(`SELECT json_extract(meta, '$.page') AS page, COUNT(*) AS n FROM usage_events WHERE project_id = ? AND at >= ? AND event = 'page_view' GROUP BY page ORDER BY n DESC`).bind(projectId, since).all<{ page: string; n: number }>(),
    db.prepare(`SELECT substr(datetime(at, '+7 hours'), 1, 10) AS day, COUNT(*) AS n, COUNT(DISTINCT actor_hash) AS users FROM usage_events WHERE project_id = ? AND at >= ? GROUP BY day ORDER BY day`).bind(projectId, since).all<{ day: string; n: number; users: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT actor_hash) AS n FROM usage_events WHERE project_id = ? AND at >= ? AND actor_hash <> ''`).bind(projectId, since).first<{ n: number }>(),
  ]);
  return { byEvent: byEvent.results, byPage: byPage.results.filter((r) => r.page), daily: daily.results, users: Number(users?.n ?? 0) };
}

/** มีกี่โครงการที่เปิดใช้แต่ละหน้าใน N วัน (ดูว่าฟีเจอร์ไหนถูกใช้จริง) */
export async function featureAdoption(db: D1Like, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const r = await db.prepare(`SELECT json_extract(meta, '$.page') AS page, COUNT(DISTINCT project_id) AS projects, COUNT(*) AS views
    FROM usage_events WHERE event = 'page_view' AND at >= ? GROUP BY page ORDER BY projects DESC, views DESC`).bind(since).all<{ page: string; projects: number; views: number }>();
  return r.results.filter((x) => x.page);
}
