import "server-only";
import { redirect } from "next/navigation";
import { requireProject } from "./context";
import { canEditCosts, canSeeCosts } from "./roles";

/** หน้าต้นทุนและกำไร: ต้องเปิดส่วนก่อสร้าง และเป็นเจ้าของ บัญชี หรือทีมช่วยเหลือที่ได้รับสิทธิ์ */
export async function requireCosts(target: string, edit = false) {
  const ctx = await requireProject({ action: edit ? "edit" : "view", target });
  if (!ctx.project.construction_enabled) redirect("/build");
  if (!canSeeCosts(ctx.role)) redirect("/");
  const canEdit = canEditCosts(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly;
  if (edit && !canEdit) redirect(`${target}${target.includes("?") ? "&" : "?"}error=${encodeURIComponent("ไม่มีสิทธิ์แก้ข้อมูลต้นทุน")}`);
  return { ctx, canEdit };
}
