import Link from "next/link";
import { ProjectShell } from "@/components/ProjectShell";
import { cfg, projectUrl, requireProject, sessionEmail, where } from "@/lib/context";
import { controlDb, getEnv } from "@/lib/d1";
import { getStaffRole, projectsOfEmail } from "@/lib/control";
import { ROLE_LABEL } from "@/lib/roles";

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

async function ProjectHome() {
  const ctx = await requireProject({ action: "view", target: "/" });
  await ctx.usage("page_view", { page: "home" });
  const [plots, leads] = await Promise.all([ctx.db.count("plots"), ctx.db.count("leads")]);
  return (
    <ProjectShell ctx={ctx} active="/">
      <h1 className="mb-4 text-2xl font-bold">หน้าหลัก</h1>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-sm text-slate-600">แปลงในระบบ</div><div className="text-3xl font-bold">{plots}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-sm text-slate-600">ลูกค้าในระบบ</div><div className="text-3xl font-bold">{leads}</div></div>
      </div>
      <p className="rounded-lg bg-white p-4 text-slate-700">ระบบพื้นฐานพร้อมแล้ว ผังแปลง ลูกค้า และหน้าภาพรวมจะเพิ่มในระยะ 1</p>
    </ProjectShell>
  );
}
