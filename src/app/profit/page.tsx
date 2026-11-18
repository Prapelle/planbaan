import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireCosts } from "@/lib/costs-access";
import { back, baht, errMsg, fv } from "@/lib/form";
import * as K from "@/lib/costs";
import { byCode } from "@/lib/sales";

export const dynamic = "force-dynamic";
const PATH = "/profit";

async function budgetAction(f: FormData) {
  "use server";
  const { ctx } = await requireCosts(PATH, true);
  const amounts = Object.fromEntries(K.MANUAL_CATS.map((c) => [c, fv(f, `b_${c}`)]));
  try { await K.setBudgetTemplate(ctx.db, fv(f, "house_type"), amounts); } catch (e) { back(`${PATH}#budgets`, { error: errMsg(e) }); }
  revalidatePath(PATH);
  back(PATH, { msg: `บันทึกงบ${fv(f, "house_type") ? `แบบ ${fv(f, "house_type")}` : "ทั่วไป"}แล้ว` });
}
async function sharedAction(f: FormData) {
  "use server";
  const { ctx } = await requireCosts(PATH, true);
  try {
    await K.setSetting(ctx.db, "shared_total", fv(f, "shared"));
    if (f.has("shared_mode")) await K.setSetting(ctx.db, "shared_mode", fv(f, "shared_mode"));
  } catch (e) { back(`${PATH}#shared`, { error: errMsg(e) }); }
  revalidatePath(PATH);
  back(PATH, { msg: "บันทึกค่าส่วนกลางแล้ว" });
}
/** ที่ดิน: วิธีใส่ (รายแปลง/หารตามตร.ว.) + ราคารวม + ตร.ว. และต้นทุนที่ดินของแต่ละแปลง */
async function landAction(f: FormData) {
  "use server";
  const { ctx } = await requireCosts(PATH, true);
  const rows: Record<string, { area?: string; land?: string }> = {};
  for (const [k, v] of f.entries()) {
    const m = /^(area|land)_(.+)$/.exec(k);
    if (m) (rows[m[2]] ??= {})[m[1] as "area" | "land"] = String(v);
  }
  let n = 0;
  try {
    await K.setSetting(ctx.db, "land_mode", fv(f, "land_mode"));
    if (f.has("land_total")) await K.setSetting(ctx.db, "land_total", fv(f, "land_total"));
    n = await K.setPlotLand(ctx.db, rows);
  } catch (e) { back(`${PATH}#land`, { error: errMsg(e) }); }
  revalidatePath(PATH);
  back(PATH, { msg: `บันทึกที่ดินและเนื้อที่แล้ว (เปลี่ยน ${n} แปลง)` });
}

