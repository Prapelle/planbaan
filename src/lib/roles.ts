/**
 * บทบาทในโครงการ (ระยะ 0)
 * - owner: เจ้าของโครงการ ทำได้ทุกอย่าง จัดการผู้ใช้ เปิดสิทธิ์ทีมช่วยเหลือ
 * - manager: ผู้จัดการ แก้ข้อมูลได้ เปิดสิทธิ์ทีมช่วยเหลือได้ แต่จัดการผู้ใช้ไม่ได้
 * - sales: ฝ่ายขาย แก้ข้อมูลลูกค้าและแปลงได้
 * - marketing: การตลาด แก้ได้เฉพาะงบและค่าโฆษณา ข้อมูลลูกค้าดูอย่างเดียว
 * - viewer: ดูอย่างเดียว
 * - support: ทีม PlanBaan ที่ลูกค้าเปิดสิทธิ์ให้ชั่วคราว (ไม่ได้เก็บใน memberships)
 */
export type ProjectRole = "owner" | "manager" | "sales" | "marketing" | "viewer";
export type AccessRole = ProjectRole | "support";
export const PROJECT_ROLES: ProjectRole[] = ["owner", "manager", "sales", "marketing", "viewer"];
export const ROLE_LABEL: Record<AccessRole, string> = {
  owner: "เจ้าของโครงการ", manager: "ผู้จัดการ", sales: "ฝ่ายขาย", marketing: "การตลาด", viewer: "ดูอย่างเดียว", support: "ทีมช่วยเหลือ PlanBaan",
};
export const normRole = (v: unknown): ProjectRole | null => {
  const r = String(v ?? "").trim().toLowerCase();
  return (PROJECT_ROLES as string[]).includes(r) ? (r as ProjectRole) : null;
};
export const canManageMembers = (r: AccessRole) => r === "owner";
export const canGrantSupport = (r: AccessRole) => r === "owner" || r === "manager";
/** ตั้งค่าผังแปลง (สร้าง/ลบแปลง แก้ราคา แบบบ้าน) */
export const canManagePlots = (r: AccessRole, supportCanEdit = false) => r === "owner" || r === "manager" || (r === "support" && supportCanEdit);
export const canEditData =(r: AccessRole, supportCanEdit = false) =>
  r === "owner" || r === "manager" || r === "sales" || (r === "support" && supportCanEdit);

/** ส่งออกข้อมูลทั้งโครงการ (มีข้อมูลส่วนบุคคลของลูกค้า) */
export const canExport = (r: AccessRole) => r === "owner" || r === "manager";

/** งบและค่าโฆษณา */
export const canEditMarketing = (r: AccessRole, supportCanEdit = false) =>
  r === "owner" || r === "manager" || r === "marketing" || (r === "support" && supportCanEdit);
