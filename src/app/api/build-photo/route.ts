import { NextResponse, type NextRequest } from "next/server";
import { requireProject } from "@/lib/context";
import { mimeOfKey } from "@/lib/planmap";
import { photoPrefix } from "@/lib/construction";

export const dynamic = "force-dynamic";

/** รูปหน้างาน — เฉพาะผู้มีสิทธิ์ในโครงการ (เจ้าของบ้านดูผ่าน /h/<token>/photo) */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ctx = await requireProject({ action: "view", target: "/api/build-photo" });
  const ph = id ? await ctx.db.get("build_photos", id) : null;
  if (!ph || !String(ph.r2_key).startsWith(photoPrefix(ctx.project.id, String(ph.build_id))) || !ctx.env.BACKUPS?.get) return new NextResponse("ไม่พบรูป", { status: 404 });
  const obj = await ctx.env.BACKUPS.get(String(ph.r2_key));
  if (!obj) return new NextResponse("ไม่พบรูป", { status: 404 });
  return new NextResponse(obj.body, { headers: { "Content-Type": mimeOfKey(String(ph.r2_key)), "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
