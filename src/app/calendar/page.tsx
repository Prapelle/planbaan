import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { back, errMsg, fv } from "@/lib/form";
import * as Cal from "@/lib/calendar";
import { shiftMonth, thisMonth } from "@/lib/marketing";
import { bkkDate, isClosed } from "@/lib/sales";

export const dynamic = "force-dynamic";

type Ctx = Awaited<ReturnType<typeof requireProject>>;
/** เพิ่มนัดหมายได้ทุกบทบาทยกเว้นดูอย่างเดียว · ลบได้เฉพาะของตัวเอง หรือเจ้าของ/ผู้จัดการลบได้ทุกนัด */
const canAdd = (ctx: Ctx) => ctx.role !== "viewer" && !ctx.readonly && (ctx.role !== "support" || ctx.access.supportCanEdit);
const canManageAll = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "manager" || (ctx.role === "support" && ctx.access.supportCanEdit);
const here = (month: string, extra = "") => `/calendar?month=${month}${extra}`;

async function addAction(f: FormData) {
  "use server";
  const date = fv(f, "date");
  const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : thisMonth();
  const ctx = await requireProject({ action: "edit", target: here(month) });
  if (!canAdd(ctx)) back(here(month), { error: "ไม่มีสิทธิ์เพิ่มนัดหมาย" });
  // โฟร์แมนผูกนัดกับลูกค้าไม่ได้ (ไม่เห็นข้อมูลลูกค้า)
  try { await Cal.addEvent(ctx.db, { title: fv(f, "title"), date, time: fv(f, "time"), note: fv(f, "note"), leadId: ctx.role === "foreman" ? "" : fv(f, "lead") }, ctx.email); }
  catch (e) { back(`${here(month)}#add`, { error: errMsg(e) }); }
  revalidatePath("/calendar");
  back(here(month), { msg: "เพิ่มนัดหมายแล้ว" });
}
async function removeAction(f: FormData) {
  "use server";
  const month = fv(f, "month") || thisMonth();
  const ctx = await requireProject({ action: "edit", target: here(month) });
  try { await Cal.removeEvent(ctx.db, fv(f, "id"), ctx.email, canManageAll(ctx)); } catch (e) { back(here(month), { error: errMsg(e) }); }
  revalidatePath("/calendar");
  back(here(month), { msg: "ลบนัดหมายแล้ว" });
}

