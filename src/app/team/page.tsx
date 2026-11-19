import Link from "next/link";
import { ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { stageLabels } from "@/lib/sales";
import { controlDb } from "@/lib/d1";
import { listMembers } from "@/lib/control";
import { ROLE_LABEL, type AccessRole } from "@/lib/roles";
import { shiftMonth, thisMonth } from "@/lib/marketing";
import { teamReport } from "@/lib/team";

export const dynamic = "force-dynamic";
const thMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/team" });
  await ctx.usage("page_view", { page: "team" });
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : thisMonth();
  const members = await listMembers(controlDb(ctx.env), ctx.project.id);
  const r = await teamReport(ctx.db, month, members, new Date(), ctx.project.kind);
  // ฝ่ายขายเห็นตัวเลขของตัวเองและยอดรวมทีม ไม่เห็นรายคนของคนอื่น
  const onlyMe = ctx.role === "sales";
  const rows = onlyMe ? r.rows.filter((x) => x.email === ctx.email) : r.rows;
  const isCurrent = month === thisMonth();
  const L = stageLabels(ctx.project.kind);
  const cols: { k: keyof (typeof r.total); label: string; warn?: boolean }[] = [
    { k: "open", label: "ดูแลอยู่" }, { k: "stale", label: "ค้างติดต่อ", warn: true }, { k: "overdue", label: "นัดเลยกำหนด", warn: true },
    { k: "newLeads", label: "ลูกค้าใหม่" }, { k: "contacts", label: "ติดต่อ" }, { k: "visits", label: L.visited },
    { k: "bookings", label: L.booked }, { k: "transfers", label: L.transferred }, { k: "lost", label: L.lost },
  ];

  return (
    <ProjectShell ctx={ctx} active="/team">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ผลงานรายคน</h1>
          <p className="max-w-2xl text-sm text-slate-600">การติดต่อนับให้คนที่บันทึก {L.visited} {L.booked} {L.transferred} นับให้ผู้ดูแลลูกค้า · ดูแลอยู่ ค้าง และนัดเลยกำหนด เป็นสถานะตอนนี้{onlyMe ? " · คุณเห็นเฉพาะตัวเลขของตัวเองและยอดรวมทีม" : ""}</p>
        </div>
        <nav aria-label="เลือกเดือน" className="flex items-center gap-2 text-sm">
          <Link href={`/team?month=${shiftMonth(month, -1)}`} className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3">‹ ก่อนหน้า</Link>
          <span className="min-w-36 text-center font-semibold">{thMonth(month)}</span>
          {!isCurrent && <Link href={`/team?month=${shiftMonth(month, 1)}`} className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3">ถัดไป ›</Link>}
        </nav>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="text-left text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="p-3 font-medium">ผู้ใช้</th>
              {cols.map((c) => <th key={c.k} className="p-3 text-right font-medium">{c.label}</th>)}
              <th className="p-3 text-right font-medium">ลูกค้าใหม่ → {L.booked}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols.length + 2} className="p-4 text-slate-600">ยังไม่มีข้อมูล</td></tr>}
            {rows.map((p) => (
              <tr key={p.email} className="border-b border-slate-100">
                <td className="p-3"><div className="font-medium">{p.email}</div>{p.role && <div className="text-xs text-slate-600">{ROLE_LABEL[p.role as AccessRole] ?? p.role}</div>}</td>
                {cols.map((c) => <td key={c.k} className={`p-3 text-right tabular-nums ${c.warn && p[c.k] > 0 ? "font-semibold text-red-700" : ""}`}>{p[c.k]}</td>)}
                <td className="p-3 text-right tabular-nums">{pct(p.bookings, p.newLeads)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="p-3">รวมทั้งทีม</td>
              {cols.map((c) => <td key={c.k} className="p-3 text-right tabular-nums">{r.total[c.k]}</td>)}
              <td className="p-3 text-right tabular-nums">{pct(r.total.bookings, r.total.newLeads)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-sm text-slate-600">เปลี่ยนผู้ดูแลลูกค้าได้ที่หน้าลูกค้าแต่ละราย · ลูกค้าที่ยังไม่มีผู้ดูแลแสดงเป็น &quot;(ยังไม่มีผู้ดูแล)&quot;</p>
    </ProjectShell>
  );
}
