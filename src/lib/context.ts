/**
 * ตัวเชื่อมระหว่าง Next.js กับชั้นข้อมูล: หาโครงการจากโดเมน, ตรวจสิทธิ์, คืนฐานข้อมูลของโครงการ
 * หน้าและ server action ของโครงการทุกตัวต้องเรียก requireProject() ก่อนทำอะไร
 */
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { type WorkerEnv, controlDb, getEnv, shardDb } from "./d1";
import { type Project, getProjectWithRole, getStaffRole } from "./control";
import { type Access, resolveAccess } from "./access";
import { resolveHost } from "./host";
import { tenantDb } from "./tenant-db";
import { type Entitlement, entitlementOf } from "./entitlement";
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
  /** สิทธิ์ใช้งาน (ทดลอง / Pure Product / จ่ายเงิน) */
  ent: Entitlement;
  /** หมดสิทธิ์: ดูและส่งออกได้ แก้ไม่ได้ */
  readonly: boolean;
  usage: (event: UsageEvent, meta?: Record<string, string | number>) => Promise<void>;
};

/**
 * เรียกในหน้า/แอ็กชันของโครงการ: ไม่ผ่าน → redirect ไปหน้าที่เหมาะสม
 * action/target ถูกบันทึกใน access_log เมื่อผู้เข้าเป็นทีมช่วยเหลือ
 */
export const requireProject = cache(async (opts: { action?: string; target?: string } = {}): Promise<ProjectCtx> => {
  const t0 = Date.now();
  const w = await where();
  if (w.kind !== "project") redirect("/");
  const [env, email] = await Promise.all([getEnv(), sessionEmail()]);
  const control = controlDb(env);
  // โครงการ + บทบาทในคำสั่งเดียว
  const found = await getProjectWithRole(control, w.slug, email);
  if (!found) redirect("/?error=project_not_found");
  const { project } = found;
  const access = await resolveAccess(control, project, email, { initialAdmin: cfg().initialAdmin, action: opts.action, target: opts.target, knownRole: found.role });
  if (!access.ok) {
    if (access.reason === "not_signed_in") redirect("/login");
    redirect(`/no-access?reason=${access.reason}`);
  }
  const ent = entitlementOf(project);
  // หมดสิทธิ์: กันทุกการแก้ไขที่นี่อีกชั้น (หน้าเว็บซ่อนปุ่มแก้อยู่แล้ว)
  if (ent.readonly && opts.action === "edit") {
    const to = opts.target?.startsWith("/") ? opts.target : "/";
    redirect(`${to}${to.includes("?") ? "&" : "?"}error=${encodeURIComponent("โครงการอยู่ในโหมดดูอย่างเดียว แก้ไขข้อมูลไม่ได้ ติดต่อทีม PlanBaan เพื่อต่อสิทธิ์")}`);
  }
  const db = tenantDb(shardDb(env, project.shard), project.id);
  const usage = async (event: UsageEvent, meta?: Record<string, string | number>) => {
    if (access.via === "support") return; // ไม่นับการใช้งานของทีมช่วยเหลือเป็นการใช้งานของลูกค้า
    // บันทึกเบื้องหลัง ไม่ให้ผู้ใช้ต้องรอ
    const p = logUsage(control, { projectId: project.id, event, email, salt: cfg().usageSalt, meta }).catch((e) => console.error("usage log failed", e));
    await background(p);
  };
  console.log(`[timing] ${opts.target ?? ""} access ${Date.now() - t0}ms`);
  return { env, project, email: email!, role: access.role, access, db, ent, readonly: ent.readonly, usage };
});

/** ทำงานต่อหลังส่งหน้าเว็บให้ผู้ใช้แล้ว (Workers waitUntil) ถ้าไม่มีให้รอตามปกติ */
async function background(p: Promise<unknown>) {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext().ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
    if (ctx?.waitUntil) { ctx.waitUntil(p); return; }
  } catch { /* นอก Worker (เทสต์) */ }
  await p;
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
