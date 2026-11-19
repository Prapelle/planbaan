import { NextResponse } from "next/server";
import { requireProject } from "@/lib/context";
import { setFlag } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

/** เปิดจากแอปที่ติดตั้งบนมือถือแล้ว (display-mode: standalone) → ติ๊กขั้น "ติดตั้งแอป" ในเช็กลิสต์เริ่มต้น */
export async function POST() {
  const ctx = await requireProject({ action: "view", target: "/api/pwa" });
  await setFlag(ctx.db, "pwa_seen");
  await ctx.usage("pwa_opened");
  return NextResponse.json({ ok: true });
}
