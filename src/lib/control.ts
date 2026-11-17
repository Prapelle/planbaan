/**
 * ตารางระบบ (control) — โครงการ, สมาชิก, ทีม PlanBaan, สิทธิ์ทีมช่วยเหลือ, บันทึกการเข้าถึง
 * ไฟล์นี้ห้ามแตะตารางข้อมูลโครงการ (plots, leads, ...) — ใช้ tenant-db.ts
 */
import { type D1Like, SHARD_OK, nowIso } from "./d1";
import { isValidSlug } from "./host";
import { type ProjectRole, normRole } from "./roles";
import { trialEnd } from "./entitlement";

export type Project = { id: string; slug: string; name: string; kind: string; province: string; shard: string; status: string; created_at: string;
  trial_ends_at?: string; pure_until?: string; paid_until?: string; plan_image?: string; construction_enabled?: number; build_stale_days?: number };
export type SupportGrant = { id: string; project_id: string; granted_by: string; can_edit: number; reason: string; expires_at: string; revoked_at: string | null; created_at: string };

const normEmail = (e: string) => e.trim().toLowerCase();
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── โครงการ ──
export async function getProjectBySlug(db: D1Like, slug: string): Promise<Project | null> {
  return db.prepare(`SELECT * FROM projects WHERE slug = ?`).bind(slug.toLowerCase()).first<Project>();
}
/** โครงการ + บทบาทของอีเมลนี้ในคำสั่งเดียว (ลดจำนวนรอบที่คุยกับฐานข้อมูลในทุกหน้า) */
export async function getProjectWithRole(db: D1Like, slug: string, email: string | null): Promise<{ project: Project; role: ProjectRole | null } | null> {
  const r = await db.prepare(`SELECT p.*, m.role AS member_role FROM projects p LEFT JOIN memberships m ON m.project_id = p.id AND m.email = ? WHERE p.slug = ?`)
    .bind(email ? normEmail(email) : "", slug.toLowerCase()).first<Project & { member_role: string | null }>();
  if (!r) return null;
  const { member_role, ...project } = r;
  return { project, role: normRole(member_role) };
}
export async function getProject(db: D1Like, id: string): Promise<Project | null> {
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).bind(id).first<Project>();
}
/** key รูปผังใน R2 (ไฟล์อยู่ใต้ files/<project_id>/ เท่านั้น) */
export async function setPlanImage(db: D1Like, projectId: string, key: string) {
  if (key && !key.startsWith(`files/${projectId}/`)) throw new Error("key ไม่ถูกต้อง");
  await db.prepare(`UPDATE projects SET plan_image = ? WHERE id = ?`).bind(key, projectId).run();
}
export async function listProjects(db: D1Like): Promise<Project[]> {
  return (await db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all<Project>()).results;
}

