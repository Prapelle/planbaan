import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { back, errMsg, fv } from "@/lib/form";
import { canManagePromos } from "@/lib/roles";
import { bkkDate } from "@/lib/sales";
import * as P from "@/lib/promotions";

export const dynamic = "force-dynamic";

async function guard(edit: boolean) {
  const ctx = await requireProject({ action: edit ? "edit" : "view", target: "/promotions" });
  if (!canManagePromos(ctx.role, ctx.access.supportCanEdit) && !(ctx.role === "support" && !edit)) back("/", { error: "หน้าโปรโมชั่นสำหรับเจ้าของและผู้จัดการ" });
  if (edit && (ctx.readonly || !canManagePromos(ctx.role, ctx.access.supportCanEdit))) back("/promotions", { error: "ไม่มีสิทธิ์แก้ไขโปรโมชั่น" });
  return ctx;
}

async function saveAction(f: FormData) {
  "use server";
  const ctx = await guard(true);
  const id = fv(f, "pid");
  try {
    await P.savePromo(ctx.db, { id: id || undefined, name: fv(f, "name"), kind: fv(f, "kind"), value: fv(f, "value"), validUntil: fv(f, "valid_until"), active: id ? f.has("active") : true });
  } catch (e) { back("/promotions", { error: errMsg(e), hash: id ? `p-${id}` : "add" }); }
  revalidatePath("/promotions");
  back("/promotions", { msg: id ? "บันทึกโปรโมชั่นแล้ว" : "เพิ่มโปรโมชั่นแล้ว" });
}
async function removeAction(f: FormData) {
  "use server";
  const ctx = await guard(true);
  try { await P.removePromo(ctx.db, fv(f, "pid")); } catch (e) { back("/promotions", { error: errMsg(e) }); }
  revalidatePath("/promotions");
  back("/promotions", { msg: "ลบโปรโมชั่นแล้ว ลูกค้าที่ใช้ไปแล้วยังเก็บไว้เหมือนเดิม" });
}
async function thresholdAction(f: FormData) {
  "use server";
  const ctx = await guard(true);
  try { await P.setApprovePct(ctx.db, fv(f, "pct")); } catch (e) { back("/promotions", { error: errMsg(e) }); }
  revalidatePath("/promotions");
  back("/promotions", { msg: "บันทึกเกณฑ์อนุมัติแล้ว" });
}

