import { NextResponse, type NextRequest } from "next/server";
import { mimeOfKey } from "@/lib/planmap";
import { photoPrefix } from "@/lib/construction";
import { openShare } from "../data";

export const dynamic = "force-dynamic";

/** รูปที่บริษัทเผยแพร่ให้เจ้าของบ้านเห็นเท่านั้น */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await openShare(token);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ph = s && id ? await s.db.get("build_photos", id) : null;
  if (!s || !ph || ph.build_id !== s.build.id || !ph.published || !String(ph.r2_key).startsWith(photoPrefix(s.project.id, s.build.id)) || !s.env.BACKUPS?.get)
    return new NextResponse("ไม่พบรูป", { status: 404 });
  const obj = await s.env.BACKUPS.get(String(ph.r2_key));
  if (!obj) return new NextResponse("ไม่พบรูป", { status: 404 });
  return new NextResponse(obj.body, { headers: { "Content-Type": mimeOfKey(String(ph.r2_key)), "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}
