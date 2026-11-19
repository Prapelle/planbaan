import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { createProject } from "@/lib/control";
import { ENT, STATE_LABEL } from "@/lib/entitlement";
import { BackNotice, BackShell } from "@/components/BackShell";
import { STATE_CLS, ago, opsBtn, opsCard, opsInput, projectsOverview } from "../shared";

export const dynamic = "force-dynamic";
const PATH = "/platform/projects";

async function createAction(form: FormData) {
  "use server";
  const { env, staffRole } = await requireStaff();
  if (staffRole !== "admin") redirect(`${PATH}?error=${encodeURIComponent("สร้างโครงการได้เฉพาะ admin")}`);
  let id = "";
  try {
    const p = await createProject(controlDb(env), {
      slug: String(form.get("slug") ?? ""), name: String(form.get("name") ?? ""), ownerEmail: String(form.get("owner") ?? ""),
      kind: String(form.get("kind") ?? "developer"), province: String(form.get("province") ?? ""),
    });
    id = p.id;
  } catch (e) { redirect(`${PATH}?error=${encodeURIComponent((e as Error).message)}#new`); }
  revalidatePath(PATH);
  redirect(`/platform/p/${id}?msg=${encodeURIComponent("สร้างโครงการแล้ว เริ่มช่วงทดลองทันที")}`);
}

const FILTERS: { key: string; label: string; match: (r: { ent: { state: string }; users_7d: number }) => boolean }[] = [
  { key: "", label: "ทั้งหมด", match: () => true },
  { key: "attention", label: "ใกล้หมด + ผ่อนผัน", match: (r) => r.ent.state === "expiring" || r.ent.state === "grace" },
  { key: "expiring", label: STATE_LABEL.expiring, match: (r) => r.ent.state === "expiring" },
  { key: "grace", label: STATE_LABEL.grace, match: (r) => r.ent.state === "grace" },
  { key: "readonly", label: STATE_LABEL.readonly, match: (r) => r.ent.state === "readonly" },
  { key: "idle", label: "ไม่มีคนใช้ 7 วัน", match: (r) => r.users_7d === 0 },
];

