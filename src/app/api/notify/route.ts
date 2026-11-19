import { NextResponse } from "next/server";
import { requireProject } from "@/lib/context";
import { notifications } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** จำนวนแจ้งเตือนสำหรับกระดิ่งบนเมนู (โหลดหลังหน้าเว็บขึ้นแล้ว ไม่ทำให้ทุกหน้าช้า) */
export async function GET() {
  const ctx = await requireProject({ action: "view", target: "/api/notify" });
  const items = await notifications(ctx.db, {
    role: ctx.role, email: ctx.email, kind: ctx.project.kind, construction: !!ctx.project.construction_enabled,
    staleDays: Number(ctx.project.build_stale_days ?? 7), ent: ctx.ent,
  });
  return NextResponse.json({ count: items.length, urgent: items.filter((i) => i.tone === "red").length }, { headers: { "Cache-Control": "private, no-store" } });
}
