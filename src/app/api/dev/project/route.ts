import { NextResponse, type NextRequest } from "next/server";
import { DEV_COOKIE, cfg } from "@/lib/context";
import { resolveHost, isValidSlug } from "@/lib/host";

/** ใช้ระหว่างยังไม่มีโดเมน: เลือกโครงการด้วยคุกกี้ (ปิดเมื่อ ALLOW_PROJECT_SWITCH ไม่ใช่ "true") — สิทธิ์ยังตรวจที่ requireProject ทุกครั้ง */
export async function GET(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  if (!cfg().allowSwitch || resolveHost(host, cfg().baseDomain).kind !== "dev") return new NextResponse("Not found", { status: 404 });
  const slug = (req.nextUrl.searchParams.get("slug") ?? "").toLowerCase();
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const res = NextResponse.redirect(new URL(safeNext, req.nextUrl.origin));
  if (slug && isValidSlug(slug)) res.cookies.set(DEV_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/", secure: req.nextUrl.protocol === "https:" });
  else res.cookies.delete(DEV_COOKIE);
  return res;
}
