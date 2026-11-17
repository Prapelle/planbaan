import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { projectUrl, requireStaff } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { createProject } from "@/lib/control";
import { usageSummary } from "@/lib/usage";
import { rowCountsByProject } from "@/lib/tenant-db";
import { shardBindings } from "@/lib/backup";
import type { D1Like } from "@/lib/d1";

export const dynamic = "force-dynamic";

/**
 * Back office ทีม PlanBaan (ระยะ 0: หน้าเดียว)
 * เห็นเฉพาะสถิติการใช้งานและข้อมูลโครงการระดับบัญชี — ไม่เห็นแปลงหรือลูกค้าของโครงการ
 */
async function createAction(form: FormData) {
  "use server";
  const { env, staffRole } = await requireStaff();
  if (staffRole !== "admin") redirect("/platform?error=" + encodeURIComponent("สร้างโครงการได้เฉพาะ admin"));
  try {
    await createProject(controlDb(env), {
      slug: String(form.get("slug") ?? ""), name: String(form.get("name") ?? ""), ownerEmail: String(form.get("owner") ?? ""),
      kind: String(form.get("kind") ?? "developer"), province: String(form.get("province") ?? ""),
    });
  } catch (e) { redirect("/platform?error=" + encodeURIComponent((e as Error).message)); }
  revalidatePath("/platform");
  redirect("/platform");
}

const ago = (iso: string | null) => {
  if (!iso) return "ยังไม่เคยใช้";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
  return d <= 0 ? "วันนี้" : `${d} วันก่อน`;
};

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { env, email, staffRole } = await requireStaff();
  const { error } = await searchParams;
  const rows = await usageSummary(controlDb(env));
  // วัดขนาดข้อมูลต่อโครงการ (จำนวนแถว) จากทุกฐานข้อมูล — ตัวเลขอย่างเดียว ไม่เห็นเนื้อหา
  const sizes: Record<string, number> = {};
  for (const b of shardBindings(env)) for (const [k, v] of Object.entries(await rowCountsByProject(env[b] as D1Like))) sizes[k] = (sizes[k] ?? 0) + v;
  const totalRows = Object.values(sizes).reduce((a, n) => a + n, 0);
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Back office PlanBaan</h1>
        <span className="text-sm text-slate-600">{email} · {staffRole}</span>
      </div>
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="mb-3 text-sm text-slate-600">ทั้งหมด {rows.length} โครงการ · ข้อมูลรวม {totalRows.toLocaleString("th-TH")} แถว (ฐานข้อมูลหนึ่งก้อนเก็บได้สูงสุด 10 GB ดู docs/OPERATIONS.md เรื่องการแบ่งฐานข้อมูล)</p>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left text-slate-600">
            <th className="p-3 font-medium">โครงการ</th><th className="p-3 font-medium">ประเภท</th><th className="p-3 font-medium">จังหวัด</th>
            <th className="p-3 font-medium">ใช้ล่าสุด</th><th className="p-3 text-right font-medium">ผู้ใช้ 7 วัน</th><th className="p-3 text-right font-medium">การใช้งาน 7 วัน</th><th className="p-3 text-right font-medium">สมาชิก</th><th className="p-3 text-right font-medium">ข้อมูล (แถว)</th>
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-200">
              <td className="p-3"><div className="font-semibold">{r.name}</div><a href={projectUrl(r.slug)} className="text-xs text-brand-700 underline">{r.slug}</a></td>
              <td className="p-3">{r.kind === "builder" ? "รับสร้างบ้าน" : "โครงการจัดสรร"}</td>
              <td className="p-3">{r.province || "-"}</td>
              <td className="p-3">{ago(r.last_at)}</td>
              <td className="p-3 text-right tabular-nums">{r.users_7d}</td>
              <td className="p-3 text-right tabular-nums">{r.events_7d}</td>
              <td className="p-3 text-right tabular-nums">{r.members}</td>
              <td className="p-3 text-right tabular-nums">{(sizes[r.id] ?? 0).toLocaleString("th-TH")}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {staffRole === "admin" && (
        <form action={createAction} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <div className="font-semibold sm:col-span-2">สร้างโครงการใหม่</div>
          <label className="flex flex-col gap-1 text-sm">ชื่อโครงการ<input name="name" required className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex flex-col gap-1 text-sm">ชื่อย่อสำหรับลิงก์ (a-z 0-9 -)<input name="slug" required pattern="[a-z0-9-]{3,40}" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex flex-col gap-1 text-sm">อีเมลเจ้าของโครงการ<input name="owner" type="email" required className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex flex-col gap-1 text-sm">จังหวัด<input name="province" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex flex-col gap-1 text-sm">ประเภท
            <select name="kind" className="min-h-11 rounded-md border border-slate-300 px-3"><option value="developer">โครงการจัดสรร</option><option value="builder">รับสร้างบ้าน</option></select>
          </label>
          <button className="min-h-11 self-end rounded-md bg-brand-600 px-4 font-semibold text-white">สร้างโครงการ</button>
        </form>
      )}
    </main>
  );
}