const baht = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
const input = "min-h-11 rounded-md border border-slate-300 px-3";

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const ctx = await guard(false);
  const { error, msg } = await searchParams;
  const canEdit = canManagePromos(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly;
  const [rows, pct, stats] = await Promise.all([P.catalog(ctx.db), P.approvePct(ctx.db), P.usageStats(ctx.db)]);
  const today = bkkDate();
  await ctx.usage("page_view", { page: "promotions" });

  return (
    <ProjectShell ctx={ctx} active="/promotions">
      <h1 className="mb-1 text-2xl font-bold">โปรโมชั่น</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-700">ตั้งรายการโปรไว้ให้ฝ่ายขายกดเลือกในหน้าลูกค้า ฝ่ายขายยังพิมพ์โปรอื่นเองได้ ส่วนลดรวมที่เกินเกณฑ์ต้องให้เจ้าของหรือผู้จัดการอนุมัติก่อนเลื่อนลูกค้าไปขั้นจอง</p>
      <Notice error={error} msg={msg} />

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">เกณฑ์อนุมัติส่วนลด</h2>
        <p className="mb-2 text-slate-700">ส่วนลดรวม = ลดจากราคาตั้ง + ส่วนลดเงินสด + ของแถม + ฟรีค่าโอน คิดเป็น % ของราคาตั้งแปลง</p>
        <form action={thresholdAction} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">ต้องอนุมัติเมื่อลดเกิน (%)
            <input name="pct" inputMode="decimal" defaultValue={String(pct)} disabled={!canEdit} className={`${input} w-28 text-right`} /></label>
          {canEdit && <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">บันทึกเกณฑ์</button>}
        </form>
      </section>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">รายการโปรที่ให้ฝ่ายขายเลือก</h2>
        <ul className="mb-3 text-xs text-slate-600">
          {P.PROMO_KINDS.map((k) => <li key={k}><b>{P.PROMO_KIND_LABEL[k]}</b>: {P.PROMO_KIND_NOTE[k]}</li>)}
        </ul>
        {rows.length === 0 && <p className="mb-3 text-slate-700">ยังไม่มีโปรโมชั่น เพิ่มรายการแรกด้านล่าง</p>}
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const st = stats.byPromo.get(r.id);
            const expired = !!r.valid_until && String(r.valid_until) < today;
            const off = Number(r.active) !== 1;
            return (
              <li key={r.id} id={`p-${r.id}`} className={`scroll-mt-4 rounded-md border p-3 ${off || expired ? "border-slate-200 bg-slate-50" : "border-brand-200"}`}>
                <form action={saveAction} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.6fr_1.2fr_1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="pid" value={r.id} />
                  <fieldset disabled={!canEdit} className="contents">
                    <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">ชื่อ<input name="name" required maxLength={80} defaultValue={String(r.name)} className={input} /></label>
                    <label className="flex flex-col gap-1">ประเภท
                      <select name="kind" defaultValue={String(r.kind)} className={input}>{P.PROMO_KINDS.map((k) => <option key={k} value={k}>{P.PROMO_KIND_LABEL[k]}</option>)}</select></label>
                    <label className="flex flex-col gap-1">มูลค่าตั้งต้น<input name="value" inputMode="decimal" defaultValue={Number(r.default_value) > 0 ? String(r.default_value) : ""} placeholder="ให้ฝ่ายขายใส่" className={`${input} text-right`} /></label>
                    <label className="flex flex-col gap-1">หมดเขต<input name="valid_until" type="date" defaultValue={String(r.valid_until ?? "")} className={input} /></label>
                    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="active" defaultChecked={!off} className="h-5 w-5" />เปิดใช้</label>
                  </fieldset>
                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 sm:col-span-5">
                    <span className="text-xs text-slate-600">
                      {st ? `ใช้ไป ${st.count} ราย · รวม ${baht(st.total)} บาท` : "ยังไม่มีลูกค้าใช้"}
                      {expired && <b className="ml-2 text-amber-700">หมดเขตแล้ว ฝ่ายขายไม่เห็นในหน้าลูกค้า</b>}
                      {off && <b className="ml-2 text-slate-700">ปิดอยู่</b>}
                    </span>
                    {canEdit && (
                      <span className="flex gap-2">
                        <button formAction={removeAction} className="min-h-10 rounded-md px-3 text-red-700 hover:bg-red-50">ลบ</button>
                        <button className="min-h-10 rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">บันทึก</button>
                      </span>
                    )}
                  </div>
                </form>
              </li>
            );
          })}
        </ul>

        {canEdit && (
          <form id="add" action={saveAction} className="mt-4 grid scroll-mt-4 grid-cols-2 gap-2 rounded-md bg-brand-50 p-3 sm:grid-cols-[1.6fr_1.2fr_1fr_1fr_auto] sm:items-end">
            <span className="col-span-2 font-semibold text-brand-800 sm:col-span-5">เพิ่มโปรโมชั่น</span>
            <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">ชื่อ<input name="name" required maxLength={80} placeholder="เช่น ฟรีเฟอร์นิเจอร์บิวท์อิน" className={`${input} bg-white`} /></label>
            <label className="flex flex-col gap-1">ประเภท
              <select name="kind" defaultValue="gift" className={`${input} bg-white`}>{P.PROMO_KINDS.map((k) => <option key={k} value={k}>{P.PROMO_KIND_LABEL[k]}</option>)}</select></label>
            <label className="flex flex-col gap-1">มูลค่าตั้งต้น<input name="value" inputMode="decimal" placeholder="เว้นว่างได้" className={`${input} bg-white text-right`} /></label>
            <label className="flex flex-col gap-1">หมดเขต<input name="valid_until" type="date" className={`${input} bg-white`} /></label>
            <button className="col-span-2 min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 sm:col-span-1">เพิ่ม</button>
          </form>
        )}
      </section>

      {stats.custom.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">โปรที่ฝ่ายขายพิมพ์เอง</h2>
          <p className="mb-2 text-xs text-slate-600">ถ้าใช้บ่อย เพิ่มเข้ารายการด้านบนจะกดเลือกได้เร็วขึ้น</p>
          <ul className="flex flex-col gap-1">
            {stats.custom.map((c) => (
              <li key={c.name} className="flex justify-between gap-2"><span>{c.name} <span className="text-xs text-slate-600">· {P.PROMO_KIND_LABEL[c.kind as P.PromoKind] ?? c.kind}</span></span>
                <span className="tabular-nums text-slate-700">{c.count} ราย · {baht(c.total)} บาท</span></li>
            ))}
          </ul>
        </section>
      )}
    </ProjectShell>
  );
}
