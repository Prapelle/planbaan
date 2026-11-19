import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { listMembers } from "@/lib/control";
import { back, errMsg, fv } from "@/lib/form";
import { canEditData } from "@/lib/roles";
import * as S from "@/lib/sales";
import * as L from "@/lib/loans";

export const dynamic = "force-dynamic";

async function guardEdit(target: string) {
  const ctx = await requireProject({ action: "edit", target });
  if (!(canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly)) back("/leads", { error: "ไม่มีสิทธิ์แก้ไขข้อมูลลูกค้า" });
  return ctx;
}

async function createAction(f: FormData) {
  "use server";
  const ctx = await guardEdit("/leads");
  try {
    await S.createLead(ctx.db, { name: fv(f, "name"), phone: fv(f, "phone"), channel: fv(f, "channel"), plotCode: fv(f, "plot_code"), nextFollowAt: fv(f, "next_follow_at"), note: fv(f, "note") }, ctx.email, { allowDuplicate: fv(f, "allow_dup") === "1" });
    await ctx.usage("lead_created", { channel: fv(f, "channel") });
  } catch (e) {
    // เบอร์ซ้ำ: กลับมาที่ฟอร์มพร้อมค่าที่กรอกไว้ และลิงก์ลูกค้ารายเดิม
    if (e instanceof S.DuplicatePhoneError) back("/leads", { error: e.message, extra: { dup: e.lead.id, f_name: fv(f, "name"), f_phone: fv(f, "phone"), f_channel: fv(f, "channel"), f_plot: fv(f, "plot_code"), f_follow: fv(f, "next_follow_at"), f_note: fv(f, "note") } });
    back("/leads", { error: errMsg(e) });
  }
  revalidatePath("/leads");
  back("/leads", { msg: `เพิ่มลูกค้า ${fv(f, "name")} แล้ว` });
}

/** การ์ดลูกค้า: กด "โทรแล้ว" หลังวางสาย = บันทึกการติดต่อหนึ่งครั้ง */
async function calledAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(`/leads/${id}`);
  try { await S.logContact(ctx.db, id, fv(f, "note") || "โทรแล้ว", ctx.email); } catch (e) { back("/leads", { error: errMsg(e) }); }
  revalidatePath("/leads");
  back(`/leads${fv(f, "back")}`, { msg: `บันทึกการโทรหา ${fv(f, "name")} แล้ว` });
}

