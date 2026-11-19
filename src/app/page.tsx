import Link from "next/link";
import { ProjectShell } from "@/components/ProjectShell";
import { LegalLinks } from "@/components/LegalPage";
import { cfg, projectUrl, requireProject, sessionEmail, where } from "@/lib/context";
import { controlDb, getEnv } from "@/lib/d1";
import { getStaffRole, listMembers, projectsOfEmail } from "@/lib/control";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as O from "@/lib/onboarding";
import { ROLE_LABEL } from "@/lib/roles";
import * as S from "@/lib/sales";
import * as C from "@/lib/construction";

export const dynamic = "force-dynamic";

export default async function Home() {
  const w = await where();
  if (w.kind === "project") return <ProjectHome />;
  if (w.kind === "unknown") return <main className="p-6">ไม่พบโครงการนี้</main>;

  // หน้าหลักของโดเมนหลัก: รายชื่อโครงการที่ผู้ใช้เป็นสมาชิก
  const email = await sessionEmail();
  if (!email) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-bold">PlanBaan แผนบ้าน</h1>
        <p className="text-slate-600">ระบบติดตามการตลาดและการขายสำหรับเจ้าของโครงการบ้าน</p>
        <Link href="/login" className="flex min-h-11 items-center justify-center rounded-md bg-brand-600 px-4 font-semibold text-white">เข้าสู่ระบบ</Link>
        <LegalLinks />
      </main>
    );
  }
  const env = await getEnv();
  const db = controlDb(env);
  const [mine, staff] = await Promise.all([projectsOfEmail(db, email), getStaffRole(db, email, cfg().initialAdmin)]);
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">โครงการของคุณ</h1>
      <p className="mb-6 text-sm text-slate-600">{email}</p>
      {mine.length === 0 && <p className="rounded-md bg-white p-4 text-slate-700">อีเมลนี้ยังไม่ได้เป็นสมาชิกโครงการใด ติดต่อเจ้าของโครงการให้เพิ่มคุณ</p>}
      <ul className="flex flex-col gap-2">
        {mine.map((p) => (
          <li key={p.slug}>
            <a href={projectUrl(p.slug)} className="flex min-h-14 items-center justify-between rounded-lg border border-slate-200 bg-white px-4 hover:border-brand-500">
              <span className="font-semibold">{p.name}</span>
              <span className="text-sm text-slate-600">{ROLE_LABEL[p.role]}</span>
            </a>
          </li>
        ))}
      </ul>
      {staff && <p className="mt-8"><Link href="/platform" className="font-semibold text-brand-700 underline">Back office ทีม PlanBaan</Link></p>}
    </main>
  );
}

async function hideOnboarding() {
  "use server";
  const ctx = await requireProject({ action: "edit", target: "/" });
  if (ctx.role === "owner" || ctx.role === "manager") await O.setFlag(ctx.db, "onboarding_hidden");
  revalidatePath("/");
  redirect("/");
}

