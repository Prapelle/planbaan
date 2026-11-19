import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { listMembers } from "@/lib/control";
import { back, errMsg, fv } from "@/lib/form";
import { canEditData } from "@/lib/roles";
import * as S from "@/lib/sales";

export const dynamic = "force-dynamic";

async function guardEdit(id: string) {
  const ctx = await requireProject({ action: "edit", target: `/leads/${id}` });
  if (!(canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly)) back(`/leads/${id}`, { error: "ไม่มีสิทธิ์แก้ไขข้อมูลลูกค้า" });
  return ctx;
}

async function saveAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(id);
  try {
    await S.updateLead(ctx.db, id, {
      name: fv(f, "name"), phone: fv(f, "phone"), channel: fv(f, "channel"), plotCode: fv(f, "plot_code"),
      ownerEmail: fv(f, "owner_email"), nextFollowAt: fv(f, "next_follow_at"), note: fv(f, "note"),
    }, ctx.email);
    // ใส่บันทึกการติดต่อมาด้วย = นับเป็นการติดต่อ (รีเซ็ตวันค้างติดตาม)
    if (fv(f, "contact")) await S.logContact(ctx.db, id, fv(f, "contact"), ctx.email);
  } catch (e) { back(`/leads/${id}`, { error: errMsg(e) }); }
  revalidatePath(`/leads/${id}`);
  back(`/leads/${id}`, { msg: fv(f, "contact") ? "บันทึกข้อมูลและการติดต่อแล้ว" : "บันทึกข้อมูลแล้ว" });
}

async function stageAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(id);
  try {
    await S.moveLead(ctx.db, id, fv(f, "stage"), ctx.email, { requirePlot: ctx.project.kind !== "builder" });
    await ctx.usage("lead_stage_changed", { to: fv(f, "stage") });
  } catch (e) { back(`/leads/${id}`, { error: errMsg(e) }); }
  revalidatePath(`/leads/${id}`);
  back(`/leads/${id}`, { msg: `เปลี่ยนเป็น ${S.stageLabels(ctx.project.kind)[fv(f, "stage") as S.Stage]} แล้ว` });
}


