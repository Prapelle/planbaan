import Link from "next/link";
import { signOut } from "@/auth";
import { controlDb, type WorkerEnv } from "@/lib/d1";
import { listProjects } from "@/lib/control";
import { entitlementOf } from "@/lib/entitlement";
import { Icon } from "./ProjectShell";

/**
 * หลังบ้าน (ทีม PlanBaan): แถบเมนูกรมท่า + เขียวมิ้นต์ ต่างจากหน้าบ้านสีน้ำเงินทันทีที่เห็น
 * เห็นเฉพาะข้อมูลระดับบัญชีและสถิติการใช้งาน ไม่แสดงข้อมูลลูกค้าของโครงการ
 */
export type BackActive = "overview" | "projects" | "expiring" | "staff";

import { SubmitGuard } from "./SubmitGuard";

export async function BackShell({ env, email, staffRole, active, children, alerts: known }: {
  env: WorkerEnv; email: string; staffRole: string; active: BackActive; children: React.ReactNode;
  /** หน้าที่คำนวณสิทธิ์ของทุกโครงการอยู่แล้วส่งมาเลย ไม่ต้องอ่านฐานข้อมูลซ้ำ */
  alerts?: number;
}) {
  // ตัวเลขบนเมนู "ใกล้หมดสิทธิ์" = ใกล้หมด + ผ่อนผัน (โครงการมีไม่มาก คำนวณจากตาราง projects ตรง ๆ)
  let alerts = known ?? 0;
  if (known === undefined) try { alerts = (await listProjects(controlDb(env))).map((p) => entitlementOf(p).state).filter((s) => s === "expiring" || s === "grace").length; } catch { /* แสดงเมนูต่อได้ */ }
  const nav: { key: BackActive; href: string; label: string; icon: string; badge?: number }[] = [
    { key: "overview", href: "/platform", label: "ภาพรวมระบบ", icon: "team" },
    { key: "projects", href: "/platform/projects", label: "โครงการ", icon: "home" },
    { key: "expiring", href: "/platform/projects?state=attention", label: "ใกล้หมดสิทธิ์", icon: "shield", badge: alerts },
    { key: "staff", href: "/platform/staff", label: "ทีมงาน PlanBaan", icon: "users" },
  ];
  const logout = async () => { "use server"; await signOut({ redirectTo: "/login" }); };

  return (
    <div className="flex min-h-screen flex-col bg-ops-bg text-ops-ink md:flex-row">
      <SubmitGuard />
      <aside className="flex shrink-0 flex-col gap-5 bg-ops-900 px-3 py-4 text-ops-200 md:min-h-screen md:w-60 md:py-5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold text-white">PlanBaan</span>
              <span className="rounded-md bg-ops-mint px-2 text-xs font-bold leading-5 text-ops-900">หลังบ้าน</span>
            </div>
            <p className="hidden text-xs leading-relaxed text-ops-300 md:block">เห็นเฉพาะทีม PlanBaan ไม่แสดงข้อมูลลูกค้าของโครงการ</p>
          </div>
        </div>
        <nav aria-label="เมนูหลังบ้าน" className="flex flex-row gap-1 overflow-x-auto md:flex-col md:gap-0.5">
          {nav.map((n) => (
            <Link key={n.key} href={n.href} aria-current={active === n.key ? "page" : undefined}
              className={`flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium focus-visible:outline-ops-mint ${active === n.key ? "bg-ops-700 font-semibold text-ops-mint" : "hover:bg-ops-800 hover:text-white"}`}>
              <Icon name={n.icon} />
              <span className="flex-1">{n.label}</span>
              {!!n.badge && <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-ops-mint px-1.5 text-xs font-bold text-ops-900">{n.badge}</span>}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ops-700 px-2 pt-4 md:mt-auto md:flex-col md:items-stretch">
          <div className="flex flex-col">
            <span className="break-all text-[13px] font-semibold text-white">{email}</span>
            <span className="text-xs text-ops-300">{staffRole}</span>
          </div>
          <form action={logout}><button className="min-h-10 w-full rounded-lg border border-ops-600 px-3 text-[13px] font-medium text-ops-200 hover:bg-ops-800 focus-visible:outline-ops-mint">ออกจากระบบ</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-7">{children}</main>
    </div>
  );
}

export function BackNotice({ error, msg }: { error?: string; msg?: string }) {
  if (error) return <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (msg) return <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>;
  return null;
}
