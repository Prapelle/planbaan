import Link from "next/link";
import { signOut } from "@/auth";
import type { ProjectCtx } from "@/lib/context";
import { ROLE_LABEL, canGrantSupport, canManageMembers } from "@/lib/roles";

export function ProjectShell({ ctx, active, children }: { ctx: ProjectCtx; active: string; children: React.ReactNode }) {
  const nav = [
    { href: "/", label: "หน้าหลัก", show: true },
    { href: "/members", label: "ผู้ใช้ในโครงการ", show: canManageMembers(ctx.role) },
    { href: "/support", label: "สิทธิ์ทีมช่วยเหลือ", show: canGrantSupport(ctx.role) },
  ].filter((n) => n.show);
  return (
    <div className="flex min-h-screen flex-col">
      {ctx.access.via === "support" && (
        <div role="status" className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
          คุณเข้าโครงการนี้ในฐานะทีมช่วยเหลือ PlanBaan ({ctx.access.supportCanEdit ? "แก้ไขได้" : "ดูอย่างเดียว"}) สิทธิ์หมดอายุ{" "}
          {new Date(ctx.access.grantExpiresAt ?? "").toLocaleString("th-TH")} · ทุกการเข้าถึงถูกบันทึกให้ลูกค้าเห็น
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="text-xs font-semibold tracking-wide text-slate-500">PlanBaan</div>
          <div className="text-lg font-bold">{ctx.project.name}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">{ctx.email} · {ROLE_LABEL[ctx.role]}</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <button className="min-h-11 rounded-md border border-slate-300 px-3 font-medium hover:bg-slate-100">ออกจากระบบ</button>
          </form>
        </div>
      </header>
      <div className="flex flex-1 flex-wrap">
        <nav aria-label="เมนูหลัก" className="flex w-full flex-row gap-1 overflow-x-auto border-b border-slate-200 bg-white p-2 md:w-56 md:flex-col md:border-b-0 md:border-r">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active === n.href ? "page" : undefined}
              className={`flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium ${active === n.href ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
