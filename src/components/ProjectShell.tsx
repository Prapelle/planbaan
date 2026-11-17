import Link from "next/link";
import { signOut } from "@/auth";
import type { ProjectCtx } from "@/lib/context";
import { SOURCE_LABEL } from "@/lib/entitlement";
import { ROLE_LABEL, canExport, canGrantSupport, canManageMembers } from "@/lib/roles";

export function ProjectShell({ ctx, active, children }: { ctx: ProjectCtx; active: string; children: React.ReactNode }) {
  const builder = ctx.project.kind === "builder";
  const foreman = ctx.role === "foreman";
  const build = { href: "/build", label: builder ? "งานก่อสร้าง" : "ก่อสร้าง", show: true };
  const nav = foreman ? [build] : [
    { href: "/", label: "ภาพรวม", show: true },
    ...(builder ? [build] : []),
    { href: "/plots", label: "ผังแปลง", show: !builder },
    { href: "/leads", label: "ลูกค้า", show: true },
    { href: "/loans", label: "สินเชื่อ", show: !builder },
    ...(builder ? [] : [build]),
    { href: "/marketing", label: "การตลาด", show: true },
    { href: "/team", label: "ผลงานรายคน", show: true },
    { href: "/export", label: "ส่งออกข้อมูล", show: canExport(ctx.role) },
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
      <EntBanner ctx={ctx} />
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
      <div className="flex flex-1 flex-col md:flex-row">
        <nav aria-label="เมนูหลัก" className="flex w-full flex-row gap-1 overflow-x-auto border-b border-slate-200 bg-white p-2 md:w-52 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
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

export function Notice({ error, msg }: { error?: string; msg?: string }) {
  if (error) return <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (msg) return <p role="status" className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>;
  return null;
}

export const SALE_COLOR: Record<string, string> = {
  available: "bg-white text-slate-900 border-slate-400",
  booked: "bg-amber-300 text-slate-900 border-amber-500",
  loan: "bg-blue-700 text-white border-blue-800",
  transferred: "bg-slate-900 text-white border-slate-900",
  rent: "bg-violet-700 text-white border-violet-800",
};

const thDay = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");

/** แถบเตือนสิทธิ์ใช้งาน: เห็นเฉพาะเจ้าของ/ผู้จัดการ ยกเว้นโหมดดูอย่างเดียวที่ทุกคนต้องรู้ */
function EntBanner({ ctx }: { ctx: ProjectCtx }) {
  const e = ctx.ent;
  const boss = ctx.role === "owner" || ctx.role === "manager";
  if (e.state === "readonly")
    return <div role="alert" className="bg-red-700 px-4 py-2 text-sm text-white">
      โครงการอยู่ในโหมดดูอย่างเดียว ดูและส่งออกข้อมูลได้ แต่แก้ไขไม่ได้ ข้อมูลทั้งหมดยังอยู่ครบ{boss ? " · ติดต่อทีม PlanBaan เพื่อต่อสิทธิ์" : " · แจ้งเจ้าของโครงการ"}
    </div>;
  if (!boss) return null;
  if (e.state === "grace")
    return <div role="alert" className="bg-red-50 px-4 py-2 text-sm font-medium text-red-800">
      สิทธิ์ใช้งาน ({SOURCE_LABEL[e.source]}) หมดเมื่อ {thDay(e.until)} ยังใช้งานได้ถึง {thDay(e.readonlyFrom)} หลังจากนั้นจะเป็นโหมดดูอย่างเดียว
    </div>;
  if (e.state === "expiring")
    return <div role="status" className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
      สิทธิ์ใช้งาน ({SOURCE_LABEL[e.source]}) ถึง {thDay(e.until)} อีก {e.daysLeft} วัน · ใช้ฟรีต่อเมื่อยอดซื้อ Pure Product ถึงขั้นต่ำ
    </div>;
  return null;
}
