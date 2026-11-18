import Link from "next/link";
import { requireStaff } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { featureAdoption } from "@/lib/usage";
import { ENT } from "@/lib/entitlement";
import { BackShell } from "@/components/BackShell";
import { opsCard, projectsOverview } from "./shared";

export const dynamic = "force-dynamic";

/** หลังบ้าน: ภาพรวมระบบ — เห็นเฉพาะสถิติและข้อมูลระดับบัญชี ไม่เห็นข้อมูลลูกค้าของโครงการ */
const PAGE_LABEL: Record<string, string> = { build: "ก่อสร้าง", build_detail: "ก่อสร้างรายหลัง", home: "ภาพรวม", plots: "ผังแปลง", leads: "ลูกค้า", lead: "ลูกค้ารายคน", loans: "สินเชื่อ", marketing: "การตลาด", team: "ผลงานรายคน", members: "ผู้ใช้", support: "สิทธิ์ทีมช่วยเหลือ" };

export default async function PlatformOverview() {
  const { env, email, staffRole } = await requireStaff();
  const [{ counts, totalRows }, adoption] = await Promise.all([projectsOverview(env), featureAdoption(controlDb(env))]);
  const maxAdopt = Math.max(1, counts.total);
  const cards = [
    { label: "โครงการทั้งหมด", value: counts.total, href: "/platform/projects" },
    { label: "มีคนใช้ใน 7 วัน", value: counts.active7, href: "/platform/projects" },
    { label: "ไม่มีคนใช้ 7 วัน", value: counts.idle, href: "/platform/projects?state=idle", warn: true },
    { label: "ใกล้หมดสิทธิ์", value: counts.expiring, href: "/platform/projects?state=expiring", warn: true },
    { label: "ผ่อนผัน", value: counts.grace, href: "/platform/projects?state=grace", warn: true },
    { label: "ดูอย่างเดียว", value: counts.readonly, href: "/platform/projects?state=readonly", warn: true },
  ];
  return (
    <BackShell env={env} email={email} staffRole={staffRole} active="overview">
      <h1 className="mb-1 text-[28px] font-bold leading-tight">ภาพรวมระบบ</h1>
      <p className="mb-5 text-sm text-ops-muted">ข้อมูลรวม {totalRows.toLocaleString("th-TH")} แถว (ฐานข้อมูลหนึ่งก้อนเก็บได้ 10 GB) · ทดลอง {ENT.trialDays} วัน · ขั้นต่ำ Pure Product {ENT.pureMin.toLocaleString("th-TH")} บาทต่อ {ENT.windowMonths} เดือน · ผ่อนผัน {ENT.graceDays} วัน</p>
      <div className={`mb-6 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 ${opsCard} overflow-hidden`}>
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="flex flex-col gap-0.5 border-b border-r border-ops-line p-4 hover:bg-ops-bg">
            <span className="text-[13px] text-ops-muted">{c.label}</span>
            <span className={`text-[26px] font-bold tabular-nums ${c.warn && c.value > 0 ? "text-red-700" : ""}`}>{c.value}</span>
          </Link>
        ))}
      </div>
      <section className={`${opsCard} p-5`}>
        <h2 className="mb-1 text-base font-bold">ฟีเจอร์ที่ถูกใช้ (30 วัน)</h2>
        <p className="mb-4 text-sm text-ops-muted">จำนวนโครงการที่เปิดหน้านั้นอย่างน้อยหนึ่งครั้ง จากทั้งหมด {counts.total} โครงการ</p>
        <ul className="flex flex-col gap-2.5 text-sm">
          {adoption.length === 0 && <li className="text-ops-muted">ยังไม่มีข้อมูล</li>}
          {adoption.map((a) => (
            <li key={a.page} className="grid grid-cols-[8rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr_auto]">
              <span>{PAGE_LABEL[a.page] ?? a.page}</span>
              <div className="h-3 rounded-full bg-ops-bg" aria-hidden="true"><div className="h-3 rounded-full bg-ops-btn" style={{ width: `${(a.projects / maxAdopt) * 100}%` }} /></div>
              <span className="col-span-2 whitespace-nowrap tabular-nums text-ops-muted sm:col-span-1">{a.projects} โครงการ · {a.views.toLocaleString("th-TH")} ครั้ง</span>
            </li>
          ))}
        </ul>
      </section>
    </BackShell>
  );
}
