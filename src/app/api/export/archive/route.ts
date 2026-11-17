import { NextResponse, type NextRequest } from "next/server";
import { requireProject } from "@/lib/context";
import { canExport } from "@/lib/roles";
import { archivePrefix } from "@/lib/archive";

export const dynamic = "force-dynamic";

/** ดาวน์โหลดไฟล์ประวัติที่ย้ายไปเก็บถาวร (เฉพาะไฟล์ของโครงการตัวเอง) */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("file") ?? "";
  const ctx = await requireProject({ action: "export", target: `archive/${name}` });
  if (!canExport(ctx.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!/^[a-z_]+-\d{4}-\d{2}-\d{2}-\d{2}\.ndjson\.gz$/.test(name) || !ctx.env.BACKUPS?.get) return new NextResponse("ไม่พบไฟล์", { status: 404 });
  const obj = await ctx.env.BACKUPS.get(archivePrefix(ctx.project.id) + name);
  if (!obj) return new NextResponse("ไม่พบไฟล์", { status: 404 });
  await ctx.usage("export", { table: "archive" });
  return new NextResponse(obj.body, { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${ctx.project.slug}-${name}"`, "Cache-Control": "no-store" } });
}
