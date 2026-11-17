import { NextResponse } from "next/server";
import { requireProject } from "@/lib/context";
import { mimeOfKey } from "@/lib/planmap";

export const dynamic = "force-dynamic";

/** รูปผังของโครงการ — เฉพาะผู้มีสิทธิ์ในโครงการนั้น */
export async function GET() {
  const ctx = await requireProject({ action: "view", target: "/api/plan-image" });
  const key = ctx.project.plan_image ?? "";
  const bucket = ctx.env.BACKUPS;
  if (!key || !key.startsWith(`files/${ctx.project.id}/`) || !bucket?.get) return new NextResponse("ไม่พบรูปผัง", { status: 404 });
  const obj = await bucket.get(key);
  if (!obj) return new NextResponse("ไม่พบรูปผัง", { status: 404 });
  return new NextResponse(obj.body, { headers: { "Content-Type": mimeOfKey(key), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
