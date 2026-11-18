import Link from "next/link";
import { signOut } from "@/auth";
import { cfg, type ProjectCtx } from "@/lib/context";
import type { CountSpec } from "@/lib/tenant-db";
import { STALE_DAYS as S_STALE_DAYS } from "@/lib/sales";
import { SOURCE_LABEL } from "@/lib/entitlement";
import { ROLE_LABEL, canExport, canGrantSupport, canManageMembers, canSeeCosts } from "@/lib/roles";

/** ไอคอนเส้น (ตกแต่ง ซ่อนจากโปรแกรมอ่านหน้าจอ) */
const ICON: Record<string, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  plots: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8",
  loan: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  build: "M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6",
  mkt: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1M16 9a3 3 0 0 1 0 6M19 6a7 7 0 0 1 0 12",
  team: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  member: "M15 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  export: "M12 3v12M7 10l5 5 5-5M4 21h16",
  menu: "M4 6h16M4 12h16M4 18h16",
  profit: "M3 17l5-5 4 4 8-8M15 8h5v5",
  guide: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8M8 11h6",
  close: "M6 6l12 12M18 6L6 18",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={ICON[name]} />
    </svg>
  );
}

type NavItem = { href: string; label: string; icon: string; badge?: number };
type NavGroup = { title: string; items: NavItem[] };

/** ตัวเลขเตือนบนเมนู: ลูกค้าค้างติดตาม และงานก่อสร้างที่ไม่มีคนอัปเดต — นับในคำสั่งเดียว */
async function badgeCounts(ctx: ProjectCtx) {
  if (ctx.role === "foreman" && !ctx.project.construction_enabled) return { leads: 0, build: 0 };
  const now = Date.now();
  const staleLead = new Date(now - (S_STALE_DAYS + 1) * 86400_000).toISOString();
  const staleBuild = new Date(now - (Number(ctx.project.build_stale_days ?? 7) + 1) * 86400_000).toISOString();
  try {
    const specs: CountSpec[] = [{ table: "leads", notIn: { stage: ["lost", "transferred"], last_contact_at: [""] }, lt: { last_contact_at: staleLead } }];
    if (ctx.project.construction_enabled) specs.push({ table: "builds", where: { status: "active" }, lt: { last_update_at: staleBuild } });
    const [leads, build = 0] = await ctx.db.countMany(specs);
    return { leads: ctx.role === "foreman" ? 0 : leads, build };
  } catch { return { leads: 0, build: 0 }; }
}

function navGroups(ctx: ProjectCtx, b: { leads: number; build: number }): NavGroup[] {
  const builder = ctx.project.kind === "builder";
  const build: NavItem = { href: "/build", label: builder ? "งานก่อสร้าง" : "ก่อสร้าง", icon: "build", badge: b.build };
  const guide: NavItem = { href: "/guide", label: "คู่มือการใช้งาน", icon: "guide" };
  if (ctx.role === "foreman") return [{ title: "", items: [build, guide] }];
  const groups: NavGroup[] = [
    { title: "", items: [{ href: "/", label: "ภาพรวม", icon: "home" }] },
    { title: "งานขาย", items: builder
      ? [{ href: "/leads", label: "ลูกค้า", icon: "users", badge: b.leads }]
      : [{ href: "/plots", label: "ผังแปลง", icon: "plots" }, { href: "/leads", label: "ลูกค้า", icon: "users", badge: b.leads }, { href: "/loans", label: "สินเชื่อ", icon: "loan" }] },
    { title: "งานก่อสร้าง", items: [build] },
    { title: "วัดผล", items: [
      { href: "/marketing", label: "การตลาด", icon: "mkt" }, { href: "/team", label: "ผลงานรายคน", icon: "team" },
      ...(ctx.project.construction_enabled && canSeeCosts(ctx.role) ? [{ href: "/profit", label: "กำไรรายหลัง", icon: "profit" }] : []),
    ] },
    { title: "ตั้งค่าโครงการ", items: [
      ...(canManageMembers(ctx.role) ? [{ href: "/members", label: "ผู้ใช้ในโครงการ", icon: "member" }] : []),
      ...(canGrantSupport(ctx.role) ? [{ href: "/support", label: "สิทธิ์ทีมช่วยเหลือ", icon: "shield" }] : []),
      ...(canExport(ctx.role) ? [{ href: "/export", label: "ส่งออกข้อมูล", icon: "export" }] : []),
    ] },
    { title: "ช่วยเหลือ", items: [guide] },
  ];
  return groups.filter((g) => g.items.length);
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-bold text-red-800">{n > 99 ? "99+" : n}<span className="sr-only"> รายการที่ต้องตาม</span></span>;
}