const when = (iso: unknown) => new Date(String(iso)).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const KIND: Record<string, string> = { created: "เพิ่มลูกค้า", stage: "เปลี่ยนขั้น", contact: "ติดต่อ", edit: "แก้ไขข้อมูล", loan: "สินเชื่อ" };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { id } = await params;
  const ctx = await requireProject({ action: "view", target: `/leads/${id}` });
  const lead = await ctx.db.get("leads", id);
  if (!lead) notFound();
  const { error, msg } = await searchParams;
  const canEdit = (canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly);
  const [plots, members, history] = await Promise.all([
    ctx.db.list("plots", { limit: 2000 }), listMembers(controlDb(ctx.env), ctx.project.id), S.leadHistory(ctx.db, id),
  ]);
  plots.sort(S.byCode);
  const stage = String(lead.stage) as S.Stage;
  const stale = S.isStale(lead);
  const actorName = (a: unknown) => (members.some((m) => m.email === a) ? String(a).split("@")[0] : "ทีมช่วยเหลือ");

  return (
    <ProjectShell ctx={ctx} active="/leads">
      <Link href="/leads" className="mb-3 inline-flex min-h-11 items-center text-sm text-brand-700 underline">‹ กลับหน้าลูกค้า</Link>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{String(lead.name)}</h1>
        <span className="text-sm">ขั้น <b>{S.stageLabels(ctx.project.kind)[stage]}</b>{lead.plot_code ? <> · แปลง <Link href={`/plots?plot=${lead.plot_code}`} className="text-brand-700 underline">{String(lead.plot_code)}</Link></> : null}
          {stale && <span className="ml-2 font-semibold text-red-700">ค้าง {S.daysSince(String(lead.last_contact_at))} วัน</span>}
          {(stage === "booked" || stage === "loan") && ctx.project.kind !== "builder" && <Link href={`/loans?lead=${id}`} className="ml-3 font-semibold text-brand-700 underline">ดูสินเชื่อ</Link>}
          {(stage === "booked" || stage === "loan" || stage === "transferred") && ctx.project.kind === "builder" && !!ctx.project.construction_enabled && <Link href={`/build?lead=${id}`} className="ml-3 font-semibold text-brand-700 underline">งานก่อสร้าง</Link>}</span>
      </div>
      <Notice error={error} msg={msg} />

      {canEdit && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="เปลี่ยนขั้น">
          {[...S.PIPELINE, "lost" as const].map((s) => (
            <form key={s} action={stageAction}>
              <input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value={s} />
              <button disabled={s === stage} aria-pressed={s === stage}
                className={`min-h-10 rounded-full border px-3 text-sm font-medium ${s === stage ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white hover:bg-slate-100"}`}>
                {S.stageLabels(ctx.project.kind)[s]}
              </button>
            </form>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <form action={saveAction} className="grid flex-1 grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={!canEdit} className="contents">
            <label className="flex flex-col gap-1">ชื่อ<input name="name" required defaultValue={String(lead.name)} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
            <label className="flex flex-col gap-1">เบอร์โทร<input name="phone" inputMode="tel" defaultValue={String(lead.phone)} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
            <label className="flex flex-col gap-1">ช่องทาง
              <select name="channel" defaultValue={String(lead.channel)} className="min-h-11 rounded-md border border-slate-300 px-3">
                {S.CHANNELS.map((c) => <option key={c} value={c}>{S.CHANNEL_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">แปลง
              <select name="plot_code" defaultValue={String(lead.plot_code)} className="min-h-11 rounded-md border border-slate-300 px-3">
                <option value="">ยังไม่เลือก</option>
                {plots.map((p) => <option key={p.id} value={String(p.code)}>{String(p.code)} · {S.SALE_LABEL[p.sale_status as S.SaleStatus]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">ผู้ดูแล
              <select name="owner_email" defaultValue={String(lead.owner_email)} className="min-h-11 rounded-md border border-slate-300 px-3">
                {!members.some((m) => m.email === lead.owner_email) && <option value={String(lead.owner_email)}>{String(lead.owner_email) || "ไม่ระบุ"}</option>}
                {members.map((m) => <option key={m.email} value={m.email}>{m.email}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">นัดติดตามครั้งถัดไป<input name="next_follow_at" type="date" defaultValue={String(lead.next_follow_at)} className="min-h-11 rounded-md border border-slate-300 px-3" />
              <Link href={`/calendar?lead=${id}#add`} className="text-xs font-medium text-brand-700 underline">เพิ่มนัดหมายพร้อมเวลาในปฏิทิน</Link></label>
            <label className="flex flex-col gap-1 sm:col-span-2">หมายเหตุเกี่ยวกับลูกค้า<textarea name="note" rows={2} maxLength={1000} defaultValue={String(lead.note)} className="rounded-md border border-slate-300 p-3" /></label>
            {canEdit && (
              <label className="flex flex-col gap-1 rounded-md bg-brand-50 p-3 sm:col-span-2">
                <span className="font-semibold text-brand-800">บันทึกการติดต่อครั้งนี้ (ถ้ามี)</span>
                <textarea name="contact" rows={2} maxLength={1000} placeholder="เช่น โทรแล้ว ลูกค้าขอดูแบบบ้านอีกครั้ง" className="rounded-md border border-slate-300 bg-white p-3" />
                <span className="text-xs text-slate-600">ใส่ข้อความแล้วนับเป็นการติดต่อ ป้ายค้างติดตามจะหายไป</span>
              </label>
            )}
            {canEdit && <button className="min-h-12 rounded-md bg-brand-600 px-4 text-base font-semibold text-white hover:bg-brand-700 sm:col-span-2">บันทึก</button>}
          </fieldset>
        </form>

        <div className="flex flex-1 flex-col gap-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">ประวัติ</h2>
            {S.daysSince(String(lead.created_at)) > Number(process.env.ARCHIVE_DAYS ?? 365) && (
              <p className="mb-2 text-xs text-slate-600">ประวัติที่เก่ากว่า 1 ปีย้ายไปเก็บถาวรแล้ว เจ้าของโครงการดาวน์โหลดได้ที่หน้าส่งออกข้อมูล</p>
            )}
            <ol className="flex flex-col gap-2">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-slate-300 pl-3">
                  <div className="text-xs text-slate-600">{when(h.created_at)} · {actorName(h.actor)}</div>
                  <div>{KIND[String(h.kind)] ?? String(h.kind)}
                    {h.kind === "stage" && <> {S.stageLabels(ctx.project.kind)[h.from_stage as S.Stage]} → <b>{S.stageLabels(ctx.project.kind)[h.to_stage as S.Stage]}</b></>}
                    {h.kind === "created" && <> ที่ขั้น {S.stageLabels(ctx.project.kind)[h.to_stage as S.Stage]}</>}
                  </div>
                  {!!h.note && <div className="whitespace-pre-line">{String(h.note)}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </ProjectShell>
  );
}
