import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { BuildTabs } from "@/components/BuildTabs";
import { requireCosts } from "@/lib/costs-access";
import { back, baht, errMsg, fv } from "@/lib/form";
import * as K from "@/lib/costs";
import { stagesOf } from "@/lib/construction";
import { bkkDate } from "@/lib/sales";

export const dynamic = "force-dynamic";
const here = (id: string) => `/build/${id}/costs`;

async function addAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  const { ctx } = await requireCosts(here(id), true);
  try {
    await K.addCosts(ctx.db, { buildIds: [id], category: fv(f, "category"), item: fv(f, "item"), amount: fv(f, "amount"), date: fv(f, "date"), stageId: fv(f, "stage") || undefined }, ctx.email);
  } catch (e) { back(here(id), { error: errMsg(e) }); }
  revalidatePath(here(id));
  back(here(id), { msg: "บันทึกต้นทุนแล้ว" });
}
async function removeAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  const { ctx } = await requireCosts(here(id), true);
  let n = 0;
  try { n = await K.removeCost(ctx.db, fv(f, "cost")); } catch (e) { back(here(id), { error: errMsg(e) }); }
  revalidatePath(here(id));
  back(here(id), { msg: n > 1 ? `ลบรายการแล้ว (รายการนี้แบ่งไว้ ${n} หลัง ลบออกทุกหลัง)` : "ลบรายการแล้ว" });
}

