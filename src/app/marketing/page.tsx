import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { back, baht, errMsg, fv } from "@/lib/form";
import { canEditMarketing } from "@/lib/roles";
import * as M from "@/lib/marketing";
import { CHANNEL_LABEL, type Channel, bkkDate } from "@/lib/sales";

export const dynamic = "force-dynamic";
const MAX_FILE = 3 * 1024 * 1024;
const here = (m: string) => `/marketing?month=${m}`;

async function guard(month: string) {
  const ctx = await requireProject({ action: "edit", target: here(month) });
  if (!canEditMarketing(ctx.role, ctx.access.supportCanEdit)) back(here(month), { error: "ไม่มีสิทธิ์แก้ข้อมูลการตลาด" });
  return ctx;
}
const monthOf = (f: FormData) => { const m = fv(f, "month"); return /^\d{4}-\d{2}$/.test(m) ? m : M.thisMonth(); };

async function importAction(f: FormData) {
  "use server";
  const month = monthOf(f);
  const ctx = await guard(month);
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) back(here(month), { error: "เลือกไฟล์ CSV ก่อน" });
  if (file.size > MAX_FILE) back(here(month), { error: "ไฟล์ใหญ่เกิน 3MB แบ่งนำเข้าทีละเดือน" });
  let msg = "";
  let to = month;
  try {
    const r = M.parseAdsCsv(await file.text(), fv(f, "channel"));
    if (!r.rows.length) throw new Error("ไม่พบแถวค่าใช้จ่ายในไฟล์");
    const u = await M.upsertSpend(ctx.db, r.rows, "csv");
    await ctx.usage("marketing_import", { channel: fv(f, "channel"), rows: r.rows.length });
    to = u.months.includes(month) ? month : u.months.sort().at(-1)!;
    msg = `นำเข้า ${r.rows.length} แถว รวม ${baht(r.total)} บาท (ใหม่ ${u.added} · แทนที่ของเดิม ${u.replaced})` +
      (r.skipped ? ` · ข้าม ${r.skipped} แถวที่ไม่มีวันที่หรือยอด` : "") + (r.warnings.length ? ` · ${r.warnings.join(" · ")}` : "");
  } catch (e) { back(here(month), { error: errMsg(e) }); }
  revalidatePath("/marketing");
  back(here(to), { msg });
}

async function budgetAction(f: FormData) {
  "use server";
  const month = monthOf(f);
  const ctx = await guard(month);
  const entries = Object.fromEntries(M.AD_CHANNELS.map((c) => [c, fv(f, `b_${c}`)]));
  try { await M.setBudget(ctx.db, month, entries); await ctx.usage("marketing_updated", { what: "budget" }); }
  catch (e) { back(here(month), { error: errMsg(e) }); }
  revalidatePath("/marketing");
  back(here(month), { msg: "บันทึกงบแล้ว" });
}

async function spendAction(f: FormData) {
  "use server";
  const month = monthOf(f);
  const ctx = await guard(month);
  try { await M.addSpend(ctx.db, { day: fv(f, "day"), channel: fv(f, "channel"), campaign: fv(f, "campaign"), amount: fv(f, "amount") }); await ctx.usage("marketing_updated", { what: "spend" }); }
  catch (e) { back(here(month), { error: errMsg(e) }); }
  revalidatePath("/marketing");
  back(here(fv(f, "day").slice(0, 7) || month), { msg: "บันทึกค่าใช้จ่ายแล้ว" });
}

async function removeAction(f: FormData) {
  "use server";
  const month = monthOf(f);
  const ctx = await guard(month);
  try { await M.removeSpend(ctx.db, fv(f, "id")); } catch (e) { back(here(month), { error: errMsg(e) }); }
  revalidatePath("/marketing");
  back(here(month), { msg: "ลบรายการแล้ว" });
}

async function clearAction(f: FormData) {
  "use server";
  const month = monthOf(f);
  const ctx = await guard(month);
  let n = 0;
  try { n = await M.clearSpend(ctx.db, month, fv(f, "channel")); } catch (e) { back(here(month), { error: errMsg(e) }); }
  revalidatePath("/marketing");
  back(here(month), { msg: `ลบค่าใช้จ่าย ${CHANNEL_LABEL[fv(f, "channel") as Channel]} เดือนนี้ ${n} รายการ` });
}

const thMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const thShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });
const money = (n: number | null) => (n === null ? "–" : baht(n));
const input = "min-h-11 rounded-md border border-slate-300 px-3";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ month?: string; error?: string; msg?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/marketing" });
  await ctx.usage("page_view", { page: "marketing" });
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : M.thisMonth();
  const canEdit = canEditMarketing(ctx.role, ctx.access.supportCanEdit);
  const r = await M.marketingReport(ctx.db, month);
  const tc = M.cost(r.total);
  const isCurrent = month === M.thisMonth();
  const maxTrend = Math.max(1, ...r.trend.map((t) => t.spend));
  const defaultDay = isCurrent ? bkkDate() : `${month}-01`;
  const kpis = [
    { label: "ค่าโฆษณา", value: baht(r.total.spend), note: r.total.budget ? `งบ ${baht(r.total.budget)} · ใช้ ${Math.round((r.total.spend / r.total.budget) * 100)}%` : "ยังไม่ตั้งงบ" },
    { label: "ลูกค้าใหม่", value: baht(r.total.leads), note: `ต้นทุนต่อราย ${money(tc.perLead)}` },
    { label: "เข้าชม", value: baht(r.total.visits), note: `ต้นทุนต่อการเข้าชม ${money(tc.perVisit)}` },
    { label: "จอง", value: baht(r.total.bookings), note: `ต้นทุนต่อการจอง ${money(tc.perBooking)}` },
  ];

  return (
    <ProjectShell ctx={ctx} active="/marketing">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">การตลาด</h1>
          <p className="text-sm text-slate-600">นับลูกค้าที่เข้ามาในเดือนนั้น แล้วดูว่าไปถึงขั้นไหน ลูกค้าที่เคยเข้าชมแล้วไม่ซื้อยังนับเป็นการเข้าชม{isCurrent ? " · เดือนนี้ยังไม่จบ ตัวเลขการจองจะเพิ่มขึ้นอีก" : ""}</p>
        </div>
        <nav aria-label="เลือกเดือน" className="flex items-center gap-2 text-sm">
          <Link href={here(M.shiftMonth(month, -1))} className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3">‹ ก่อนหน้า</Link>
          <span className="min-w-36 text-center font-semibold">{thMonth(month)}</span>
          {!isCurrent && <Link href={here(M.shiftMonth(month, 1))} className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3">ถัดไป ›</Link>}
        </nav>
      </div>
      <Notice error={sp.error} msg={sp.msg} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">{k.label}</div>
            <div className="text-2xl font-bold">{k.value}</div>
            <div className="text-xs text-slate-600">{k.note}</div>
          </div>
        ))}
      </div>

      <section className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 font-semibold">แยกตามช่องทาง</h2>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-slate-600">
            <tr className="border-b border-slate-200">
              {["ช่องทาง", "งบ", "ใช้จริง", "ลูกค้า", "เข้าชม", "จอง", "ต่อลูกค้า", "ต่อเข้าชม", "ต่อจอง"].map((h, i) => <th key={h} className={`p-3 font-medium ${i ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {r.channels.length === 0 && <tr><td colSpan={9} className="p-4 text-slate-600">ยังไม่มีข้อมูลเดือนนี้</td></tr>}
            {r.channels.map((c) => {
              const x = M.cost(c);
              const over = c.budget > 0 && c.spend > c.budget;
              return (
                <tr key={c.channel} className="border-b border-slate-100">
                  <td className="p-3 font-medium">{CHANNEL_LABEL[c.channel]}</td>
                  <td className="p-3 text-right">{c.budget ? baht(c.budget) : "–"}</td>
                  <td className={`p-3 text-right ${over ? "font-semibold text-red-700" : ""}`}>{c.spend ? baht(c.spend) : "–"}{over ? " เกินงบ" : ""}</td>
                  <td className="p-3 text-right">{c.leads}</td>
                  <td className="p-3 text-right">{c.visits}</td>
                  <td className="p-3 text-right">{c.bookings}</td>
                  <td className="p-3 text-right">{money(x.perLead)}</td>
                  <td className="p-3 text-right">{money(x.perVisit)}</td>
                  <td className="p-3 text-right font-semibold">{money(x.perBooking)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {r.channels.some((c) => c.spend > 0 && c.leads === 0) && (
          <p className="px-4 pb-4 text-sm text-red-700">บางช่องทางมีค่าโฆษณาแต่ไม่มีลูกค้า ตรวจว่าฝ่ายขายเลือกช่องทางถูกต้องตอนเพิ่มลูกค้า</p>
        )}
      </section>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">ย้อนหลัง 6 เดือน</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {r.trend.map((t) => {
            const c = M.cost(t);
            return (
              <li key={t.month} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                <Link href={here(t.month)} className={`underline-offset-2 hover:underline ${t.month === month ? "font-bold" : ""}`}>{thShort(t.month)}</Link>
                <div className="h-4 rounded bg-slate-100" aria-hidden="true"><div className="h-4 rounded bg-brand-600" style={{ width: `${(t.spend / maxTrend) * 100}%` }} /></div>
                <span className="whitespace-nowrap text-slate-700">{baht(t.spend)} บาท · ลูกค้า {t.leads} · ต่อจอง {money(c.perBooking)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {canEdit && (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <form action={importAction} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <input type="hidden" name="month" value={month} />
            <h2 className="font-semibold">นำเข้าไฟล์ CSV จากระบบโฆษณา</h2>
            <p className="text-slate-600">ส่งออกรายงานแบบ<b>แยกรายวัน</b> ที่มีคอลัมน์วันที่ ชื่อแคมเปญ และยอดใช้จ่าย นำเข้าไฟล์เดิมซ้ำได้ ระบบแทนที่ยอดเดิม ไม่นับซ้ำ</p>
            <label className="flex flex-col gap-1">ช่องทาง
              <select name="channel" className={input}>
                {(["facebook", "google", "tiktok"] as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">ไฟล์ (.csv ไม่เกิน 3MB)
              <input type="file" name="file" accept=".csv,.tsv,text/csv" required className="min-h-11 py-2" />
            </label>
            <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white">นำเข้า</button>
            <details className="text-slate-600">
              <summary className="cursor-pointer">วิธีส่งออกไฟล์</summary>
              <ul className="mt-2 list-disc pl-5">
                <li>Facebook Ads Manager: แท็บแคมเปญ → แบ่งตาม → ตามเวลา → วัน → ส่งออก → .csv</li>
                <li>Google Ads: แคมเปญ → ส่วน → เวลา → วัน → ดาวน์โหลด → .csv</li>
                <li>TikTok Ads: รายงาน → แคมเปญ แยกตามวัน → ส่งออก .csv</li>
              </ul>
            </details>
          </form>

          <form action={budgetAction} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <input type="hidden" name="month" value={month} />
            <h2 className="font-semibold">งบเดือน{thMonth(month)} (บาท)</h2>
            <div className="grid grid-cols-2 gap-3">
              {M.AD_CHANNELS.map((c) => (
                <label key={c} className="flex flex-col gap-1">{CHANNEL_LABEL[c]}
                  <input name={`b_${c}`} inputMode="decimal" defaultValue={r.budgetByChannel[c] || ""} className={input} />
                </label>
              ))}
            </div>
            <button className="min-h-11 rounded-md border border-slate-400 px-4 font-semibold">บันทึกงบ</button>
          </form>

          <form action={spendAction} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm lg:col-span-2">
            <input type="hidden" name="month" value={month} />
            <h2 className="font-semibold">กรอกค่าใช้จ่ายเอง</h2>
            <p className="text-slate-600">สำหรับช่องทางที่ไม่มีไฟล์ เช่น ค่านายหน้า ป้ายโฆษณา บูธ LINE OA กรอกวัน ช่องทาง และชื่อรายการเดิมซ้ำ จะแทนที่ยอดเดิม</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1">วันที่<input type="date" name="day" required defaultValue={defaultDay} className={input} /></label>
              <label className="flex flex-col gap-1">ช่องทาง
                <select name="channel" className={input}>{M.AD_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1">รายการ<input name="campaign" placeholder="เช่น ป้ายหน้าโครงการ" className={input} /></label>
              <label className="flex flex-col gap-1">จำนวนเงิน (บาท)<input name="amount" required inputMode="decimal" className={input} /></label>
            </div>
            <button className="min-h-11 self-start rounded-md bg-slate-900 px-4 font-semibold text-white">บันทึก</button>
          </form>
        </div>
      )}

      <section className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 font-semibold">แคมเปญเดือนนี้</h2>
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-left text-slate-600"><tr className="border-b border-slate-200"><th className="p-3 font-medium">ช่องทาง</th><th className="p-3 font-medium">แคมเปญ / รายการ</th><th className="p-3 text-right font-medium">วัน</th><th className="p-3 text-right font-medium">ยอด (บาท)</th></tr></thead>
          <tbody>
            {r.campaigns.length === 0 && <tr><td colSpan={4} className="p-4 text-slate-600">ยังไม่มีค่าใช้จ่ายเดือนนี้</td></tr>}
            {r.campaigns.map((c) => (
              <tr key={`${c.channel}|${c.campaign}`} className="border-b border-slate-100">
                <td className="p-3">{CHANNEL_LABEL[c.channel as Channel]}</td><td className="p-3">{c.campaign || "(ไม่ระบุ)"}</td>
                <td className="p-3 text-right">{c.days}</td><td className="p-3 text-right">{baht(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && r.channels.some((c) => c.spend > 0) && (
          <div className="flex flex-wrap gap-2 p-4 text-sm">
            <span className="text-slate-600">นำเข้าผิดไฟล์? ลบค่าใช้จ่ายทั้งเดือนของช่องทาง:</span>
            {r.channels.filter((c) => c.spend > 0).map((c) => (
              <form key={c.channel} action={clearAction}>
                <input type="hidden" name="month" value={month} /><input type="hidden" name="channel" value={c.channel} />
                <button className="min-h-10 rounded-md border border-red-700 px-3 text-red-700">{CHANNEL_LABEL[c.channel]}</button>
              </form>
            ))}
          </div>
        )}
      </section>

      {r.recentSpend.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold">รายการรายวัน (ล่าสุด 50 รายการ)</summary>
          <ul className="mt-3 flex flex-col divide-y divide-slate-100">
            {r.recentSpend.map((s) => (
              <li key={String(s.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{String(s.day)} · {CHANNEL_LABEL[s.channel as Channel]} · {String(s.campaign) || "(ไม่ระบุ)"} <span className="text-xs text-slate-500">{s.source === "csv" ? "นำเข้า" : "กรอกเอง"}</span></span>
                <span className="flex items-center gap-3">{baht(s.amount)} บาท
                  {canEdit && <form action={removeAction}><input type="hidden" name="month" value={month} /><input type="hidden" name="id" value={String(s.id)} /><button className="text-xs text-red-700 underline">ลบ</button></form>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </ProjectShell>
  );
}