const KIND_CLS: Record<Cal.CalKind, string> = {
  event: "bg-brand-100 text-brand-800",
  follow: "bg-emerald-100 text-emerald-900",
  loan: "bg-amber-100 text-amber-900",
  stage: "bg-slate-200 text-slate-800",
  due: "bg-orange-100 text-orange-900",
};
const WEEK = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const thMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const thDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const input = "min-h-11 rounded-lg border border-slate-300 bg-white px-3";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string; mine?: string; lead?: string; error?: string; msg?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/calendar" });
  await ctx.usage("page_view", { page: "calendar" });
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : (sp.day?.slice(0, 7) ?? thisMonth());
  const mine = sp.mine === "1";
  const today = bkkDate();
  const [items, leads] = await Promise.all([
    Cal.monthItems(ctx.db, month, { construction: !!ctx.project.construction_enabled, mine: mine ? ctx.email : undefined, foreman: ctx.role === "foreman" }),
    canAdd(ctx) && ctx.role !== "foreman" ? ctx.db.list("leads", { limit: 2000, orderBy: "updated_at", desc: true }) : Promise.resolve([]),
  ]);
  const byDay = new Map<string, Cal.CalItem[]>();
  for (const it of items) (byDay.get(it.date) ?? byDay.set(it.date, []).get(it.date)!).push(it);
  const cells = Cal.monthGrid(month);
  const days = [...byDay.keys()].sort();
  const addDate = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : month === thisMonth() ? today : `${month}-01`;
  const openLeads = leads.filter((l) => !isClosed(String(l.stage)));
  const q = (m: string, extra = "") => here(m, `${mine ? "&mine=1" : ""}${extra}`);
  const usedKinds: Cal.CalKind[] = ctx.project.construction_enabled ? ["event", "follow", "loan", "stage", "due"] : ["event", "follow", "loan"];

  return (
    <ProjectShell ctx={ctx} active="/calendar">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight">ปฏิทิน</h1>
          <p className="mt-1 text-sm text-slate-600">วันนัดติดตาม ยื่นกู้ใหม่{ctx.project.construction_enabled ? " งวดงาน และส่งมอบบ้าน" : ""} ดึงมาจากข้อมูลในระบบเอง พร้อมนัดหมายที่เพิ่มเอง</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={q(shiftMonth(month, -1))} className="flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3">‹ ก่อนหน้า</Link>
          <span className="min-w-36 text-center font-semibold">{thMonth(month)}</span>
          <Link href={q(shiftMonth(month, 1))} className="flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3">ถัดไป ›</Link>
          {month !== thisMonth() && <Link href={q(thisMonth())} className="flex min-h-11 items-center rounded-lg px-3 font-medium text-brand-700 underline">เดือนนี้</Link>}
        </div>
      </div>
      <Notice error={sp.error} msg={sp.msg} />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {usedKinds.map((k) => <span key={k} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block h-3 w-3 rounded-sm ${KIND_CLS[k]}`} />{Cal.KIND_LABEL[k]}</span>)}
        <Link href={here(month, mine ? "" : "&mine=1")} aria-pressed={mine}
          className={`ml-auto flex min-h-9 items-center rounded-full border px-3 text-[13px] font-semibold ${mine ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
          {mine ? "เฉพาะของฉัน ✓" : "เฉพาะของฉัน"}
        </Link>
      </div>

      {/* คอม: ตารางทั้งเดือน */}
      <div className="mb-6 hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-600">
          {WEEK.map((w) => <div key={w} className="py-2">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const list = d ? byDay.get(d) ?? [] : [];
            return (
              <div key={i} className={`min-h-[112px] border-b border-r border-slate-100 p-1.5 ${!d ? "bg-slate-50/60" : ""} ${d === today ? "bg-brand-50/60" : ""}`}>
                {d && (
                  <>
                    <Link href={q(month, `&day=${d}#add`)} aria-label={`เพิ่มนัดหมายวันที่ ${thDay(d)}`}
                      className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold hover:bg-slate-200 ${d === today ? "bg-brand-600 text-white hover:bg-brand-700" : "text-slate-700"}`}>{Number(d.slice(8))}</Link>
                    <ul className="flex flex-col gap-0.5">
                      {list.slice(0, 3).map((it, j) => (
                        <li key={j}>
                          <a href={it.href || `#d-${d}`} className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_CLS[it.kind]}`} title={`${Cal.KIND_LABEL[it.kind]}: ${it.title}`}>
                            <span className="sr-only">{Cal.KIND_LABEL[it.kind]}: </span>{it.time ? `${it.time} ` : ""}{it.title}
                          </a>
                        </li>
                      ))}
                      {list.length > 3 && <li><a href={`#d-${d}`} className="px-1.5 text-[11px] font-semibold text-slate-600 underline">อีก {list.length - 3} รายการ</a></li>}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        {/* รายการตามวัน (มือถือใช้ส่วนนี้เป็นหลัก) */}
        <section aria-label="รายการในเดือน" className="flex flex-col gap-3">
          <h2 className="text-base font-bold">รายการเดือน{thMonth(month)}</h2>
          {days.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">ยังไม่มีนัดในเดือนนี้{canAdd(ctx) ? " เพิ่มนัดหมายได้จากกล่องด้านข้าง" : ""}</p>}
          {days.map((d) => (
            <div key={d} id={`d-${d}`} className={`scroll-mt-4 rounded-xl border bg-white p-4 text-sm ${d === today ? "border-brand-500" : d < today ? "border-slate-200 opacity-80" : "border-slate-200"}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="font-bold">{thDay(d)}{d === today ? " · วันนี้" : ""}</h3>
                {canAdd(ctx) && <Link href={q(month, `&day=${d}#add`)} className="text-xs font-medium text-brand-700 underline">เพิ่มนัด</Link>}
              </div>
              <ul className="flex flex-col divide-y divide-slate-100">
                {(byDay.get(d) ?? []).map((it, j) => (
                  <li key={j} className="flex items-start justify-between gap-3 py-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${KIND_CLS[it.kind]}`}>{it.time || Cal.KIND_LABEL[it.kind]}</span>
                      <div className="min-w-0">
                        {it.href ? <Link href={it.href} className="font-semibold text-slate-900 underline-offset-2 hover:underline">{it.title}</Link> : <span className="font-semibold">{it.title}</span>}
                        {(it.sub || it.time) && <div className="text-xs text-slate-600">{it.time ? `${Cal.KIND_LABEL[it.kind]}${it.sub ? " · " : ""}` : ""}{it.sub}</div>}
                      </div>
                    </div>
                    {it.eventId && canAdd(ctx) && (canManageAll(ctx) || it.createdBy === ctx.email) && (
                      <form action={removeAction}><input type="hidden" name="id" value={it.eventId} /><input type="hidden" name="month" value={month} />
                        <button className="min-h-9 shrink-0 px-1 text-xs text-red-700 underline" aria-label={`ลบนัดหมาย ${it.title}`}>ลบ</button></form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {canAdd(ctx) && (
          <form id="add" action={addAction} className="flex scroll-mt-4 flex-col gap-3 self-start rounded-xl border border-slate-200 bg-white p-5 text-sm lg:sticky lg:top-4">
            <h2 className="text-base font-bold">เพิ่มนัดหมาย</h2>
            <label className="flex flex-col gap-1">หัวข้อ<input name="title" required maxLength={120} placeholder="เช่น พาลูกค้าดูบ้านตัวอย่าง" className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">วันที่<input type="date" name="date" required defaultValue={addDate} className={input} /></label>
              <label className="flex flex-col gap-1">เวลา (ถ้ามี)<input type="time" name="time" className={input} /></label>
            </div>
            {ctx.role !== "foreman" && <label className="flex flex-col gap-1">ลูกค้า (ถ้ามี)
              <select name="lead" defaultValue={sp.lead ?? ""} className={input}>
                <option value="">ไม่ผูกลูกค้า</option>
                {openLeads.map((l) => <option key={l.id} value={l.id}>{String(l.name)}{l.plot_code ? ` · ${l.plot_code}` : ""}</option>)}
              </select>
            </label>}
            <label className="flex flex-col gap-1">รายละเอียด<textarea name="note" rows={2} maxLength={1000} className="rounded-lg border border-slate-300 p-3" /></label>
            <button className="min-h-11 rounded-lg bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">เพิ่มนัดหมาย</button>
            <p className="text-xs text-slate-600">นัดติดตามลูกค้าตั้งที่หน้าลูกค้า (ช่อง &quot;นัดติดตามครั้งถัดไป&quot;) แล้วจะขึ้นในปฏิทินเอง</p>
          </form>
        )}
      </div>
    </ProjectShell>
  );
}
