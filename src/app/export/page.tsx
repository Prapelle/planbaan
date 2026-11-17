import { redirect } from "next/navigation";
import { ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { canExport } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const ctx = await requireProject({ action: "view", target: "/export" });
  if (!canExport(ctx.role)) redirect("/");
  const files = [
    { href: "/api/export?table=leads", label: "ลูกค้า (CSV เปิดใน Excel ได้)" },
    { href: "/api/export?table=plots", label: "ผังแปลง (CSV)" },
    { href: "/api/export?table=loan_apps", label: "การยื่นกู้แต่ละธนาคาร (CSV)" },
    { href: "/api/export?table=lead_activity", label: "ประวัติลูกค้า (CSV)" },
    { href: "/api/export?format=json", label: "ข้อมูลทั้งโครงการ (JSON สำหรับย้ายระบบหรือสำรองเอง)" },
  ];
  return (
    <ProjectShell ctx={ctx} active="/export">
      <h1 className="mb-1 text-2xl font-bold">ส่งออกข้อมูล</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">ข้อมูลเป็นของโครงการ ส่งออกได้ทุกเมื่อ ไฟล์มีข้อมูลส่วนบุคคลของลูกค้า เก็บรักษาให้ปลอดภัย</p>
      <ul className="flex max-w-xl flex-col gap-2">
        {files.map((f) => (
          <li key={f.href}><a href={f.href} className="flex min-h-12 items-center rounded-lg border border-slate-200 bg-white px-4 font-medium hover:border-brand-500">{f.label}</a></li>
        ))}
      </ul>
    </ProjectShell>
  );
}
