import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ProjectShell } from "@/components/ProjectShell";
import { ImportWizard, type Field } from "@/components/ImportWizard";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { listMembers } from "@/lib/control";
import { canEditData, canManagePlots } from "@/lib/roles";
import { MAX_ROWS, importLeads, importPlots } from "@/lib/importer";

export const dynamic = "force-dynamic";

const LEAD_FIELDS: Field[] = [
  { key: "name", label: "ชื่อลูกค้า", required: true, guess: ["ชื่อ", "ชื่อลูกค้า", "name", "ลูกค้า", "ชื่อ-นามสกุล"], example: "คุณสมชาย ใจดี" },
  { key: "phone", label: "เบอร์โทร", guess: ["เบอร์", "โทร", "phone", "tel", "มือถือ"], example: "0812345678" },
  { key: "channel", label: "ช่องทาง", guess: ["ช่องทาง", "channel", "source", "แหล่งที่มา", "มาจาก"], example: "Facebook" },
  { key: "plot_code", label: "แปลง", guess: ["แปลง", "plot", "unit", "เลขที่แปลง"], example: "A01" },
  { key: "stage", label: "สถานะ / ขั้น", guess: ["สถานะ", "ขั้น", "stage", "status"], example: "นัดเข้าชม" },
  { key: "owner_email", label: "อีเมลผู้ดูแล", guess: ["ผู้ดูแล", "sale", "เซลล์", "owner", "email"], example: "sale@gmail.com" },
  { key: "note", label: "หมายเหตุ", guess: ["หมายเหตุ", "note", "remark", "รายละเอียด"], example: "สนใจบ้านหลังมุม" },
];
const PLOT_FIELDS: Field[] = [
  { key: "code", label: "รหัสแปลง", required: true, guess: ["แปลง", "รหัส", "code", "plot", "unit", "เลขที่"], example: "A01" },
  { key: "zone", label: "โซน", guess: ["โซน", "zone"], example: "A" },
  { key: "house_type", label: "แบบบ้าน", guess: ["แบบบ้าน", "แบบ", "type", "model"], example: "ชั้นเดียว 3 ห้องนอน" },
  { key: "price", label: "ราคา (บาท)", guess: ["ราคา", "price"], example: "2390000" },
  { key: "area_sqw", label: "เนื้อที่ (ตร.ว.)", guess: ["เนื้อที่", "ตร.ว", "ตารางวา", "area", "sqw"], example: "52.5" },
];

const allowed = (ctx: Awaited<ReturnType<typeof requireProject>>, type: string) =>
  !ctx.readonly && (type === "plots" ? canManagePlots(ctx.role, ctx.access.supportCanEdit) && ctx.project.kind !== "builder" : canEditData(ctx.role, ctx.access.supportCanEdit));

async function importLeadsAction(json: string) {
  "use server";
  const ctx = await requireProject({ action: "edit", target: "/import?type=leads" });
  if (!allowed(ctx, "leads")) return { added: 0, updated: 0, skipped: [], notes: [], error: "ไม่มีสิทธิ์นำเข้าลูกค้า" };
  try {
    const members = (await listMembers(controlDb(ctx.env), ctx.project.id)).map((m) => m.email);
    const r = await importLeads(ctx.db, JSON.parse(json), ctx.email, members, ctx.project.kind);
    await ctx.usage("import", { table: "leads", n: r.added });
    revalidatePath("/leads");
    return r;
  } catch (e) { return { added: 0, updated: 0, skipped: [], notes: [], error: e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ" }; }
}
async function importPlotsAction(json: string) {
  "use server";
  const ctx = await requireProject({ action: "edit", target: "/import?type=plots" });
  if (!allowed(ctx, "plots")) return { added: 0, updated: 0, skipped: [], notes: [], error: "ไม่มีสิทธิ์นำเข้าแปลง" };
  try {
    const r = await importPlots(ctx.db, JSON.parse(json));
    await ctx.usage("import", { table: "plots", n: r.added });
    revalidatePath("/plots");
    return r;
  } catch (e) { return { added: 0, updated: 0, skipped: [], notes: [], error: e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ" }; }
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/import" });
  const sp = await searchParams;
  const builder = ctx.project.kind === "builder";
  const type = sp.type === "plots" && !builder ? "plots" : "leads";
  if (!allowed(ctx, type)) redirect(type === "plots" ? "/plots" : "/leads");
  await ctx.usage("page_view", { page: "import" });
  const tab = (t: string, label: string) => (
    <Link href={`/import?type=${t}`} aria-current={type === t ? "page" : undefined}
      className={`flex min-h-11 items-center rounded-md px-4 font-semibold ${type === t ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>{label}</Link>
  );
  return (
    <ProjectShell ctx={ctx} active={type === "plots" ? "/plots" : "/leads"}>
      <h1 className="mb-1 text-2xl font-bold">นำเข้าจาก Excel</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">ย้ายข้อมูลเดิมเข้าระบบทีเดียว ไม่ต้องพิมพ์ใหม่ ครั้งละไม่เกิน {MAX_ROWS.toLocaleString("th-TH")} แถว ระบบอ่านไฟล์ในเครื่องก่อน ให้คุณตรวจ แล้วจึงบันทึก</p>
      {!builder && <div className="mb-4 flex gap-2 text-sm">{tab("plots", "แปลง")}{tab("leads", "ลูกค้า")}</div>}
      <ul className="mb-4 max-w-2xl list-disc pl-5 text-sm text-slate-700">
        {type === "plots" ? <>
          <li>รหัสแปลงใหม่จะสร้างให้ รหัสที่มีอยู่แล้วจะอัปเดตแบบบ้าน ราคา และเนื้อที่</li>
          <li>ไม่มีคอลัมน์โซน ระบบใช้ตัวอักษรนำหน้ารหัส เช่น A12 อยู่โซน A</li>
        </> : <>
          <li>เบอร์ที่มีในระบบแล้วหรือซ้ำในไฟล์จะข้าม ไม่สร้างลูกค้าซ้ำ</li>
          <li>ช่องทางและสถานะอ่านจากคำทั่วไป เช่น "เฟส" = Facebook, "จองแล้ว" = จอง ถ้าอ่านไม่ออกจะเป็น "อื่น ๆ" และ "รอติดต่อ"</li>
          {!builder && <li>ลูกค้าที่จองขึ้นไปต้องมีแปลงที่ว่าง ถ้าไม่มี ระบบนำเข้าที่ขั้น "เข้าชมแล้ว" และบอกว่าแถวไหน ควรนำเข้าแปลงก่อนลูกค้า</li>}
          <li>ไม่มีอีเมลผู้ดูแล หรืออีเมลไม่ใช่ผู้ใช้ในโครงการ จะให้คุณเป็นผู้ดูแล</li>
        </>}
      </ul>
      <ImportWizard key={type} fields={type === "plots" ? PLOT_FIELDS : LEAD_FIELDS} action={type === "plots" ? importPlotsAction : importLeadsAction} sampleName={`planbaan-${type}`} />
    </ProjectShell>
  );
}