export async function createProject(db: D1Like, p: { slug: string; name: string; ownerEmail: string; kind?: string; province?: string; shard?: string }): Promise<Project> {
  const slug = p.slug.trim().toLowerCase();
  if (!isValidSlug(slug)) throw new Error("ชื่อย่อโครงการ (slug) ใช้ได้เฉพาะ a-z 0-9 และ - ยาว 3–40 ตัว และห้ามใช้คำสงวน");
  const name = p.name.trim();
  if (!name) throw new Error("ต้องมีชื่อโครงการ");
  const owner = normEmail(p.ownerEmail);
  if (!EMAIL_OK.test(owner)) throw new Error("อีเมลเจ้าของโครงการไม่ถูกต้อง");
  const kind = p.kind === "builder" ? "builder" : "developer";
  const shard = p.shard ?? "DB";
  if (!SHARD_OK.test(shard)) throw new Error("ชื่อ shard ไม่ถูกต้อง");
  if (await getProjectBySlug(db, slug)) throw new Error(`มีโครงการ ${slug} อยู่แล้ว`);
  const now = nowIso();
  const project: Project = { id: crypto.randomUUID(), slug, name, kind, province: (p.province ?? "").trim(), shard, status: "active", created_at: now, trial_ends_at: trialEnd() };
  await db.batch([
    db.prepare(`INSERT INTO projects (id, slug, name, kind, province, shard, status, created_at, trial_ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(project.id, slug, name, kind, project.province, shard, "active", now, project.trial_ends_at),
    db.prepare(`INSERT INTO memberships (project_id, email, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(project.id, owner, now),
  ]);
  return project;
}

// ── สมาชิก ──
export async function getMembership(db: D1Like, projectId: string, email: string): Promise<ProjectRole | null> {
  const r = await db.prepare(`SELECT role FROM memberships WHERE project_id = ? AND email = ?`).bind(projectId, normEmail(email)).first<{ role: string }>();
  return r ? normRole(r.role) : null;
}
export async function listMembers(db: D1Like, projectId: string) {
  return (await db.prepare(`SELECT email, role, created_at FROM memberships WHERE project_id = ? ORDER BY created_at`).bind(projectId).all<{ email: string; role: ProjectRole; created_at: string }>()).results;
}
export async function projectsOfEmail(db: D1Like, email: string) {
  return (await db.prepare(`SELECT p.slug, p.name, m.role FROM memberships m JOIN projects p ON p.id = m.project_id WHERE m.email = ? ORDER BY p.name`).bind(normEmail(email)).all<{ slug: string; name: string; role: ProjectRole }>()).results;
}
export async function upsertMember(db: D1Like, projectId: string, emailRaw: string, roleRaw: string) {
  const email = normEmail(emailRaw);
  if (!EMAIL_OK.test(email)) throw new Error("อีเมลไม่ถูกต้อง");
  const role = normRole(roleRaw);
  if (!role) throw new Error("บทบาทไม่ถูกต้อง");
  const cur = await getMembership(db, projectId, email);
  if (cur === "owner" && role !== "owner" && (await countOwners(db, projectId)) <= 1) throw new Error("โครงการต้องมีเจ้าของอย่างน้อย 1 คน");
  await db.prepare(`INSERT INTO memberships (project_id, email, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, email) DO UPDATE SET role = excluded.role`)
    .bind(projectId, email, role, nowIso()).run();
}
export async function removeMember(db: D1Like, projectId: string, emailRaw: string) {
  const email = normEmail(emailRaw);
  if ((await getMembership(db, projectId, email)) === "owner" && (await countOwners(db, projectId)) <= 1) throw new Error("ลบเจ้าของคนสุดท้ายไม่ได้");
  await db.prepare(`DELETE FROM memberships WHERE project_id = ? AND email = ?`).bind(projectId, email).run();
}
async function countOwners(db: D1Like, projectId: string) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE project_id = ? AND role = 'owner'`).bind(projectId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

// ── ทีม PlanBaan ──
export async function getStaffRole(db: D1Like, email: string, initialAdmin = ""): Promise<"admin" | "support" | null> {
  const e = normEmail(email);
  if (initialAdmin && e === normEmail(initialAdmin)) return "admin";
  const r = await db.prepare(`SELECT role FROM platform_staff WHERE email = ?`).bind(e).first<{ role: string }>();
  if (!r) return null;
  return r.role === "admin" ? "admin" : "support";
}

export async function listStaff(db: D1Like) {
  return (await db.prepare(`SELECT email, role, created_at FROM platform_staff ORDER BY email`).all<{ email: string; role: string; created_at: string }>()).results;
}
export async function upsertStaff(db: D1Like, emailRaw: string, roleRaw: string) {
  const email = normEmail(emailRaw);
  if (!EMAIL_OK.test(email)) throw new Error("อีเมลไม่ถูกต้อง");
  const role = roleRaw === "admin" ? "admin" : "support";
  await db.prepare(`INSERT INTO platform_staff (email, role, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role`).bind(email, role, nowIso()).run();
}
export async function removeStaff(db: D1Like, emailRaw: string, by: string) {
  const email = normEmail(emailRaw);
  if (email === normEmail(by)) throw new Error("ลบสิทธิ์ของตัวเองไม่ได้");
  await db.prepare(`DELETE FROM platform_staff WHERE email = ?`).bind(email).run();
}
export async function ownersOf(db: D1Like, projectId: string) {
  return (await db.prepare(`SELECT email FROM memberships WHERE project_id = ? AND role = 'owner' ORDER BY email`).bind(projectId).all<{ email: string }>()).results.map((r) => r.email);
}

// ── ลิงก์ส่วนตัวของเจ้าของบ้าน (ส่วนก่อสร้าง) ──
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const TOKEN_OK = /^[A-Za-z0-9_-]{40,64}$/;
/** ออกลิงก์ใหม่ (ลิงก์เดิมของหลังนี้ถูกยกเลิก) คืน token ครั้งเดียว ระบบเก็บแค่ค่า hash */
export async function createShareLink(db: D1Like, projectId: string, buildId: string, by: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE share_links SET revoked_at = ? WHERE project_id = ? AND build_id = ? AND revoked_at IS NULL`).bind(now, projectId, buildId),
    db.prepare(`INSERT INTO share_links (token_hash, project_id, build_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).bind(await sha256Hex(token), projectId, buildId, by, now),
  ]);
  return token;
}
export async function revokeShareLinks(db: D1Like, projectId: string, buildId: string) {
  await db.prepare(`UPDATE share_links SET revoked_at = ? WHERE project_id = ? AND build_id = ? AND revoked_at IS NULL`).bind(nowIso(), projectId, buildId).run();
}
export async function activeShareLink(db: D1Like, projectId: string, buildId: string) {
  return db.prepare(`SELECT created_at, created_by FROM share_links WHERE project_id = ? AND build_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(projectId, buildId).first<{ created_at: string; created_by: string }>();
}
/** token → โครงการ + งาน (เฉพาะลิงก์ที่ยังไม่ถูกยกเลิก) */
export async function resolveShareLink(db: D1Like, token: string) {
  if (!TOKEN_OK.test(token)) return null;
  const r = await db.prepare(`SELECT s.build_id, p.* FROM share_links s JOIN projects p ON p.id = s.project_id WHERE s.token_hash = ? AND s.revoked_at IS NULL`)
    .bind(await sha256Hex(token)).first<Project & { build_id: string }>();
  if (!r) return null;
  const { build_id, ...project } = r;
  return { project: project as Project, buildId: build_id };
}
export async function setConstruction(db: D1Like, projectId: string, p: { enabled?: boolean; staleDays?: number }) {
  if (p.enabled !== undefined) await db.prepare(`UPDATE projects SET construction_enabled = ? WHERE id = ?`).bind(p.enabled ? 1 : 0, projectId).run();
  if (p.staleDays !== undefined) {
    if (!Number.isInteger(p.staleDays) || p.staleDays < 1 || p.staleDays > 60) throw new Error("จำนวนวันเตือนต้องเป็น 1–60");
    await db.prepare(`UPDATE projects SET build_stale_days = ? WHERE id = ?`).bind(p.staleDays, projectId).run();
  }
}

// ── สิทธิ์ทีมช่วยเหลือ ──
export const GRANT_HOURS = [24, 48, 72] as const;

export async function createSupportGrant(db: D1Like, p: { projectId: string; grantedBy: string; hours: number; canEdit: boolean; reason: string; now?: Date }): Promise<SupportGrant> {
  if (!(GRANT_HOURS as readonly number[]).includes(p.hours)) throw new Error("ระยะเวลาต้องเป็น 24, 48 หรือ 72 ชั่วโมง");
  const now = p.now ?? new Date();
  const g: SupportGrant = {
    id: crypto.randomUUID(), project_id: p.projectId, granted_by: normEmail(p.grantedBy), can_edit: p.canEdit ? 1 : 0,
    reason: p.reason.trim().slice(0, 300), expires_at: new Date(now.getTime() + p.hours * 3600_000).toISOString(), revoked_at: null, created_at: now.toISOString(),
  };
  await db.prepare(`INSERT INTO support_grants (id, project_id, granted_by, can_edit, reason, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`)
    .bind(g.id, g.project_id, g.granted_by, g.can_edit, g.reason, g.expires_at, g.created_at).run();
  return g;
}
export async function activeSupportGrant(db: D1Like, projectId: string, now = new Date()): Promise<SupportGrant | null> {
  return db.prepare(`SELECT * FROM support_grants WHERE project_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`)
    .bind(projectId, now.toISOString()).first<SupportGrant>();
}
export async function listSupportGrants(db: D1Like, projectId: string) {
  return (await db.prepare(`SELECT * FROM support_grants WHERE project_id = ? ORDER BY created_at DESC LIMIT 20`).bind(projectId).all<SupportGrant>()).results;
}
export async function revokeSupportGrants(db: D1Like, projectId: string, now = new Date()) {
  await db.prepare(`UPDATE support_grants SET revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL AND expires_at > ?`)
    .bind(now.toISOString(), projectId, now.toISOString()).run();
}

// ── บันทึกการเข้าถึงของทีมช่วยเหลือ ──
export async function logAccess(db: D1Like, e: { projectId: string; actor: string; action: string; target?: string }) {
  await db.prepare(`INSERT INTO access_log (project_id, actor, via, action, target, at) VALUES (?, ?, 'support', ?, ?, ?)`)
    .bind(e.projectId, normEmail(e.actor), e.action.slice(0, 80), (e.target ?? "").slice(0, 200), nowIso()).run();
}
export async function listAccessLog(db: D1Like, projectId: string, limit = 50) {
  return (await db.prepare(`SELECT actor, action, target, at FROM access_log WHERE project_id = ? ORDER BY id DESC LIMIT ?`).bind(projectId, limit)
    .all<{ actor: string; action: string; target: string; at: string }>()).results;
}
