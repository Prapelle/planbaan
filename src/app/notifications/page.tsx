import Link from "next/link";
import { ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { notifications, type Tone } from "@/lib/notify";

export const dynamic = "force-dynamic";

const DOT: Record<Tone, string> = { red: "bg-red-600", amber: "bg-amber-500", blue: "bg-brand-600" };

export default async function NotificationsPage() {
  const ctx = await requireProject({ action: "view", target: "/notifications" });
  await ctx.usage("page_view", { page: "notifications" });
  const items = await notifications(ctx.db, {
    role: ctx.role, email: ctx.email, kind: ctx.project.kind, construction: !!ctx.project.construction_enabled,
    staleDays: Number(ctx.project.build_stale_days ?? 7), ent: ctx.ent,
  });
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <ProjectShell ctx={ctx} active="/notifications">
      <h1 className="mb-1 text-2xl font-bold">แจ้งเตือน</h1>
      <p className="mb-4 text-sm text-slate-600">เรื่องที่ต้องทำตอนนี้ รายการหายไปเองเมื่อจัดการแล้ว เช่น บันทึกการติดต่อ อนุมัติ หรืออัปเดตงาน</p>
      {items.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-700">ไม่มีเรื่องค้าง เยี่ยมมาก</p>}
      <div className="flex max-w-2xl flex-col gap-5">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="mb-2 text-sm font-semibold text-slate-600">{g} ({items.filter((i) => i.group === g).length})</h2>
            <ul className="flex flex-col gap-2">
              {items.filter((i) => i.group === g).map((i) => (
                <li key={i.key}>
                  <Link href={i.href} className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 hover:border-brand-500">
                    <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[i.tone]}`} />
                    <span className="min-w-0 flex-1"><span className="block font-medium">{i.title}</span>{i.sub && <span className="block text-xs text-slate-600">{i.sub}</span>}</span>
                    <span aria-hidden="true" className="text-slate-400">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ProjectShell>
  );
}
