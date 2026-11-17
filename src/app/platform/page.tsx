import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cfg, requireStaff } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { createProject, listStaff, removeStaff, upsertStaff } from "@/lib/control";
import { featureAdoption, usageSummary } from "@/lib/usage";
import { rowCountsByProject } from "@/lib/tenant-db";
import { shardBindings } from "@/lib/backup";
import { ENT, STATE_LABEL, entitlementOf, type EntState } from "@/lib/entitlement";
import type { D1Like } from "@/lib/d1";

export const dynamic = "force-dynamic";

/**
 * Back office ทีม PlanBaan
 * เห็นเฉพาะสถิติการใช้งานและข้อมูลระดับบัญชี (ชื่อโครงการ เจ้าของ สิทธิ์ใช้งาน) — ไม่เห็นแปลงหรือลูกค้าของโครงการ
 */
const err = (path: string, e: unknown) => redirect(`${path}?error=${encodeURIComponent((e as Error).message)}`);

async function createAction(form: FormData) {
  "use server";
  const { env, staffRole } = await requireStaff();
  if (staffRole !== "admin") err("/platform", new Error("สร้างโครงการได้เฉพาะ admin"));
  try {
    await createProject(controlDb(env), {
      slug: String(form.get("slug") ?? ""), name: String(form.get("name") ?? ""), ownerEmail: String(form.get("owner") ?? ""),
      kind: String(form.get("kind") ?? "developer"), province: String(form.get("province") ?? ""),
    });
  } catch (e) { err("/platform", e); }
  revalidatePath("/platform");
  redirect("/platform");
}

async function staffAction(form: FormData) {
  "use server";
  const { env, email, staffRole } = await requireStaff();
  if (staffRole !== "admin") err("/platform", new Error("จัดการทีมงานได้เฉพาะ admin"));
  const target = String(form.get("email") ?? "");
  try {
    if (form.get("remove")) await removeStaff(controlDb(env), target, email);
    else await upsertStaff(controlDb(env), target, String(form.get("role") ?? "support"));
  } catch (e) { err("/platform", e); }
  revalidatePath("/platform");
  redirect("/platform#staff");
}

