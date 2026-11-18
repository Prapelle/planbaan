import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cfg, requireStaff } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { listStaff, removeStaff, upsertStaff } from "@/lib/control";
import { BackNotice, BackShell } from "@/components/BackShell";
import { opsBtnLine, opsCard, opsInput } from "../shared";

export const dynamic = "force-dynamic";
const PATH = "/platform/staff";

async function staffAction(form: FormData) {
  "use server";
  const { env, email, staffRole } = await requireStaff();
  if (staffRole !== "admin") redirect(`${PATH}?error=${encodeURIComponent("จัดการทีมงานได้เฉพาะ admin")}`);
  const target = String(form.get("email") ?? "");
  const remove = !!form.get("remove");
  try {
    if (remove) await removeStaff(controlDb(env), target, email);
    else await upsertStaff(controlDb(env), target, String(form.get("role") ?? "support"));
  } catch (e) { redirect(`${PATH}?error=${encodeURIComponent((e as Error).message)}`); }
  revalidatePath(PATH);
  redirect(`${PATH}?msg=${encodeURIComponent(remove ? `นำ ${target} ออกจากทีมแล้ว` : `บันทึก ${target} แล้ว`)}`);
}

export default async function PlatformStaff({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { env, email, staffRole } = await requireStaff();
  const { error, msg } = await searchParams;
  const staff = await listStaff(controlDb(env));
  const admin = staffRole === "admin";
  return (
    <BackShell env={env} email={email} staffRole={staffRole} active="staff">
      <h1 className="mb-1 text-[28px] font-bold leading-tight">ทีมงาน PlanBaan</h1>
      <p className="mb-5 max-w-2xl text-sm text-ops-muted">admin สร้างโครงการ ต่อสิทธิ์ และจัดการทีม · support ดูสถิติและบันทึกยอดซื้อ · ทั้งสองแบบไม่เห็นข้อมูลลูกค้าของโครงการ เว้นแต่ลูกค้าเปิดสิทธิ์ให้</p>
      <BackNotice error={error} msg={msg} />
      <div className={`max-w-2xl ${opsCard}`}>
        <ul className="flex flex-col divide-y divide-ops-line text-sm">
          {cfg().initialAdmin && (
            <li className="flex min-h-14 items-center justify-between gap-2 px-5"><span className="font-medium">{cfg().initialAdmin}</span><span className="text-ops-muted">admin (ตั้งในระบบ)</span></li>
          )}
          {staff.map((s) => (
            <li key={s.email} className="flex min-h-14 items-center justify-between gap-2 px-5">
              <span><span className="font-medium">{s.email}</span> <span className="text-ops-muted">· {s.role}</span></span>
              {admin && s.email !== email && (
                <form action={staffAction}><input type="hidden" name="email" value={s.email} /><input type="hidden" name="remove" value="1" />
                  <button className="min-h-10 rounded-lg px-3 text-[13px] font-medium text-red-700 underline">นำออก</button></form>
              )}
            </li>
          ))}
        </ul>
        {admin && (
          <form action={staffAction} className="flex flex-wrap items-end gap-2 border-t border-ops-line p-5 text-sm">
            <label className="flex flex-col gap-1">อีเมล<input name="email" type="email" required className={opsInput} /></label>
            <label className="flex flex-col gap-1">บทบาท<select name="role" className={opsInput}><option value="support">support</option><option value="admin">admin</option></select></label>
            <button className={opsBtnLine}>เพิ่มหรือเปลี่ยนบทบาท</button>
          </form>
        )}
      </div>
    </BackShell>
  );
}