async function moveAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(`/leads/${id}`);
  try {
    await S.moveLead(ctx.db, id, fv(f, "stage"), ctx.email, { requirePlot: ctx.project.kind !== "builder" });
    await ctx.usage("lead_stage_changed", { to: fv(f, "stage") });
  } catch (e) { back("/leads", { error: errMsg(e) }); }
  revalidatePath("/leads");
  back("/leads", {});
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; mine?: string; error?: string; msg?: string; stage?: string; dup?: string; f_name?: string; f_phone?: string; f_channel?: string; f_plot?: string; f_follow?: string; f_note?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/leads" });
  await ctx.usage("page_view", { page: "leads" });
  const sp = await searchParams;
  const { q, mine, error, msg } = sp;
  const canEdit = (canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly);
  const [all, plots, members, apps] = await Promise.all([
    ctx.db.list("leads", { limit: 2000, orderBy: "updated_at", desc: true }),
    ctx.db.list("plots", { limit: 2000 }),
    listMembers(controlDb(ctx.env), ctx.project.id),
    ctx.db.list("loan_apps", { limit: 2000 }),
  ]);
  plots.sort(S.byCode);
  const query = (q ?? "").trim().toLowerCase();
  const qDigits = query.replace(/\D/g, "");
  const leads = all.filter((l) =>
    (!query || String(l.name).toLowerCase().includes(query) || (qDigits.length >= 3 && String(l.phone).replace(/\D/g, "").includes(qDigits.replace(/^66/, "0").replace(/^0/, ""))) || String(l.plot_code).toLowerCase() === query) &&
    (mine !== "1" || l.owner_email === ctx.email));
  const now = new Date();
  const nameOf = (email: unknown) => (members.find((m) => m.email === email)?.email ?? String(email)).split("@")[0];
  const columns = [...S.PIPELINE, "lost" as const];
  const LB = S.stageLabels(ctx.project.kind);
  // มือถือ: แสดงทีละขั้น (แท็บ) · ค้นหาอยู่: แสดงผลทุกขั้นเป็นรายการเดียว
  const countOf = (s: string) => leads.filter((l) => l.stage === s).length;
  const selStage = columns.find((s) => s === sp.stage) ?? S.PIPELINE.find((s) => countOf(s) > 0) ?? "new";
  const keepQs = (extra: Record<string, string>) => { const u = new URLSearchParams({ ...(q ? { q } : {}), ...(mine === "1" ? { mine: "1" } : {}), ...extra }); const t = u.toString(); return t ? `?${t}` : ""; };
  const dup = sp.dup ? all.find((l) => l.id === sp.dup) : null;

  return (
    <ProjectShell ctx={ctx} active="/leads">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ลูกค้า</h1>
          <p className="text-sm text-slate-600">ทั้งหมด {all.length} ราย · ค้างติดตามเกิน {S.STALE_DAYS} วันมีป้ายสีแดง</p>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-sm" role="search">
          <label className="hidden flex-col gap-1 md:flex">ค้นหา<input name="q" defaultValue={q} placeholder="ชื่อ เบอร์ หรือรหัสแปลง" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="mine" value="1" defaultChecked={mine === "1"} className="h-5 w-5" /> เฉพาะของฉัน</label>
          <button className="min-h-11 rounded-md border border-slate-300 px-4 font-medium">กรอง</button>
        </form>
      </div>
      <Notice error={error} msg={msg} />

      {canEdit && (
        <details className="mb-4 rounded-lg border border-slate-200 bg-white p-4" open={all.length === 0 || !!dup}>
          <summary className="min-h-11 cursor-pointer content-center font-semibold">+ เพิ่มลูกค้า <Link href="/import?type=leads" className="ml-3 text-sm font-medium text-brand-700 underline">นำเข้าจาก Excel</Link></summary>
          <form action={createAction} className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1">ชื่อ *<input name="name" required maxLength={120} defaultValue={sp.f_name ?? ""} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
            <label className="flex flex-col gap-1">เบอร์โทร<input name="phone" inputMode="tel" defaultValue={sp.f_phone ?? ""} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
            <label className="flex flex-col gap-1">มาจากช่องทาง
              <select name="channel" defaultValue={sp.f_channel || "facebook"} className="min-h-11 rounded-md border border-slate-300 px-3">
                {S.CHANNELS.map((c) => <option key={c} value={c}>{S.CHANNEL_LABEL[c]}</option>)}
              </select>
            </label>
            {ctx.project.kind !== "builder" && <label className="flex flex-col gap-1">แปลงที่สนใจ
              <select name="plot_code" defaultValue={sp.f_plot ?? ""} className="min-h-11 rounded-md border border-slate-300 px-3">
                <option value="">ยังไม่เลือก</option>
                {plots.map((p) => <option key={p.id} value={String(p.code)}>{String(p.code)} · {S.SALE_LABEL[p.sale_status as S.SaleStatus]}</option>)}
              </select>
            </label>}
            <label className="flex flex-col gap-1">นัดติดตามครั้งถัดไป<input name="next_follow_at" type="date" defaultValue={sp.f_follow ?? ""} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
            <label className="flex flex-col gap-1">หมายเหตุ<input name="note" maxLength={1000} defaultValue={sp.f_note ?? ""} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
            {dup && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 sm:col-span-2 lg:col-span-3">
                เบอร์นี้เป็นของ <Link href={`/leads/${dup.id}`} className="font-semibold text-brand-700 underline">{String(dup.name)}</Link> ({LB[dup.stage as S.Stage]} · ดูแลโดย {nameOf(dup.owner_email)}) ถ้าเป็นคนเดียวกัน ให้บันทึกการติดต่อในรายเดิมแทน
                <label className="mt-2 flex min-h-10 items-center gap-2"><input type="checkbox" name="allow_dup" value="1" className="h-5 w-5" />เป็นคนละคน เพิ่มเป็นลูกค้าใหม่</label>
              </div>
            )}
            <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white sm:col-span-2 lg:col-span-1 lg:col-start-3">บันทึกลูกค้า</button>
          </form>
        </details>
      )}

      {query && <p className="mb-3 text-sm">ผลค้นหา "{q}" {leads.length} ราย · <Link href={`/leads${mine === "1" ? "?mine=1" : ""}`} className="text-brand-700 underline">ล้างการค้นหา</Link></p>}
      {!query && (
        <nav aria-label="ขั้นของลูกค้า" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
          {columns.map((s) => (
            <Link key={s} href={`/leads${keepQs({ stage: s })}`} aria-current={s === selStage ? "page" : undefined}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${s === selStage ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
              {LB[s]} <span className={`rounded-full px-1.5 text-xs ${s === selStage ? "bg-white/20" : "bg-slate-100"}`}>{countOf(s)}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="md:overflow-x-auto md:pb-2">
        <div className="flex flex-col gap-3 md:min-w-[1200px] md:flex-row md:items-start">
          {columns.map((stage) => {
            const cards = leads.filter((l) => l.stage === stage);
            const onMobile = query ? cards.length > 0 : stage === selStage;
            return (
              <section key={stage} aria-label={S.stageLabels(ctx.project.kind)[stage]} className={`${onMobile ? "flex" : "hidden"} min-w-0 flex-1 flex-col gap-2 rounded-lg bg-slate-200/70 p-2 md:flex`}>
                <h2 className="flex justify-between px-1 text-sm font-semibold"><span>{S.stageLabels(ctx.project.kind)[stage]}</span><span className="text-slate-600">{cards.length}</span></h2>
                {cards.length === 0 && <p className="px-1 pb-1 text-xs text-slate-600 md:hidden">ไม่มีลูกค้าในขั้นนี้</p>}
                {cards.map((l) => {
                  const stale = S.isStale(l, now, ctx.project.kind);
                  const prev = S.neighborStage(stage, -1), next = S.neighborStage(stage, 1);
                  return (
                    <article key={l.id} className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 text-sm">
                      <Link href={`/leads/${l.id}`} className="font-semibold text-slate-900 underline-offset-2 hover:underline">{String(l.name)}</Link>
                      <span className="text-xs text-slate-600">{S.CHANNEL_LABEL[l.channel as S.Channel] ?? String(l.channel)}{ctx.project.kind === "builder" ? "" : ` · ${String(l.plot_code) || "ยังไม่เลือกแปลง"}`}</span>
                      <span className="text-xs text-slate-600">ดูแลโดย {nameOf(l.owner_email)}</span>
                      {stage === "lost" && !!l.lost_reason && <span className="text-xs text-slate-700">{S.lostLabels(ctx.project.kind)[l.lost_reason as S.LostReason] ?? ""}</span>}
                      {stale && <span className="text-xs font-semibold text-red-700">ค้าง {S.daysSince(String(l.last_contact_at), now)} วัน</span>}
                      {!!l.next_follow_at && !S.isClosed(stage) && <span className="text-xs">นัด {String(l.next_follow_at)}</span>}
                      {stage === "loan" && (() => {
                        const sum = L.summarize(l, apps.filter((a) => a.lead_id === l.id), now);
                        return <Link href={`/loans?lead=${l.id}`} className={`text-xs font-semibold underline ${sum.allRejected ? "text-red-700" : "text-slate-800"}`}>
                          {sum.allRejected ? "ไม่ผ่านทุกธนาคาร · แก้หนี้" : `ยื่น ${sum.filed} · อนุมัติ ${sum.approved} · รอผล ${sum.waiting}`}
                        </Link>;
                      })()}
                      {!S.isClosed(stage) && !!l.phone && (
                        <div className="mt-1 flex gap-1">
                          <a href={`tel:${String(l.phone)}`} className="flex min-h-10 flex-1 items-center justify-center gap-1 rounded border border-emerald-600 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">โทร {String(l.phone)}</a>
                          {canEdit && (
                            <form action={calledAction} className="flex-1">
                              <input type="hidden" name="id" value={l.id} /><input type="hidden" name="name" value={String(l.name)} />
                              <input type="hidden" name="back" value={keepQs(query ? {} : { stage })} />
                              <button className="min-h-10 w-full rounded border border-slate-300 bg-white text-xs font-semibold hover:bg-slate-100">โทรแล้ว ✓</button>
                            </form>
                          )}
                        </div>
                      )}
                      {canEdit && (
                        <div className="mt-1 flex gap-1">
                          {prev && (
                            <form action={moveAction} className="flex-1">
                              <input type="hidden" name="id" value={l.id} /><input type="hidden" name="stage" value={prev} />
                              <button aria-label={`ย้อนไป ${S.stageLabels(ctx.project.kind)[prev]}`} className="min-h-10 w-full rounded border border-slate-300 text-xs">‹ ย้อน</button>
                            </form>
                          )}
                          {next && (
                            <form action={moveAction} className="flex-1">
                              <input type="hidden" name="id" value={l.id} /><input type="hidden" name="stage" value={next} />
                              <button aria-label={`เลื่อนไป ${S.stageLabels(ctx.project.kind)[next]}`} className="min-h-10 w-full rounded bg-brand-600 text-xs font-semibold text-white">{S.stageLabels(ctx.project.kind)[next]} ›</button>
                            </form>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </ProjectShell>
  );
}
