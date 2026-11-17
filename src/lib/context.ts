/**
 * ตัวเชื่อมระหว่าง Next.js กับชั้นข้อมูล: หาโครงการจากโดเมน, ตรวจสิทธิ์, คืนฐานข้อมูลของโครงการ
 * หน้าและ server action ของโครงการทุกตัวต้องเรียก requireProject() ก่อนทำอะไร
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { type WorkerEnv, controlDb, getEnv, shardDb } from "./d1";
import { type Project, getProjectBySlug, getStaffRole } from "./control";
import { type Access, resolveAccess } from "./access";
import { resolveHost } from "./host";
import { tenantDb } from "./tenant-db";
import { type UsageEvent, logUsage } from "./usage";
import type { AccessRole } from "./roles";

export const DEV_COOKIE = "pb_project";

export const cfg = () => ({
  baseDomain: (process.env.BASE_DOMAIN ?? "").trim().toLowerCase(),
  allowSwitch: process.env.ALLOW_PROJECT_SWITCH === "true",
  initialAdmin: (process.env.INITIAL_ADMIN_EMAIL ?? "").trim().toLowerCase(),
  usageSalt: process.env.USAGE_SALT ?? "",
});

export type Where = { kind: "project"; slug: string } | { kind: "root" } | { kind: "unknown" };

/** โดเมนของคำขอนี้ชี้ไปที่โครงการไหน */
export async function where(): Promise<Where> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const r = resolveHost(host, cfg().baseDomain);
  if (r.kind === "project" || r.kind === "root" || r.kind === "unknown") return r;
  // dev: ยังไม่มีโดเมน — เลือกโครงการด้วยคุกกี้ (ตั้งผ่าน /api/dev/project?slug=)
  if (!cfg().allowSwitch) return { kind: "root" };
  const slug = (await cookies()).get(DEV_COOKIE)?.value ?? "";
  return slug ? { kind: "project", slug } : { kind: "root" };
}

export async function sessionEmail(): Promise<string | null> {
  const s = await auth();
  return s?.user?.email?.toLowerCase() ?? null;
}

/** ลิงก์ไปหน้าของโครงการ (มีโดเมน → subdomain, ยังไม่มี → ตั้งคุกกี้ dev) */
export function projectUrl(slug: string, path = "/") {
  const base = cfg().baseDomain;
  if (base) return `https://${slug}.${base}${path}`;
  return `/api/dev/project?slug=${encodeURIComponent(slug)}&next=${encodeURIComponent(path)}`;
}

export type ProjectCtx = {
  env: WorkerEnv; project: Project; email: string; role: AccessRole;
  access: Extract<Access, { ok: true }>;
  db: ReturnType<typeof tenantDb>;
  usage: (event: UsageEvent, meta?: Record<string, string | number>) => Promise<void>;
};

/**
 * เรียกในหน้า/แอ็กชันของโครงการ: ไม่ผ่าน → redirect ไปหน้าที่เหมาะสม
 * action/target ถูกบันทึกใน access_log เมื่อผู้เข้าเป็นทีมช่วยเหลือ
 */
export async function requireProject(opts: { action?: string; target?: string } = {}): Promise<ProjectCtx> {
  const w = await where();
  if (w.kind !== "project") redirect("/");
  const env = await getEnv();
  const control = controlDb(env);
  const project = await getProjectBySlug(control, w.slug);
  if (!project) redirect("/?error=project_not_found");
  const email = await sessionEmail();
  const access = await resolveAccess(control, project, email, { initialAdmin: cfg().initialAdmin, action: opts.action, target: opts.target });
  if (!access.ok) {
    if (access.reason === "not_signed_in") redirect("/login");
    redirect(`/no-access?reason=${access.reason}`);
  }
  const db = tenantDb(shardDb(env, project.shard), project.id);
  const usage = async (event: UsageEvent, meta?: Record<string, string | number>) => {
    if (access.via === "support") return; // ไม่นับการใช้งานของทีมช่วยเหลือเป็นการใช้งานของลูกค้า
    try { await logUsage(control, { projectId: project.id, event, email, salt: cfg().usageSalt, meta }); } catch (e) { console.error("usage log failed", e); }
  };
  return { env, project, email: email!, role: access.role, access, db, usage };
}

/** ทีม PlanBaan (back office) */
export async function requireStaff() {
  const email = await sessionEmail();
  if (!email) redirect("/login");
  const env = await getEnv();
  const role = await getStaffRole(controlDb(env), email, cfg().initialAdmin);
  if (!role) redirect("/no-access?reason=not_staff");
  return { env, email, staffRole: role };
}
