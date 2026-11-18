import { redirect } from "next/navigation";
import { ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { canExport, canSeeCosts } from "@/lib/roles";
import { listArchives } from "@/lib/archive";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const ctx = await requireProject({ action: "view", target: "/export" });
  if (!canExport(ctx.role)) redirect("/");
  const files = [
    { href: "/api/export?table=leads", label: "ลูกค้า (CSV เปิดใน Excel ได้)" },
    { href: "/api/export?table=plots", label: "ผังแปลง (CSV)" },
    { href: "/api/export?table=loan_apps", label: "การยื่นกู้แต่ละธนาคาร (CSV)" },
    { href: "/api/export?table=lead_activity", label: "ประวัติลูกค้า (CSV)" },
    ...(canSeeCosts(ctx.role) ? [{ href: "/api/export?table=build_costs", label: "ต้นทุนรายหลัง (CSV)" }] : []),
    { href: "/api/export?format=json", label: canSeeCosts(ctx.role) ? "ข้อมูลทั้งโครงการ (JSON สำหรับย้ายระบบหรือสำรองเอง)" : "ข้อมูลทั้งโครงการ ไม่รวมต้นทุน (JSON)" },
  ];
  const archives = ctx.env.BACKUPS ? await listArchives(ctx.env.BACKUPS, ctx.project.id) : [];
  return (
    <ProjectShell ctx={ctx} active="/export">
      <h1 className="mb-1 text-2xl font-bold">ส่งออกข้อมูล</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">ข้อมูลเป็นของโครงการ ส่งออกได้ทุกเมื่อ ไฟล์มีข้อมูลส่วนบุคคลของลูกค้า เก็บรักษาให้ปลอดภัย</p>
      <ul className="flex max-w-xl flex-col gap-2">
        {files.map((f) => (
          <li key={f.href}><a href={f.href} className="flex min-h-12 items-center rounded-lg border border-slate-200 bg-white px-4 font-medium hover:border-brand-500">{f.label}</a></li>
        ))}
      </ul>
      <h2 className="mb-1 mt-8 text-lg font-semibold">ประวัติลูกค้าที่เก็บถาวร</h2>
      <p className="mb-3 max-w-2xl text-sm text-slate-600">ประวัติการติดต่อและการเปลี่ยนขั้นที่เก่ากว่า 1 ปี ระบบย้ายออกจากหน้าใช้งานเพื่อให้เร็ว ข้อมูลไม่หาย ดาวน์โหลดได้ที่นี่ (ไฟล์ .ndjson.gz)</p>
      {archives.length === 0 ? <p className="text-sm text-slate-700">ยังไม่มี</p> : (
        <ul className="flex max-w-xl flex-col gap-2 text-sm">
          {archives.map((a) => (
            <li key={a.key}><a href={`/api/export/archive?file=${encodeURIComponent(a.name)}`} className="flex min-h-11 items-center justify-between rounded-lg border border-slate-200 bg-white px-4 hover:border-brand-500">
              <span>{a.name}</span><span className="text-slate-600">{Math.max(1, Math.round(a.size / 1024))} KB</span></a></li>
          ))}
        </ul>
      )}
    </ProjectShell>
  );
}
