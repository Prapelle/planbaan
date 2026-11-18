import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireCosts } from "@/lib/costs-access";
import { back, baht, errMsg, fv } from "@/lib/form";
import * as K from "@/lib/costs";
import { bkkDate } from "@/lib/sales";

export const dynamic = "force-dynamic";
const PATH = "/costs/new";

/** บันทึกต้นทุน เลือกได้หลายหลัง (ซื้อรวม) ระบบแบ่งเท่ากัน — ออกแบบให้กรอกบนมือถือได้ */
async function addAction(f: FormData) {
  "use server";
  const { ctx } = await requireCosts(PATH, true);
  const ids = f.getAll("build").map(String);
  let r = { count: 0, each: 0, first: 0 };
  try { r = await K.addCosts(ctx.db, { buildIds: ids, category: fv(f, "category"), item: fv(f, "item"), amount: fv(f, "amount"), date: fv(f, "date") }, ctx.email); }
  catch (e) { back(`${PATH}${ids.length === 1 ? `?build=${ids[0]}` : ""}`, { error: errMsg(e) }); }
  revalidatePath("/profit");
  const msg = r.count > 1 ? `บันทึกแล้ว แบ่ง ${r.count} หลัง หลังละ ${baht(r.each)} บาท` : "บันทึกต้นทุนแล้ว";
  if (ids.length === 1) redirect(`/build/${ids[0]}/costs?msg=${encodeURIComponent(msg)}`);
  back(PATH, { msg });
}

const chip = "flex min-h-11 cursor-pointer items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600 has-[:checked]:font-semibold has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500";
const input = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-[15px]";

export default async function NewCost({ searchParams }: { searchParams: Promise<{ build?: string; error?: string; msg?: string }> }) {
  const { ctx } = await requireCosts(PATH, true);
  const sp = await searchParams;
  const builds = (await ctx.db.list("builds", { limit: 2000 })).filter((b) => b.status !== "done" || b.id === sp.build)
    .sort((a, b) => String(a.plot_code || a.title).localeCompare(String(b.plot_code || b.title), "th", { numeric: true }));

  return (
    <ProjectShell ctx={ctx} active="/profit">
      <div className="mx-auto max-w-xl">
        <h1 className="mb-1 text-[26px] font-bold">บันทึกต้นทุน</h1>
        <p className="mb-4 text-sm text-slate-600">เลือกหลายหลังได้ เช่น ซื้อปูนล็อตใหญ่ใช้ 4 หลัง ระบบแบ่งยอดเท่ากันให้ทุกหลังที่เลือก</p>
        <Notice error={sp.error} msg={sp.msg} />
        {builds.length === 0 ? <p className="rounded-xl bg-white p-4 text-slate-700">ยังไม่มีงานก่อสร้างที่กำลังสร้าง</p> : (
          <form action={addAction} className="flex flex-col gap-5 text-sm">
            <label className="flex flex-col gap-1 font-semibold">จำนวนเงินรวม (บาท)
              <input name="amount" required inputMode="decimal" autoComplete="off" className={`${input} min-h-14 text-right text-2xl font-bold tabular-nums`} />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-semibold">หมวด</legend>
              <div className="flex flex-wrap gap-2">
                {K.MANUAL_CATS.map((c, i) => (
                  <label key={c} className={chip}><input type="radio" name="category" value={c} defaultChecked={i === 0} className="sr-only" />{K.CAT_LABEL[c]}</label>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1 font-semibold">รายการ<input name="item" required maxLength={200} placeholder="เช่น ปูนผสมเสร็จ 24 คิว" className={`${input} font-normal`} /></label>

            <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <legend className="px-1 font-semibold">หลังที่ใช้ (เลือกได้หลายหลัง แบ่งเท่ากัน)</legend>
              <div className="flex flex-wrap gap-2">
                {builds.map((b) => (
                  <label key={b.id} className={chip}>
                    <input type="checkbox" name="build" value={b.id} defaultChecked={b.id === sp.build} className="sr-only" />
                    {b.plot_code ? String(b.plot_code) : String(b.title)}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1 font-semibold">วันที่<input type="date" name="date" required defaultValue={bkkDate()} className={`${input} font-normal`} /></label>
            <button className="min-h-[52px] rounded-xl bg-brand-600 px-4 text-base font-bold text-white hover:bg-brand-700">บันทึก</button>
          </form>
        )}
      </div>
    </ProjectShell>
  );
}