async function ProjectHome() {
  const ctx = await requireProject({ action: "view", target: "/" });
  await ctx.usage("page_view", { page: "home" });
  const builder = ctx.project.kind === "builder";
  const month = S.bkkDate().slice(0, 7);
  const boss = ctx.role === "owner" || ctx.role === "manager";
  const [o, board, spendRows, onboarding] = await Promise.all([
    S.overview(ctx.db, new Date(), ctx.project.kind),
    ctx.project.construction_enabled ? C.buildBoard(ctx.db, Number(ctx.project.build_stale_days ?? 7)) : Promise.resolve(null),
    ctx.db.list("marketing_spend", { where: { month }, limit: 2000, columns: ["amount"] }),
    // เช็กลิสต์เริ่มต้นใช้ (เจ้าของ/ผู้จัดการ) อ่านพร้อมส่วนอื่น ไม่ทำให้หน้าช้าลง
    boss ? listMembers(controlDb(ctx.env), ctx.project.id).then((m) => O.checklist(ctx.db, { kind: ctx.project.kind, construction: !!ctx.project.construction_enabled, members: m.length })) : Promise.resolve(null),
  ]);
  // ต้นทุนต่อลูกค้าเดือนนี้ = ค่าโฆษณาเดือนนี้ ÷ ลูกค้าที่เข้ามาเดือนนี้ (ตามแผน: หน้าภาพรวมต้องเห็นต้นทุนต่อ lead)
  const spend = spendRows.reduce((a, r) => a + Number(r.amount), 0);
  const leadNote = `เดือนนี้ +${o.newThisMonth}${spend > 0 && o.newThisMonth > 0 ? ` · ต้นทุน ${Math.round(spend / o.newThisMonth).toLocaleString("th-TH")} บาท/ราย` : ""}`;
  const L = S.stageLabels(ctx.project.kind);
  const maxStage = Math.max(1, ...S.PIPELINE.map((s) => o.byStage[s]));
  const kpis = builder ? [
    { label: "ลูกค้าทั้งหมด", value: o.totalLeads, note: leadNote },
    { label: `${L.visited}ขึ้นไป`, value: o.reachedVisit, note: "นับรวมขั้นที่เลยมาแล้ว" },
    { label: `${L.booked}ขึ้นไป`, value: o.reachedBooked, note: `${L.booked} ${L.loan} ${L.transferred}` },
    { label: L.transferred, value: o.transferred, note: "หลัง" },
    { label: "กำลังสร้าง", value: board?.counts.active ?? 0, note: board ? `ช้ากว่าแผน ${board.counts.late}` : "ยังไม่เปิดส่วนก่อสร้าง" },
    { label: `ค้างติดตามเกิน ${S.STALE_DAYS} วัน`, value: o.stale.length, note: "ราย" },
  ] : [
    { label: "ลูกค้าทั้งหมด", value: o.totalLeads, note: leadNote },
    { label: "เข้าชมแล้วขึ้นไป", value: o.reachedVisit, note: "นับรวมขั้นที่เลยมาแล้ว" },
    { label: "จองขึ้นไป", value: o.reachedBooked, note: "จอง ยื่นกู้ และโอน" },
    { label: "โอนแล้ว", value: o.transferred, note: `จาก ${o.totalPlots} แปลง` },
    { label: "แปลงว่าง", value: o.plotStatus.available, note: o.plotStatus.rent ? `ให้เช่า ${o.plotStatus.rent}` : "ยังไม่มีผู้จอง" },
    { label: `ค้างติดตามเกิน ${S.STALE_DAYS} วัน`, value: o.stale.length, note: "ราย" },
  ];
  const watch = board ? board.all.filter((b) => b.build.status !== "done" && (b.stale || b.lateDays > 0 || b.overdueDays > 0 || b.payDue > 0)).slice(0, 8) : [];
  const LeadRow = ({ l, right }: { l: Record<string, unknown>; right: string }) => (
    <li><Link href={`/leads/${l.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-slate-200 px-3 hover:border-brand-500">
      <span><b>{String(l.name)}</b> <span className="text-xs text-slate-600">{S.stageLabels(ctx.project.kind)[l.stage as S.Stage]} · {S.CHANNEL_LABEL[l.channel as S.Channel] ?? ""}</span></span>
      <span className="whitespace-nowrap text-sm font-semibold">{right}</span>
    </Link></li>
  );
  return (
    <ProjectShell ctx={ctx} active="/">
      <h1 className="mb-4 text-2xl font-bold">ภาพรวม</h1>
      {onboarding && !onboarding.hidden && !onboarding.done && (
        <section aria-label="เริ่มต้นใช้งาน" className="mb-5 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-brand-800">เริ่มต้นใช้งาน {onboarding.steps.filter((x) => x.done).length}/{onboarding.steps.length}</h2>
            {!ctx.readonly && <form action={hideOnboarding}><button className="min-h-10 rounded-md px-3 text-sm text-slate-600 underline hover:text-slate-900">ซ่อน</button></form>}
          </div>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {onboarding.steps.map((st, i) => (
              <li key={st.key}>
                <Link href={st.href} className={`flex h-full items-start gap-3 rounded-lg border bg-white p-3 ${st.done ? "border-emerald-200" : "border-slate-200 hover:border-brand-500"}`}>
                  <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${st.done ? "bg-emerald-600 text-white" : "bg-brand-100 text-brand-800"}`}>{st.done ? "✓" : i + 1}</span>
                  <span><span className={`block font-semibold ${st.done ? "text-slate-500 line-through" : ""}`}>{st.label}</span><span className="block text-xs text-slate-600">{st.done ? "เสร็จแล้ว" : st.hint}</span></span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">{k.label}</div>
            <div className="text-3xl font-bold tabular-nums">{k.value}</div>
            <div className="text-xs text-slate-600">{k.note}</div>
          </div>
        ))}
      </div>
      {board && (
        <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">ก่อสร้าง · กำลังสร้าง {board.counts.active} หลัง</h2>
            <Link href="/build" className="text-sm text-brand-700 underline">ดูทั้งหมด</Link>
          </div>
          {watch.length === 0 ? <p className="text-sm text-slate-600">ไม่มีหลังที่ช้า ค้างอัปเดต หรือรอเก็บเงิน</p> : (
            <ul className="flex flex-col gap-2">
              {watch.map((b) => (
                <li key={b.build.id}><Link href={`/build/${b.build.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-1 hover:border-brand-500">
                  <span><b>{String(b.build.title)}</b> <span className="text-xs text-slate-600">{b.pct}% · {b.current ? String(b.current.name) : "ครบงวด"}</span></span>
                  <span className="flex flex-wrap gap-2 text-xs font-semibold">
                    {b.lateDays > 0 && <span className="text-red-700">ช้า {b.lateDays} วัน</span>}
                    {b.stale && <span className="text-red-700">ไม่อัปเดต {b.idleDays} วัน</span>}
                    {b.payDue > 0 && <span className="text-amber-800">รอเก็บ {b.payDue.toLocaleString("th-TH")} บาท</span>}
                  </span>
                </Link></li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold">ลูกค้าในแต่ละขั้น</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {S.PIPELINE.map((s) => (
              <li key={s} className="flex items-center gap-3">
                <span className="w-28 shrink-0">{S.stageLabels(ctx.project.kind)[s]}</span>
                <span className="h-3 flex-1 rounded bg-slate-200"><span className="block h-3 rounded bg-brand-600" style={{ width: `${(o.byStage[s] / maxStage) * 100}%` }} /></span>
                <span className="w-8 text-right font-semibold tabular-nums">{o.byStage[s]}</span>
              </li>
            ))}
            <li className="flex items-center gap-3 text-slate-600"><span className="w-28 shrink-0">{L.lost}</span><span className="flex-1" /><span className="w-8 text-right tabular-nums">{o.byStage.lost}</span></li>
          </ul>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold">ต้องติดตามวันนี้</h2>
          {o.followToday.length === 0 && o.stale.length === 0 && <p className="text-sm text-slate-600">ไม่มีลูกค้าค้างติดตาม</p>}
          <ul className="flex flex-col gap-2">
            {o.followToday.slice(0, 8).map((l) => <LeadRow key={String(l.id)} l={l} right={`นัด ${l.next_follow_at}`} />)}
            {o.stale.filter((l) => !o.followToday.includes(l)).slice(0, 8).map((l) => <LeadRow key={String(l.id)} l={l} right={`ค้าง ${S.daysSince(String(l.last_contact_at))} วัน`} />)}
          </ul>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 font-semibold">ลูกค้าตามช่องทาง</h2>
          {o.byChannel.length === 0 ? <p className="text-sm text-slate-600">ยังไม่มีลูกค้า</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="text-right text-slate-600"><th className="p-2 text-left font-medium">ช่องทาง</th><th className="p-2 font-medium">ลูกค้า</th><th className="p-2 font-medium">{L.visited}</th><th className="p-2 font-medium">{L.booked}ขึ้นไป</th><th className="p-2 font-medium">อัตรา{L.booked}</th></tr></thead>
                <tbody>{o.byChannel.map((c) => (
                  <tr key={c.channel} className="border-t border-slate-200 text-right tabular-nums">
                    <th scope="row" className="p-2 text-left font-medium">{S.CHANNEL_LABEL[c.channel]}</th>
                    <td className="p-2">{c.leads}</td><td className="p-2">{c.visited}</td><td className="p-2">{c.booked}</td>
                    <td className="p-2">{Math.round((c.booked / c.leads) * 100)}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-600">ต้นทุนต่อลูกค้าและต่อการจองแยกตามช่องทาง ดูที่หน้า<Link href="/marketing" className="text-brand-700 underline">การตลาด</Link></p>
        </section>
      </div>
    </ProjectShell>
  );
}