const input = "min-h-11 rounded-lg border border-slate-300 bg-white px-3";
const radio = "flex min-h-11 cursor-pointer items-center rounded-full border border-slate-300 bg-white px-4 font-medium text-slate-700 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:font-semibold has-[:checked]:text-brand-800 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500";

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { ctx, canEdit } = await requireCosts(PATH);
  await ctx.usage("page_view", { page: "profit" });
  const sp = await searchParams;
  const builder = ctx.project.kind === "builder";
  const rep = await K.profitReport(ctx.db, { kind: ctx.project.kind });
  const t = rep.totals;
  const typeRows = builder ? [""] : [...rep.houseTypes, ""];
  const budgetOf = (ht: string, cat: string) => rep.budgets.find((b) => b.house_type === ht && b.category === cat)?.amount;
  const plots = [...rep.plots].sort(byCode);
  const marginCls = (m: number) => (m < 10 ? "text-red-700" : m < 15 ? "text-amber-700" : "text-emerald-700");
  const barCls = (m: number) => (m < 10 ? "bg-red-600" : m < 15 ? "bg-amber-500" : "bg-emerald-600");

  return (
    <ProjectShell ctx={ctx} active="/profit">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight">กำไรรายหลัง</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">หลังที่ยังสร้างใช้กำไรคาดการณ์ (ต้นทุนจริง + งบที่เหลือ) หลังที่ส่งมอบแล้วใช้ต้นทุนจริง เรียงกำไรน้อยไปมาก · เห็นเฉพาะเจ้าของโครงการและบัญชี</p>
        </div>
        {canEdit && <Link href="/costs/new" className="flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">บันทึกต้นทุน</Link>}
      </div>
      <Notice error={sp.error} msg={sp.msg} />

      <section aria-label="สรุป" className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-4">
        {[
          { label: `รายรับรวม ${rep.rows.length} หลัง`, value: baht(t.revenue), note: "ราคาขาย + งานเพิ่ม-ลดที่ยืนยัน" },
          { label: "ต้นทุนรวม", value: baht(t.cost), note: "จริง + งบที่เหลือของหลังที่ยังสร้าง" },
          { label: "กำไรขั้นต้น", value: baht(t.profit), note: `เฉลี่ย ${t.margin.toFixed(1)}%`, cls: marginCls(t.margin) },
          { label: "หลังที่ต้องดู", value: String(t.overBudget), note: "เกินงบ หรือใช้เร็วกว่างาน", cls: t.overBudget ? "text-red-700" : "" },
        ].map((k) => (
          <div key={k.label} className="flex flex-col gap-0.5 border-b border-r border-slate-100 p-4">
            <span className="text-[13px] text-slate-600">{k.label}</span>
            <span className={`text-2xl font-bold tabular-nums ${k.cls ?? ""}`}>{k.value}</span>
            <span className="text-xs text-slate-600">{k.note}</span>
          </div>
        ))}
      </section>

      <div className="mb-8 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="text-left text-[13px] text-slate-600">
            <th className="px-4 py-3 font-semibold">{builder ? "งาน" : "แปลง"}</th><th className="px-3 py-3 text-right font-semibold">รายรับ</th>
            <th className="px-3 py-3 text-right font-semibold">ต้นทุน</th><th className="px-3 py-3 text-right font-semibold">กำไร</th>
            <th className="w-[18%] px-3 py-3 font-semibold">อัตรากำไร</th><th className="px-4 py-3 font-semibold">ต้องดู</th>
          </tr></thead>
          <tbody>
            {rep.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-5 text-slate-600">ยังไม่มีงานก่อสร้าง เพิ่มที่เมนูก่อสร้าง</td></tr>}
            {rep.rows.map((r) => (
              <tr key={r.build.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3"><Link href={`/build/${r.build.id}/costs`} className="font-semibold text-slate-900 underline-offset-2 hover:underline">{String(r.build.title)}</Link>
                  <div className="text-xs text-slate-600">{r.done ? `ส่งมอบแล้ว ${String(r.build.done_at)}` : `กำลังสร้าง · งานคืบหน้า ${Math.round(r.progress * 100)}%`}</div></td>
                <td className="px-3 py-3 text-right tabular-nums">{baht(r.revenue)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{baht(r.projectedTotal)}<div className="text-xs text-slate-600">{r.done ? "ปิดงานแล้ว" : `จริง ${baht(r.actualTotal)}`}</div></td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">{baht(r.profit)}</td>
                <td className="px-3 py-3"><div className="flex items-center gap-2">
                  <span className={`w-12 text-right font-bold tabular-nums ${marginCls(r.margin)}`}>{r.margin.toFixed(1)}%</span>
                  <span className="block h-2 flex-1 rounded bg-slate-100" aria-hidden="true"><span className={`block h-2 rounded ${barCls(r.margin)}`} style={{ width: `${Math.max(0, Math.min(r.margin * 4, 100))}%` }} /></span>
                </div></td>
                <td className="px-4 py-3 text-[13px] text-orange-800">{r.flags.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="budgets" className="mb-1 scroll-mt-4 text-lg font-bold">งบต้นทุนตามแบบบ้าน</h2>
      <p className="mb-3 max-w-2xl text-sm text-slate-600">ตั้งครั้งเดียวต่อแบบบ้าน ทุกหลังที่ใช้แบบนั้นได้งบเดียวกันอัตโนมัติ {builder ? "" : "แบบที่ไม่ได้ตั้งจะใช้งบทั่วไป"} (ที่ดิน ส่วนกลาง และการตลาด ระบบคิดให้ ไม่ต้องตั้ง)</p>
      <div className="mb-8 flex flex-col gap-3">
        {typeRows.map((ht) => (
          <form key={ht || "_"} action={budgetAction} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <input type="hidden" name="house_type" value={ht} />
            <div className="mb-2 font-semibold">{ht ? `แบบ ${ht}` : builder ? "งบต่อหลัง" : "งบทั่วไป (แบบที่ไม่ได้ตั้ง)"}</div>
            <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {K.MANUAL_CATS.map((c) => (
                <label key={c} className="flex flex-col gap-1 text-[13px]">{K.CAT_LABEL[c]}
                  <input name={`b_${c}`} inputMode="decimal" defaultValue={budgetOf(ht, c) ? Number(budgetOf(ht, c)) : ""} className={`${input} text-right tabular-nums`} />
                </label>
              ))}
              {canEdit && <button className="min-h-11 self-end rounded-lg border border-slate-400 px-4 font-semibold hover:bg-slate-50">บันทึกงบ</button>}
            </fieldset>
          </form>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <form id="shared" action={sharedAction} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="mb-1 text-base font-bold">ค่าส่วนกลาง</h2>
          <p className="mb-3 max-w-2xl text-slate-600">ถนน ไฟฟ้า ประปา สำนักงานขาย รั้ว ฯลฯ ใส่ยอดรวมทั้งโครงการ แล้วเลือกวิธีหาร</p>
          <fieldset disabled={!canEdit} className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">ยอดรวม (บาท)<input name="shared" inputMode="decimal" defaultValue={rep.sharedTotal || ""} className={`${input} w-48 text-right tabular-nums`} /></label>
            {!builder && (
              <div role="radiogroup" aria-label="วิธีหารค่าส่วนกลาง" className="flex flex-wrap gap-2">
                <label className={radio}><input type="radio" name="shared_mode" value="equal" defaultChecked={rep.sharedMode === "equal"} className="sr-only" />หารเท่ากันทุกแปลง</label>
                <label className={radio}><input type="radio" name="shared_mode" value="area" defaultChecked={rep.sharedMode === "area"} className="sr-only" />หารตามตารางวา</label>
              </div>
            )}
            {canEdit && <button className="min-h-11 rounded-lg border border-slate-400 px-4 font-semibold hover:bg-slate-50">บันทึก</button>}
          </fieldset>
          <p className="mt-3 text-slate-700">
            {rep.sharedMode === "area"
              ? <>ตอนนี้: หารตามเนื้อที่ {rep.totalArea.toLocaleString("th-TH")} ตร.ว. = ตร.ว.ละ {rep.totalArea ? baht(Math.round((rep.sharedTotal / rep.totalArea) * 100) / 100) : "–"} บาท{rep.missingArea ? <span className="font-semibold text-red-700"> · ยังไม่ใส่ตร.ว. {rep.missingArea} แปลง (แปลงเหล่านั้นยังไม่ได้ส่วนแบ่ง)</span> : null}</>
              : <>ตอนนี้: หารเท่ากัน {rep.sharedDiv} {builder ? "หลัง" : "แปลง"} = {builder ? "หลัง" : "แปลง"}ละ {baht(rep.sharedEach)} บาท</>}
          </p>
        </form>

        {!builder && (
          <form id="land" action={landAction} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5 text-sm">
            <h2 className="mb-1 text-base font-bold">ที่ดินและเนื้อที่รายแปลง</h2>
            <p className="mb-3 max-w-2xl text-slate-600">เลือกว่าจะใส่ต้นทุนที่ดินทีละแปลง หรือใส่ราคาที่ดินรวม (รวมถมดิน) แล้วให้ระบบหารตามตารางวาของแต่ละแปลง เนื้อที่ใช้กับการหารค่าส่วนกลางด้วย</p>
            <fieldset disabled={!canEdit} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <div role="radiogroup" aria-label="วิธีใส่ต้นทุนที่ดิน" className="flex flex-wrap gap-2">
                  <label className={radio}><input type="radio" name="land_mode" value="plot" defaultChecked={rep.landMode === "plot"} className="sr-only" />ใส่รายแปลง</label>
                  <label className={radio}><input type="radio" name="land_mode" value="area" defaultChecked={rep.landMode === "area"} className="sr-only" />ราคารวมหารตามตารางวา</label>
                </div>
                <label className="flex flex-col gap-1">ราคาที่ดินรวม (ใช้เมื่อหารตามตารางวา)<input name="land_total" inputMode="decimal" defaultValue={rep.landTotal || ""} className={`${input} w-56 text-right tabular-nums`} /></label>
              </div>
              {rep.landMode === "area" && (
                <p className="text-slate-700">ตอนนี้: {baht(rep.landTotal)} บาท ÷ {rep.totalArea.toLocaleString("th-TH")} ตร.ว. = ตร.ว.ละ {rep.totalArea ? baht(Math.round((rep.landTotal / rep.totalArea) * 100) / 100) : "–"} บาท{rep.missingArea ? <span className="font-semibold text-red-700"> · ยังไม่ใส่ตร.ว. {rep.missingArea} แปลง</span> : null}</p>
              )}
              {plots.length === 0 ? <p className="text-slate-600">ยังไม่มีแปลง</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead><tr className="text-left text-[13px] text-slate-600">
                      <th className="py-2 pr-3 font-semibold">แปลง</th><th className="py-2 pr-3 font-semibold">เนื้อที่ (ตร.ว.)</th>
                      <th className="py-2 pr-3 font-semibold">ต้นทุนที่ดิน (บาท)</th><th className="py-2 pr-3 text-right font-semibold">ส่วนกลางที่ได้</th>
                    </tr></thead>
                    <tbody>
                      {plots.map((p) => (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="py-1.5 pr-3 font-semibold">{String(p.code)}<div className="text-xs font-normal text-slate-600">{String(p.house_type || "")}</div></td>
                          <td className="py-1.5 pr-3"><input name={`area_${p.code}`} inputMode="decimal" defaultValue={Number(p.area_sqw) || ""} aria-label={`เนื้อที่แปลง ${p.code} ตารางวา`} className={`${input} w-28 text-right tabular-nums`} /></td>
                          <td className="py-1.5 pr-3">
                            {rep.landMode === "area"
                              ? <span className="tabular-nums text-slate-700">{baht(rep.landOf(p))} <span className="text-xs text-slate-500">(คำนวณ)</span></span>
                              : <input name={`land_${p.code}`} inputMode="decimal" defaultValue={Number(p.land_cost) || ""} aria-label={`ต้นทุนที่ดินแปลง ${p.code}`} className={`${input} w-40 text-right tabular-nums`} />}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">{baht(rep.sharedOf(p))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {canEdit && plots.length > 0 && <button className="min-h-11 self-start rounded-lg border border-slate-400 px-4 font-semibold hover:bg-slate-50">บันทึกที่ดินและเนื้อที่</button>}
            </fieldset>
            <p className="mt-3 text-xs text-slate-600">เปลี่ยนวิธีแล้วกดบันทึก ตารางจะแสดงช่องตามวิธีใหม่ · ตัวเลขที่ใส่รายแปลงไว้ยังเก็บอยู่ สลับกลับได้</p>
          </form>
        )}
      </div>
    </ProjectShell>
  );
}