const ago = (iso: string | null) => {
  if (!iso) return "ยังไม่เคยใช้";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
  return d <= 0 ? "วันนี้" : `${d} วันก่อน`;
};
const STATE_CLS: Record<EntState, string> = {
  active: "bg-emerald-100 text-emerald-900", expiring: "bg-amber-100 text-amber-900", grace: "bg-red-100 text-red-800", readonly: "bg-red-700 text-white",
};
const PAGE_LABEL: Record<string, string> = { build: "ก่อสร้าง", build_detail: "ก่อสร้างรายหลัง",  home: "ภาพรวม", plots: "ผังแปลง", leads: "ลูกค้า", lead: "ลูกค้ารายคน", loans: "สินเชื่อ", marketing: "การตลาด", team: "ผลงานรายคน", members: "ผู้ใช้", support: "สิทธิ์ทีมช่วยเหลือ" };
const input = "min-h-11 rounded-md border border-slate-300 px-3";

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; state?: string }> }) {
  const { env, email, staffRole } = await requireStaff();
  const { error, q = "", state = "" } = await searchParams;
  const control = controlDb(env);
  const [rows, adoption, staff] = await Promise.all([usageSummary(control), featureAdoption(control), listStaff(control)]);
  const sizes: Record<string, number> = {};
  for (const b of shardBindings(env)) for (const [k, v] of Object.entries(await rowCountsByProject(env[b] as D1Like))) sizes[k] = (sizes[k] ?? 0) + v;
  const totalRows = Object.values(sizes).reduce((a, n) => a + n, 0);
  const list = rows.map((r) => ({ ...r, ent: entitlementOf(r) }));
  const counts = { total: list.length, active7: list.filter((r) => r.users_7d > 0).length } as Record<string, number>;
  for (const s of Object.keys(STATE_LABEL)) counts[s] = list.filter((r) => r.ent.state === s).length;
  const needle = q.trim().toLowerCase();
  const shown = list.filter((r) => (!needle || `${r.name} ${r.slug} ${r.province}`.toLowerCase().includes(needle)) && (!state || r.ent.state === state || (state === "idle" && r.users_7d === 0)));
  const maxAdopt = Math.max(1, counts.total);

  const cards = [
    { label: "โครงการทั้งหมด", value: counts.total, href: "/platform" },
    { label: "มีคนใช้ใน 7 วัน", value: counts.active7, href: "/platform" },
    { label: "ไม่มีคนใช้ 7 วัน", value: counts.total - counts.active7, href: "/platform?state=idle", warn: true },
    { label: "ใกล้หมดสิทธิ์", value: counts.expiring, href: "/platform?state=expiring", warn: true },
    { label: "ผ่อนผัน", value: counts.grace, href: "/platform?state=grace", warn: true },
    { label: "ดูอย่างเดียว", value: counts.readonly, href: "/platform?state=readonly", warn: true },
  ];

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Back office PlanBaan</h1>
        <span className="text-sm text-slate-600">{email} · {staffRole}</span>
      </div>
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-500">
            <div className="text-xs text-slate-600">{c.label}</div>
            <div className={`text-2xl font-bold ${c.warn && c.value > 0 ? "text-red-700" : ""}`}>{c.value}</div>
          </Link>
        ))}
      </div>
      <p className="mb-4 text-sm text-slate-600">ข้อมูลรวม {totalRows.toLocaleString("th-TH")} แถว (ฐานข้อมูลหนึ่งก้อนเก็บได้สูงสุด 10 GB ดู docs/OPERATIONS.md) · ทดลอง {ENT.trialDays} วัน · ขั้นต่ำ Pure Product {ENT.pureMin.toLocaleString("th-TH")} บาทต่อ {ENT.windowMonths} เดือน · ผ่อนผัน {ENT.graceDays} วัน</p>

      <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">ค้นหาโครงการ<input name="q" defaultValue={q} placeholder="ชื่อ ชื่อย่อ จังหวัด" className={input} /></label>
        <label className="flex flex-col gap-1">สถานะ
          <select name="state" defaultValue={state} className={input}>
            <option value="">ทั้งหมด</option>
            {Object.entries(STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="idle">ไม่มีคนใช้ 7 วัน</option>
          </select>
        </label>
        <button className="min-h-11 rounded-md border border-slate-400 px-4 font-semibold">กรอง</button>
      </form>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr className="text-left text-slate-600">
            <th className="p-3 font-medium">โครงการ</th><th className="p-3 font-medium">จังหวัด</th><th className="p-3 font-medium">สิทธิ์</th>
            <th className="p-3 font-medium">ใช้ล่าสุด</th><th className="p-3 text-right font-medium">ผู้ใช้ 7 วัน</th><th className="p-3 text-right font-medium">การใช้งาน 7 วัน</th>
            <th className="p-3 text-right font-medium">สมาชิก</th><th className="p-3 text-right font-medium">ข้อมูล (แถว)</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8} className="p-4 text-slate-600">ไม่พบโครงการ</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-slate-200">
                <td className="p-3"><Link href={`/platform/p/${r.id}`} className="font-semibold text-brand-700 underline">{r.name}</Link>
                  <div className="text-xs text-slate-600">{r.slug} · {r.kind === "builder" ? "รับสร้างบ้าน" : "โครงการจัดสรร"}</div></td>
                <td className="p-3">{r.province || "-"}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CLS[r.ent.state]}`}>{STATE_LABEL[r.ent.state]}</span>
                  {r.ent.until && <div className="text-xs text-slate-600">ถึง {r.ent.until}</div>}</td>
                <td className="p-3">{ago(r.last_at)}</td>
                <td className="p-3 text-right tabular-nums">{r.users_7d}</td>
                <td className="p-3 text-right tabular-nums">{r.events_7d}</td>
                <td className="p-3 text-right tabular-nums">{r.members}</td>
                <td className="p-3 text-right tabular-nums">{(sizes[r.id] ?? 0).toLocaleString("th-TH")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">ฟีเจอร์ที่ถูกใช้ (30 วัน)</h2>
        <p className="mb-3 text-sm text-slate-600">จำนวนโครงการที่เปิดหน้านั้นอย่างน้อยหนึ่งครั้ง จากทั้งหมด {counts.total} โครงการ</p>
        <ul className="flex flex-col gap-2 text-sm">
          {adoption.length === 0 && <li className="text-slate-600">ยังไม่มีข้อมูล</li>}
          {adoption.map((a) => (
            <li key={a.page} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3">
              <span>{PAGE_LABEL[a.page] ?? a.page}</span>
              <div className="h-4 rounded bg-slate-100" aria-hidden="true"><div className="h-4 rounded bg-brand-600" style={{ width: `${(a.projects / maxAdopt) * 100}%` }} /></div>
              <span className="whitespace-nowrap tabular-nums text-slate-700">{a.projects} โครงการ · {a.views.toLocaleString("th-TH")} ครั้ง</span>
            </li>
          ))}
        </ul>
      </section>

      {staffRole === "admin" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <form action={createAction} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <div className="font-semibold sm:col-span-2">สร้างโครงการใหม่ (เริ่มช่วงทดลอง {ENT.trialDays} วันทันที)</div>
            <label className="flex flex-col gap-1 text-sm">ชื่อโครงการ<input name="name" required className={input} /></label>
            <label className="flex flex-col gap-1 text-sm">ชื่อย่อสำหรับลิงก์ (a-z 0-9 -)<input name="slug" required pattern="[a-z0-9-]{3,40}" className={input} /></label>
            <label className="flex flex-col gap-1 text-sm">อีเมลเจ้าของโครงการ<input name="owner" type="email" required className={input} /></label>
            <label className="flex flex-col gap-1 text-sm">จังหวัด<input name="province" className={input} /></label>
            <label className="flex flex-col gap-1 text-sm">ประเภท
              <select name="kind" className={input}><option value="developer">โครงการจัดสรร</option><option value="builder">รับสร้างบ้าน</option></select>
            </label>
            <button className="min-h-11 self-end rounded-md bg-brand-600 px-4 font-semibold text-white">สร้างโครงการ</button>
          </form>

          <section id="staff" className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h2 className="font-semibold">ทีม PlanBaan</h2>
            <p className="text-slate-600">admin: สร้างโครงการ ต่อสิทธิ์ จัดการทีม · support: ดูสถิติ บันทึกยอดซื้อ · ทั้งสองแบบไม่เห็นข้อมูลลูกค้า เว้นแต่ลูกค้าเปิดสิทธิ์ให้</p>
            <ul className="flex flex-col divide-y divide-slate-100">
              {cfg().initialAdmin && <li className="flex justify-between py-2"><span>{cfg().initialAdmin}</span><span className="text-slate-600">admin (ตั้งในระบบ)</span></li>}
              {staff.map((s) => (
                <li key={s.email} className="flex items-center justify-between gap-2 py-2">
                  <span>{s.email} <span className="text-slate-600">· {s.role}</span></span>
                  {s.email !== email && <form action={staffAction}><input type="hidden" name="email" value={s.email} /><input type="hidden" name="remove" value="1" /><button className="text-xs text-red-700 underline">ลบ</button></form>}
                </li>
              ))}
            </ul>
            <form action={staffAction} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">อีเมล<input name="email" type="email" required className={input} /></label>
              <label className="flex flex-col gap-1">บทบาท<select name="role" className={input}><option value="support">support</option><option value="admin">admin</option></select></label>
              <button className="min-h-11 rounded-md border border-slate-400 px-4 font-semibold">เพิ่ม / เปลี่ยน</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
