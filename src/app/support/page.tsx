import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { GRANT_HOURS, activeSupportGrant, createSupportGrant, listAccessLog, revokeSupportGrants } from "@/lib/control";
import { canGrantSupport } from "@/lib/roles";

export const dynamic = "force-dynamic";

async function guard() {
  const ctx = await requireProject({ action: "support_settings" });
  if (!canGrantSupport(ctx.role)) redirect("/");
  return ctx;
}

async function grantAction(form: FormData) {
  "use server";
  const ctx = await guard();
  try {
    await createSupportGrant(controlDb(ctx.env), {
      projectId: ctx.project.id, grantedBy: ctx.email, hours: Number(form.get("hours")),
      canEdit: form.get("can_edit") === "on", reason: String(form.get("reason") ?? ""),
    });
    await ctx.usage("support_granted");
  } catch (e) { redirect(`/support?error=${encodeURIComponent((e as Error).message)}`); }
  revalidatePath("/support");
  redirect("/support");
}

async function revokeAction() {
  "use server";
  const ctx = await guard();
  await revokeSupportGrants(controlDb(ctx.env), ctx.project.id);
  await ctx.usage("support_revoked");
  revalidatePath("/support");
  redirect("/support");
}

const fmt = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await guard();
  const { error } = await searchParams;
  const db = controlDb(ctx.env);
  const [grant, log] = await Promise.all([activeSupportGrant(db, ctx.project.id), listAccessLog(db, ctx.project.id)]);
  return (
    <ProjectShell ctx={ctx} active="/support">
      <h1 className="mb-1 text-2xl font-bold">สิทธิ์ทีมช่วยเหลือ</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        ทีม PlanBaan เข้าดูข้อมูลโครงการไม่ได้ เว้นแต่คุณเปิดสิทธิ์ให้ชั่วคราวจากหน้านี้ ทุกครั้งที่ทีมเข้าถึงข้อมูลจะถูกบันทึกไว้ด้านล่าง
      </p>
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {grant ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-amber-400 bg-white p-4">
          <div>
            <div className="font-semibold">เปิดสิทธิ์อยู่ ({grant.can_edit ? "แก้ไขได้" : "ดูอย่างเดียว"})</div>
            <div className="text-sm text-slate-600">หมดอายุ {fmt(grant.expires_at)}{grant.reason ? ` · ${grant.reason}` : ""}</div>
          </div>
          <form action={revokeAction}><button className="min-h-11 rounded-md bg-red-700 px-4 font-semibold text-white">ยกเลิกสิทธิ์ทันที</button></form>
        </div>
      ) : (
        <form action={grantAction} className="mb-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="font-semibold">เปิดสิทธิ์ให้ทีมช่วยเหลือ</div>
          <label className="flex flex-col gap-1 text-sm">ระยะเวลา
            <select name="hours" defaultValue="24" className="min-h-11 max-w-48 rounded-md border border-slate-300 px-3">
              {GRANT_HOURS.map((h) => <option key={h} value={h}>{h} ชั่วโมง</option>)}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="can_edit" className="h-5 w-5" /> อนุญาตให้แก้ไขข้อมูลได้ (ไม่ติ๊ก = ดูอย่างเดียว)
          </label>
          <label className="flex flex-col gap-1 text-sm">เหตุผล (ไม่บังคับ)
            <input name="reason" maxLength={300} className="min-h-11 rounded-md border border-slate-300 px-3" placeholder="เช่น ช่วยนำเข้าข้อมูลแปลง" />
          </label>
          <button className="min-h-11 self-start rounded-md bg-brand-600 px-4 font-semibold text-white">เปิดสิทธิ์</button>
        </form>
      )}

      <h2 className="mb-1 text-lg font-semibold">บันทึกการเข้าถึงของทีมช่วยเหลือ</h2>
      <p className="mb-2 text-sm text-slate-600">บันทึกที่เก่ากว่า 1 ปีย้ายไปเก็บถาวร ดาวน์โหลดได้ที่หน้าส่งออกข้อมูล</p>
      {log.length === 0 ? <p className="text-sm text-slate-600">ยังไม่มีการเข้าถึง</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-slate-600"><th className="p-3 font-medium">เวลา</th><th className="p-3 font-medium">ผู้เข้าถึง</th><th className="p-3 font-medium">การกระทำ</th><th className="p-3 font-medium">หน้า</th></tr></thead>
            <tbody>{log.map((l, i) => (
              <tr key={i} className="border-t border-slate-200"><td className="p-3">{fmt(l.at)}</td><td className="p-3">{l.actor}</td><td className="p-3">{l.action}</td><td className="p-3">{l.target}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </ProjectShell>
  );
}
