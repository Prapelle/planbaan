import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { back, baht, errMsg, fv } from "@/lib/form";
import { canEditData } from "@/lib/roles";
import * as L from "@/lib/loans";
import { STAGE_LABEL, type Stage, daysSince } from "@/lib/sales";

export const dynamic = "force-dynamic";

const here = (lead: string) => `/loans?lead=${encodeURIComponent(lead)}`;

async function guard(lead: string) {
  const ctx = await requireProject({ action: "edit", target: here(lead) });
  if (!(canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly)) back(here(lead), { error: "ไม่มีสิทธิ์แก้ไขข้อมูลสินเชื่อ" });
  return ctx;
}
async function run(lead: string, fn: (ctx: Awaited<ReturnType<typeof guard>>) => Promise<unknown>, msg: string) {
  const ctx = await guard(lead);
  try { await fn(ctx); } catch (e) { back(here(lead), { error: errMsg(e) }); }
  revalidatePath("/loans");
  back(here(lead), { msg });
}

async function docsAction(f: FormData) {
  "use server";
  const lead = fv(f, "lead");
  await run(lead, (c) => L.setDocs(c.db, lead, f.getAll("doc").map(String)), "บันทึกเอกสารแล้ว");
}
async function addBankAction(f: FormData) {
  "use server";
  const lead = fv(f, "lead");
  await run(lead, (c) => L.addBank(c.db, lead, fv(f, "bank"), c.email), `เพิ่ม ${fv(f, "bank")} แล้ว`);
}
async function statusAction(f: FormData) {
  "use server";
  const lead = fv(f, "lead");
  await run(lead, (c) => L.setAppStatus(c.db, fv(f, "app"), fv(f, "status"), c.email, {
    amount: f.get("amount") ? Number(fv(f, "amount")) : undefined, officer: fv(f, "officer"),
  }), "อัปเดตสถานะธนาคารแล้ว");
}
async function removeAction(f: FormData) {
  "use server";
  const lead = fv(f, "lead");
  await run(lead, (c) => L.removeApp(c.db, fv(f, "app"), c.email), "ลบรายการแล้ว");
}
async function debtAction(f: FormData) {
  "use server";
  const lead = fv(f, "lead");
  await run(lead, (c) => L.saveDebt(c.db, lead, { reason: fv(f, "reason"), plan: fv(f, "plan"), retryAt: fv(f, "retry_at") }), "บันทึกแผนแก้หนี้แล้ว");
}
async function transferAction(f: FormData) {
  "use server";
  const lead = fv(f, "lead");
  const ctx = await guard(lead);
  try { await L.markTransferred(ctx.db, lead, ctx.email); await ctx.usage("lead_stage_changed", { to: "transferred" }); }
  catch (e) { back(here(lead), { error: errMsg(e) }); }
  revalidatePath("/loans");
  back(`/leads/${lead}`, { msg: "ย้ายลูกค้าไปขั้นโอนแล้วเรียบร้อย" });
}