export default async function PlatformProjects({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; state?: string }> }) {
  const { env, email, staffRole } = await requireStaff();
  const { error, q = "", state = "" } = await searchParams;
  const { list, counts } = await projectsOverview(env);
  const f = FILTERS.find((x) => x.key === state) ?? FILTERS[0];
  const needle = q.trim().toLowerCase();
  const shown = list.filter((r) => f.match(r) && (!needle || `${r.name} ${r.slug} ${r.province}`.toLowerCase().includes(needle)));
  const href = (key: string) => `${PATH}?${new URLSearchParams({ ...(key ? { state: key } : {}), ...(q ? { q } : {}) })}`;

  return (
    <BackShell env={env} email={email} staffRole={staffRole} active={state === "attention" ? "expiring" : "projects"} alerts={(counts.expiring ?? 0) + (counts.grace ?? 0)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight">โครงการ</h1>
          <p className="mt-1 text-sm text-ops-muted">{counts.total} โครงการ · มีคนใช้ใน 7 วัน {counts.active7} โครงการ</p>
        </div>
        {staffRole === "admin" && <a href="#new" className={`${opsBtn} flex items-center`}>สร้างโครงการ</a>}
      </div>
      <BackNotice error={error} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex min-w-[240px] max-w-sm flex-1 gap-2">
          {state && <input type="hidden" name="state" value={state} />}
          <label className="sr-only" htmlFor="q">ค้นหาโครงการ</label>
          <input id="q" name="q" defaultValue={q} placeholder="ค้นหาชื่อโครงการหรือจังหวัด" className={`${opsInput} flex-1 text-sm`} />
        </form>
        {FILTERS.map((x) => {
          const n = list.filter(x.match).length;
          const on = x.key === f.key;
          return (
            <Link key={x.key} href={href(x.key)} aria-current={on ? "true" : undefined}
              className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${on ? "border-ops-900 bg-ops-900 text-white" : "border-ops-line bg-white text-ops-ink hover:border-ops-600"}`}>
              {x.label} <span className="tabular-nums">{n}</span>
            </Link>
          );
        })}
      </div>

      <div className={`mb-8 overflow-x-auto ${opsCard}`}>
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="text-left text-[13px] text-ops-muted">
            <th className="px-4 py-3 font-semibold">โครงการ</th><th className="px-4 py-3 font-semibold">สิทธิ์ใช้งาน</th>
            <th className="px-4 py-3 font-semibold">ก่อสร้าง</th><th className="px-4 py-3 font-semibold">เริ่มต้นใช้</th><th className="px-4 py-3 font-semibold">ใช้ล่าสุด</th>
            <th className="px-4 py-3 text-right font-semibold">ผู้ใช้ 7 วัน</th><th className="px-4 py-3 text-right font-semibold">สมาชิก</th>
            <th className="px-4 py-3 text-right font-semibold">ข้อมูล (แถว)</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-5 text-ops-muted">ไม่พบโครงการตามเงื่อนไขนี้</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-ops-line hover:bg-ops-bg/60">
                <td className="px-4 py-3"><Link href={`/platform/p/${r.id}`} className="font-semibold text-ops-ink underline-offset-2 hover:underline">{r.name}</Link>
                  <div className="text-xs text-ops-muted">{r.kind === "builder" ? "รับสร้างบ้าน" : "โครงการจัดสรร"}{r.province ? ` · ${r.province}` : ""} · {r.slug}</div></td>
                <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATE_CLS[r.ent.state]}`}>{STATE_LABEL[r.ent.state]}</span>
                  {r.ent.until && <div className="mt-0.5 text-xs text-ops-muted">ถึง {r.ent.until}</div>}</td>
                <td className="px-4 py-3 text-ops-ink">{r.construction_enabled ? "เปิด" : "ปิด"}</td>
                <td className="px-4 py-3"><span className="flex items-center gap-2"><span aria-hidden="true" className="flex gap-0.5">{[1, 2, 3, 4].map((i) => <span key={i} className={`h-2 w-3 rounded-sm ${i <= r.onboard.n ? (r.onboard.n === 4 ? "bg-emerald-600" : "bg-ops-btn") : "bg-ops-line"}`} />)}</span><span className={`text-xs ${r.onboard.n < 4 ? "font-semibold text-ops-ink" : "text-ops-muted"}`}>{r.onboard.label}</span></span></td>
                <td className={`px-4 py-3 ${r.users_7d === 0 ? "font-semibold text-red-700" : ""}`}>{ago(r.last_at)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.users_7d}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.members}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.rows.toLocaleString("th-TH")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {staffRole === "admin" && (
        <form id="new" action={createAction} className={`grid max-w-3xl grid-cols-1 gap-3 p-5 text-sm sm:grid-cols-2 ${opsCard}`}>
          <h2 className="text-base font-bold sm:col-span-2">สร้างโครงการใหม่ <span className="font-normal text-ops-muted">(เริ่มช่วงทดลอง {ENT.trialDays} วันทันที)</span></h2>
          <label className="flex flex-col gap-1">ชื่อโครงการ<input name="name" required className={opsInput} /></label>
          <label className="flex flex-col gap-1">ชื่อย่อสำหรับลิงก์ (a-z 0-9 -)<input name="slug" required pattern="[a-z0-9-]{3,40}" className={opsInput} /></label>
          <label className="flex flex-col gap-1">อีเมลเจ้าของโครงการ<input name="owner" type="email" required className={opsInput} /></label>
          <label className="flex flex-col gap-1">จังหวัด<input name="province" className={opsInput} /></label>
          <label className="flex flex-col gap-1">ประเภท
            <select name="kind" className={opsInput}><option value="developer">โครงการจัดสรร</option><option value="builder">รับสร้างบ้าน</option></select>
          </label>
          <button className={`${opsBtn} self-end`}>สร้างโครงการ</button>
        </form>
      )}
    </BackShell>
  );
}
