/**
 * ตัดสินว่าใครเข้าโครงการได้ด้วยสิทธิ์อะไร
 * - สมาชิกโครงการ → บทบาทตาม memberships
 * - ทีม PlanBaan → เข้าได้เฉพาะตอนที่ลูกค้าเปิดสิทธิ์ (support_grants ยังไม่หมดอายุ/ไม่ถูกยกเลิก) และทุกครั้งถูกบันทึกใน access_log
 * - นอกนั้น → เข้าไม่ได้
 * ทีม PlanBaan ที่เป็นสมาชิกโครงการด้วย ใช้สิทธิ์สมาชิก (ไม่ถือเป็นการเข้าแบบ support)
 */
import type { D1Like } from "./d1";
import { type Project, activeSupportGrant, getMembership, getStaffRole, logAccess } from "./control";
import type { AccessRole } from "./roles";

export type Access =
  | { ok: true; role: AccessRole; via: "member" | "support"; supportCanEdit: boolean; grantExpiresAt?: string }
  | { ok: false; reason: "not_signed_in" | "no_access" | "project_closed" };

export async function resolveAccess(
  db: D1Like,
  project: Project,
  email: string | null | undefined,
  opts: { initialAdmin?: string; action?: string; target?: string; now?: Date } = {},
): Promise<Access> {
  if (!email) return { ok: false, reason: "not_signed_in" };
  if (project.status === "closed") return { ok: false, reason: "project_closed" };
  const role = await getMembership(db, project.id, email);
  if (role) return { ok: true, role, via: "member", supportCanEdit: false };
  const staff = await getStaffRole(db, email, opts.initialAdmin);
  if (staff) {
    const g = await activeSupportGrant(db, project.id, opts.now);
    if (g) {
      await logAccess(db, { projectId: project.id, actor: email, action: opts.action ?? "view", target: opts.target });
      return { ok: true, role: "support", via: "support", supportCanEdit: g.can_edit === 1, grantExpiresAt: g.expires_at };
    }
  }
  return { ok: false, reason: "no_access" };
}