const PILL: Record<string, string> = {
  preparing: "bg-slate-200 text-slate-900", submitted: "bg-slate-200 text-slate-900", more_docs: "bg-amber-200 text-slate-900",
  appraisal: "bg-slate-200 text-slate-900", approved: "bg-emerald-700 text-white", rejected: "bg-red-700 text-white",
};

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ lead?: string; error?: string; msg?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/loans" });
  await ctx.usage("page_view", { page: "loans" });
  const { lead: selId, error, msg } = await searchParams;
  const canEdit = (canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly);
  const cases = await L.loanCases(ctx.db);
  const sel = cases.find((c) => c.lead.id === selId) ?? cases[0] ?? null;

  return (
    <ProjectShell ctx={ctx} active="/loans">
      <h1 className="mb-1 text-2xl font-bold">สินเชื่อ</h1>
      <p className="mb-4 text-sm text-slate-600">ลูกค้าขั้นจองและยื่นกู้ แต่ละธนาคารมีสถานะของตัวเอง ระบบเก็บเฉพาะว่าเอกสารครบหรือไม่ ไม่เก็บไฟล์</p>
      <Notice error={error} msg={msg} />
      {cases.length === 0 && <p className="rounded-lg bg-white p-4 text-slate-700">ยังไม่มีลูกค้าในขั้นจองหรือยื่นกู้</p>}

      {sel && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <ul className="flex flex-col gap-2 lg:w-80 lg:shrink-0">
            {cases.map(({ lead, sum }) => (
              <li key={String(lead.id)}>
                <Link href={here(String(lead.id))} aria-current={lead.id === sel.lead.id ? "true" : undefined}
                  className={`flex flex-col gap-0.5 rounded-lg border bg-white p-3 text-sm ${lead.id === sel.lead.id ? "border-brand-600 ring-2 ring-brand-500" : "border-slate-200"}`}>
                  <span className="flex justify-between gap-2"><b>{String(lead.name)}</b><span className="text-slate-600">{String(lead.plot_code)}</span></span>
                  <span className="text-xs text-slate-600">เอกสาร {sum.docsDone}/{sum.docsTotal} · ยื่น {sum.filed} · อนุมัติ {sum.approved} · รอผล {sum.waiting}</span>
                  {sum.allRejected && <span className="text-xs font-semibold text-red-700">ไม่ผ่านทุกธนาคาร · แก้หนี้ {sum.heldDays} วัน</span>}
                  {sum.approved > 0 && <span className="text-xs font-semibold text-emerald-800">อนุมัติแล้ว พร้อมนัดโอน</span>}
                  {sum.staleApps > 0 && <span className="text-xs font-semibold text-red-700">ธนาคารไม่ขยับเกิน {L.STALE_BANK_DAYS} วัน {sum.staleApps} ราย</span>}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
              <div>
                <h2 className="text-xl font-bold"><Link href={`/leads/${sel.lead.id}`} className="underline-offset-2 hover:underline">{String(sel.lead.name)}</Link></h2>
                <div className="text-sm text-slate-600">แปลง {String(sel.lead.plot_code)} · ขั้น {STAGE_LABEL[sel.lead.stage as Stage]}</div>
              </div>
              {canEdit && sel.sum.approved > 0 && (
                <form action={transferAction}><input type="hidden" name="lead" value={String(sel.lead.id)} />
                  <button className="min-h-11 rounded-md bg-emerald-700 px-4 font-semibold text-white">อนุมัติแล้ว · ย้ายไปขั้นโอนแล้ว</button>
                </form>
              )}
            </div>

            <form action={docsAction} className="rounded-lg border border-slate-200 bg-white p-4">
              <input type="hidden" name="lead" value={String(sel.lead.id)} />
              <div className="mb-2 flex justify-between"><h3 className="font-semibold">เอกสาร</h3><span className="text-sm text-slate-600">ครบ {sel.sum.docsDone}/{sel.sum.docsTotal}</span></div>
              <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {L.DOCS.map((d) => (
                  <label key={d} className="flex min-h-11 items-center gap-3 text-sm">
                    <input type="checkbox" name="doc" value={d} defaultChecked={sel.sum.docs.includes(d)} className="h-5 w-5" />{L.DOC_LABEL[d]}
                  </label>
                ))}
              </fieldset>
              {canEdit && <button className="mt-2 min-h-11 rounded-md border border-slate-400 px-4 text-sm font-semibold">บันทึกเอกสาร</button>}
            </form>

            <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h3 className="font-semibold">การยื่นแต่ละธนาคาร</h3>
                {canEdit && (
                  <form action={addBankAction} className="flex items-end gap-2 text-sm">
                    <input type="hidden" name="lead" value={String(sel.lead.id)} />
                    <label className="flex flex-col gap-1">ธนาคาร
                      <select name="bank" className="min-h-11 rounded-md border border-slate-300 px-3">
                        {L.BANKS.filter((b) => !sel.apps.some((a) => a.bank === b)).map((b) => <option key={b}>{b}</option>)}
                      </select>
                    </label>
                    <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white">เพิ่มธนาคาร</button>
                  </form>
                )}
              </div>
              {sel.apps.length === 0 && <p className="text-sm text-slate-600">ยังไม่ได้ยื่นธนาคารใด</p>}
              {sel.apps.map((a) => {
                const idle = daysSince(String(a.updated_at));
                const waiting = a.status === "submitted" || a.status === "more_docs" || a.status === "appraisal";
                return (
                  <div key={String(a.id)} className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <b>{String(a.bank)}</b>
                        <span className="ml-2 text-xs text-slate-600">อัปเดต {idle === 0 ? "วันนี้" : `${idle} วันก่อน`}{a.officer ? ` · ${a.officer}` : ""}{a.status === "approved" && Number(a.amount) ? ` · วงเงิน ${baht(a.amount)} บาท` : ""}</span>
                        {waiting && idle > L.STALE_BANK_DAYS && <div className="text-xs font-semibold text-red-700">ไม่มีความคืบหน้าเกิน {L.STALE_BANK_DAYS} วัน</div>}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PILL[String(a.status)]}`}>{L.LOAN_LABEL[a.status as L.LoanStatus]}</span>
                    </div>
                    {canEdit && (
                      <form action={statusAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="lead" value={String(sel.lead.id)} /><input type="hidden" name="app" value={String(a.id)} />
                        <label className="flex flex-col gap-1">สถานะ
                          <select name="status" defaultValue={String(a.status)} className="min-h-10 rounded-md border border-slate-300 px-2">
                            {L.LOAN_STATUS.map((s) => <option key={s} value={s}>{L.LOAN_LABEL[s]}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">วงเงินอนุมัติ (บาท)<input name="amount" type="number" min={0} step={1000} defaultValue={Number(a.amount) || ""} className="min-h-10 w-36 rounded-md border border-slate-300 px-2" /></label>
                        <label className="flex flex-col gap-1">เจ้าหน้าที่ธนาคาร<input name="officer" defaultValue={String(a.officer)} className="min-h-10 rounded-md border border-slate-300 px-2" /></label>
                        <button className="min-h-10 rounded-md bg-slate-900 px-3 font-semibold text-white">บันทึก</button>
                      </form>
                    )}
                    {canEdit && a.status === "preparing" && (
                      <form action={removeAction}><input type="hidden" name="lead" value={String(sel.lead.id)} /><input type="hidden" name="app" value={String(a.id)} />
                        <button className="text-xs text-red-700 underline">ลบรายการนี้</button></form>
                    )}
                  </div>
                );
              })}
            </section>

            {sel.sum.allRejected && (
              <form action={debtAction} className="flex flex-col gap-2 rounded-lg border-2 border-red-700 bg-white p-4 text-sm">
                <input type="hidden" name="lead" value={String(sel.lead.id)} />
                <h3 className="font-semibold">แก้หนี้</h3>
                <p className={sel.sum.holdWarning ? "font-semibold text-red-700" : "text-slate-600"}>
                  ถือแปลงมาแล้ว {sel.sum.heldDays} วัน จากกำหนด {L.HOLD_DAYS} วัน · ระบบไม่ปล่อยแปลงเอง ถ้าจะปล่อย ให้เปลี่ยนลูกค้าเป็น "ไม่ซื้อ"
                </p>
                <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">สาเหตุที่ไม่ผ่าน<input name="reason" defaultValue={String(sel.lead.debt_reason)} placeholder="เช่น ภาระหนี้ต่อรายได้สูง" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                  <label className="flex flex-col gap-1">คาดว่ายื่นใหม่ได้<input name="retry_at" type="date" defaultValue={String(sel.lead.debt_retry_at)} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2">แผนแก้<textarea name="plan" rows={2} defaultValue={String(sel.lead.debt_plan)} className="rounded-md border border-slate-300 p-3" /></label>
                  {canEdit && <button className="min-h-11 rounded-md border border-slate-400 px-4 font-semibold sm:col-span-2">บันทึกแผนแก้หนี้</button>}
                </fieldset>
              </form>
            )}
          </div>
        </div>
      )}
    </ProjectShell>
  );
}