const thDay = (d: unknown) => new Date(`${String(d)}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
const input = "min-h-11 rounded-lg border border-slate-300 bg-white px-3";

export default async function BuildCosts({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { id } = await params;
  const { ctx, canEdit } = await requireCosts(here(id));
  const sp = await searchParams;
  await ctx.usage("page_view", { page: "build_costs" });
  const [rep, stages] = await Promise.all([K.profitReport(ctx.db, { kind: ctx.project.kind }), stagesOf(ctx.db, id)]);
  const r = rep.rows.find((x) => x.build.id === id);
  if (!r) notFound();
  const b = r.build;
  const mine = rep.costs.filter((c) => c.build_id === id).sort((x, y) => String(y.cost_date).localeCompare(String(x.cost_date)) || String(y.created_at).localeCompare(String(x.created_at)));
  const stageName = new Map(stages.map((s) => [s.id, String(s.name)]));
  const warns = r.lines.filter((l) => l.paceWarn > 0);
  const pct = Math.round(r.progress * 100);
  const confirmed = r.revenue - (Number(b.contract_price) || Number(rep.plots.find((p) => p.code === b.plot_code)?.price ?? 0));
  const good = r.margin >= 15, ok = r.margin >= 10;
  const plotArea = Number(rep.plots.find((p) => p.code === b.plot_code)?.area_sqw ?? 0);

  return (
    <ProjectShell ctx={ctx} active="/build">
      <Link href="/build" className="text-sm font-medium text-brand-700 underline">ก่อสร้างทั้งหมด</Link>
      <div className="mb-3 mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[28px] font-bold leading-tight">{String(b.title)}</h1>
        <span className="text-sm text-slate-600">{b.customer_name ? `${b.customer_name} · ` : ""}งานคืบหน้า {pct}%{r.done ? " · ส่งมอบแล้ว" : ""}</span>
      </div>
      <BuildTabs id={id} active="costs" showCosts />
      <Notice error={sp.error} msg={sp.msg} />

      <section aria-label="สรุปกำไร" className="mb-4 grid grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3">
        <div className="flex flex-col gap-1 border-b border-slate-100 p-5 sm:border-b-0 sm:border-r">
          <span className="text-[13px] text-slate-600">รายรับ</span>
          <span className="text-[26px] font-bold tabular-nums">{baht(r.revenue)}</span>
          <span className="text-xs text-slate-600">ราคาขาย {baht(r.revenue - confirmed)}{confirmed ? ` ${confirmed > 0 ? "+" : "−"} งานเพิ่ม-ลดที่ยืนยัน ${baht(Math.abs(confirmed))}` : ""}</span>
        </div>
        <div className="flex flex-col gap-1 border-b border-slate-100 p-5 sm:border-b-0 sm:border-r">
          <span className="text-[13px] text-slate-600">ต้นทุน{r.done ? "ทั้งหมด" : "ถึงวันนี้"}</span>
          <span className="text-[26px] font-bold tabular-nums">{baht(r.actualTotal)}</span>
          <span className="text-xs text-slate-600">{r.budgetTotal > 0 ? `${Math.round((r.actualTotal / r.budgetTotal) * 100)}% ของงบต้นทุน ${baht(r.budgetTotal)}` : "ยังไม่ได้ตั้งงบ"}</span>
        </div>
        <div className={`flex flex-col gap-1 p-5 ${good ? "bg-emerald-50 text-emerald-900" : ok ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-900"}`}>
          <span className="text-[13px]">{r.done ? "กำไรขั้นต้น" : "กำไรขั้นต้นคาดการณ์"}</span>
          <span className="text-[30px] font-bold tabular-nums">{baht(r.profit)} <span className="text-lg">({r.margin.toFixed(1)}%)</span></span>
          <span className="text-xs">{r.done ? "รายรับ − ต้นทุนจริงทั้งหมด" : "ต้นทุนจริงถึงวันนี้ + งบที่ยังไม่ได้ใช้"}</span>
        </div>
      </section>

      {warns.map((w) => (
        <p key={w.cat} role="status" className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          <b>{K.CAT_LABEL[w.cat]}ใช้ไปแล้ว {Math.round((w.actual / w.budget) * 100)}% ของงบ</b> แต่งานคืบหน้า {pct}% ถ้ายังใช้ในอัตรานี้ จะเกินงบประมาณ {baht(w.paceWarn)} บาทเมื่อจบงาน
        </p>
      ))}

      <section className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
          <h2 className="text-base font-bold">งบเทียบจริงตามหมวด</h2>
          <Link href="/profit#budgets" className="text-sm font-medium text-brand-700 underline">ตั้งงบตามแบบบ้าน</Link>
        </div>
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left text-[13px] text-slate-600">
            <th className="px-5 py-2.5 font-semibold">หมวด</th><th className="px-3 py-2.5 text-right font-semibold">งบ</th><th className="px-3 py-2.5 text-right font-semibold">ใช้จริง</th>
            <th className="w-1/3 px-3 py-2.5 font-semibold">ใช้ไปแล้ว</th><th className="px-5 py-2.5 text-right font-semibold">คงเหลือ</th>
          </tr></thead>
          <tbody>
            {r.lines.map((l) => {
              const p = l.budget > 0 ? Math.round((l.actual / l.budget) * 100) : 0;
              const over = !l.auto && l.budget > 0 && l.actual > l.budget;
              return (
                <tr key={l.cat} className="border-t border-slate-100">
                  <td className="px-5 py-2.5"><div className="font-semibold">{K.CAT_LABEL[l.cat]}</div>
                    {l.auto && <div className="text-xs text-slate-600">{
                      l.cat === "land" ? (rep.landMode === "area" ? `ราคาที่ดินรวม หารตามเนื้อที่ ${plotArea} ตร.ว.` : "ใส่รายแปลงที่หน้ากำไรรายหลัง")
                      : l.cat === "shared" ? (rep.sharedMode === "area" ? `ค่าส่วนกลาง หารตามเนื้อที่ ${plotArea} ตร.ว.` : `ค่าส่วนกลาง ÷ ${rep.sharedDiv} ${ctx.project.kind === "builder" ? "หลัง" : "แปลง"}`)
                      : "ระบบคิดจากต้นทุนต่อการจองของช่องทางลูกค้า"}</div>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.budget ? baht(l.budget) : "–"}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${over ? "text-red-700" : ""}`}>{l.actual ? baht(l.actual) : "–"}</td>
                  <td className="px-3 py-2.5">
                    {l.budget > 0 && <div className="flex items-center gap-2">
                      <span className="block h-2 flex-1 rounded bg-slate-100" aria-hidden="true"><span className={`block h-2 rounded ${over ? "bg-red-600" : l.paceWarn ? "bg-amber-500" : l.auto ? "bg-slate-400" : "bg-brand-600"}`} style={{ width: `${Math.min(p, 100)}%` }} /></span>
                      <span className="w-11 text-right text-xs tabular-nums text-slate-700">{p}%</span>
                    </div>}
                  </td>
                  <td className={`px-5 py-2.5 text-right tabular-nums ${over ? "font-semibold text-red-700" : "text-slate-700"}`}>{l.budget ? (over ? `เกิน ${baht(l.actual - l.budget)}` : baht(l.budget - l.actual)) : "–"}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 font-bold">
              <td className="px-5 py-3">รวม</td><td className="px-3 py-3 text-right tabular-nums">{baht(r.budgetTotal)}</td><td className="px-3 py-3 text-right tabular-nums">{baht(r.actualTotal)}</td>
              <td className="px-3 py-3 text-xs text-slate-700">{r.budgetTotal ? `${Math.round((r.actualTotal / r.budgetTotal) * 100)}%` : ""}</td><td className="px-5 py-3 text-right tabular-nums">{baht(Math.max(0, r.budgetTotal - r.actualTotal))}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {canEdit && (
          <form action={addAction} className="grid grid-cols-1 content-start gap-3 rounded-xl border border-slate-200 bg-white p-5 text-sm sm:grid-cols-2">
            <input type="hidden" name="build" value={id} />
            <div className="flex flex-wrap items-baseline justify-between gap-2 sm:col-span-2">
              <h2 className="text-base font-bold">บันทึกต้นทุน</h2>
              <Link href={`/costs/new?build=${id}`} className="text-sm font-medium text-brand-700 underline">ซื้อรวมหลายหลัง</Link>
            </div>
            <label className="flex flex-col gap-1">วันที่<input type="date" name="date" required defaultValue={bkkDate()} className={input} /></label>
            <label className="flex flex-col gap-1">หมวด<select name="category" className={input}>{K.MANUAL_CATS.map((c) => <option key={c} value={c}>{K.CAT_LABEL[c]}</option>)}</select></label>
            <label className="flex flex-col gap-1">งวดงาน (ถ้ามี)<select name="stage" className={input}><option value="">ไม่ระบุ</option>{stages.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}</select></label>
            <label className="flex flex-col gap-1">จำนวนเงิน (บาท)<input name="amount" required inputMode="decimal" className={`${input} text-right tabular-nums`} /></label>
            <label className="flex flex-col gap-1 sm:col-span-2">รายการ<input name="item" required maxLength={200} placeholder="เช่น กระเบื้องหลังคา 12 ตร.ม." className={input} /></label>
            <button className="min-h-11 rounded-lg bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 sm:col-span-2">บันทึก</button>
          </form>
        )}
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-2 text-base font-bold">รายการต้นทุน ({mine.length})</h2>
          {mine.length === 0 && <p className="text-slate-600">ยังไม่มีรายการ</p>}
          <ul className="flex flex-col divide-y divide-slate-100">
            {mine.slice(0, 100).map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                <span className="flex flex-col">
                  <span className="font-medium">{String(c.item)}</span>
                  <span className="text-xs text-slate-600">{thDay(c.cost_date)} · {K.CAT_LABEL[c.category as K.CostCat]}{c.stage_id ? ` · ${stageName.get(String(c.stage_id)) ?? ""}` : ""} · {String(c.entered_by)}</span>
                </span>
                <span className="flex items-center gap-3 whitespace-nowrap">
                  <b className="tabular-nums">{baht(c.amount)}</b>
                  {canEdit && <form action={removeAction}><input type="hidden" name="build" value={id} /><input type="hidden" name="cost" value={String(c.id)} />
                    <button className="min-h-9 px-1 text-xs text-red-700 underline" aria-label={`ลบ ${String(c.item)}`}>ลบ</button></form>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </ProjectShell>
  );
}