function NavList({ groups, active, big }: { groups: NavGroup[]; active: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {g.title && <div className="px-3 pb-1 text-xs font-semibold text-slate-500">{g.title}</div>}
          {g.items.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active === n.href ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 font-medium ${big ? "min-h-12 text-[15px]" : "min-h-11 text-sm"} ${active === n.href ? "bg-brand-100 font-semibold text-brand-800" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}>
              <Icon name={n.icon} size={big ? 20 : 18} />
              <span className="flex-1">{n.label}</span>
              <Badge n={n.badge} />
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

export async function ProjectShell({ ctx, active, children }: { ctx: ProjectCtx; active: string; children: React.ReactNode }) {
  const badges = await badgeCounts(ctx);
  const groups = navGroups(ctx, badges);
  const builder = ctx.project.kind === "builder";
  const foreman = ctx.role === "foreman";
  const flat = groups.flatMap((g) => g.items);
  const pick = (href: string) => flat.find((n) => n.href === href);
  const tabs = (builder ? ["/", "/build", "/leads", "/marketing"] : ["/", "/plots", "/leads", "/build"]).map(pick).filter((n): n is NavItem => !!n);
  const base = cfg().baseDomain;
  const switchHref = base ? `https://${base}/` : "/api/dev/project?slug=&next=/";
  const kindLabel = builder ? "รับสร้างบ้าน" : "โครงการจัดสรร";
  const logout = async () => { "use server"; await signOut({ redirectTo: "/login" }); };
  const account = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="break-all text-[13px] font-semibold">{ctx.email}</span>
        <span className="text-xs text-slate-600">{ROLE_LABEL[ctx.role]}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={switchHref} className="flex min-h-10 flex-1 whitespace-nowrap items-center justify-center rounded-lg border border-slate-300 px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-100">โครงการอื่น</a>
        <form action={logout} className="flex flex-1"><button className="min-h-10 flex-1 whitespace-nowrap rounded-lg border border-slate-300 px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-100">ออกจากระบบ</button></form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {ctx.access.via === "support" && (
        <div role="status" className="bg-ops-900 px-4 py-2 text-sm text-white">
          <span className="font-semibold text-ops-mint">ทีม PlanBaan</span> คุณเข้าโครงการนี้ในฐานะทีมช่วยเหลือ ({ctx.access.supportCanEdit ? "แก้ไขได้" : "ดูอย่างเดียว"}) สิทธิ์หมดอายุ{" "}
          {new Date(ctx.access.grantExpiresAt ?? "").toLocaleString("th-TH")} · ทุกการเข้าถึงถูกบันทึกให้ลูกค้าเห็น
        </div>
      )}
      <EntBanner ctx={ctx} />

      {/* มือถือ: หัวหน้าเล็ก */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 md:hidden">
        <div className="min-w-0">
          <div className="text-xs font-bold text-brand-600">PlanBaan แผนบ้าน</div>
          <div className="truncate text-base font-bold">{ctx.project.name}</div>
        </div>
        {foreman && (
          <div className="flex shrink-0 gap-2">
            <Link href={active === "/guide" ? "/build" : "/guide"} className="flex min-h-10 items-center rounded-lg border border-slate-300 px-3 text-[13px] font-medium">{active === "/guide" ? "ก่อสร้าง" : "คู่มือ"}</Link>
            <form action={logout}><button className="min-h-10 rounded-lg border border-slate-300 px-3 text-[13px] font-medium">ออกจากระบบ</button></form>
          </div>
        )}
      </header>

      <div className="flex flex-1">
        {/* คอม: แถบเมนูซ้าย */}
        <aside className="hidden w-60 shrink-0 flex-col gap-5 border-r border-slate-200 bg-white px-3 py-5 md:flex">
          <div className="flex flex-col gap-1 px-2">
            <div className="text-[13px] font-bold text-brand-600">PlanBaan แผนบ้าน</div>
            <div className="text-lg font-bold leading-snug">{ctx.project.name}</div>
            <div className="text-[13px] text-slate-600">{kindLabel}{ctx.project.province ? ` · ${ctx.project.province}` : ""}</div>
          </div>
          <nav aria-label="เมนูหลัก"><NavList groups={groups} active={active} /></nav>
          <div className="mt-auto border-t border-slate-200 px-2 pt-4">{account}</div>
        </aside>

        <main className={`min-w-0 flex-1 p-4 md:p-7 ${foreman ? "" : "pb-28 md:pb-7"}`}>{children}</main>
      </div>

      {/* มือถือ: แถบปุ่มล่าง + เมนูทั้งหมด */}
      {!foreman && (
        <nav aria-label="เมนูหลัก" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
          {tabs.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active === n.href ? "page" : undefined}
              className={`relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active === n.href ? "font-bold text-brand-700" : "font-medium text-slate-600"}`}>
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
              {!!n.badge && <span className="absolute left-1/2 top-1.5 ml-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">{n.badge > 99 ? "99+" : n.badge}</span>}
            </Link>
          ))}
          <details className="group flex flex-1">
            <summary className="flex min-h-[60px] flex-1 cursor-pointer list-none flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-600 [&::-webkit-details-marker]:hidden group-open:font-bold group-open:text-brand-700">
              <span className="group-open:hidden"><Icon name="menu" size={22} /></span>
              <span className="hidden group-open:block"><Icon name="close" size={22} /></span>
              <span className="group-open:hidden">เมนู</span><span className="hidden group-open:inline">ปิดเมนู</span>
            </summary>
            <div className="fixed inset-x-0 bottom-[61px] top-0 z-50 flex flex-col bg-slate-900/40">
              <div className="mt-auto flex max-h-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white px-3 pb-4 pt-4">
                <div className="px-2">
                  <div className="text-base font-bold">{ctx.project.name}</div>
                  <div className="text-[13px] text-slate-600">{kindLabel}</div>
                </div>
                <nav aria-label="เมนูทั้งหมด"><NavList groups={groups} active={active} big /></nav>
                <div className="border-t border-slate-200 px-2 pt-3">{account}</div>
              </div>
            </div>
          </details>
        </nav>
      )}
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
