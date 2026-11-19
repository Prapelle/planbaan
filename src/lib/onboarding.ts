/**
 * ขั้นตอนเริ่มต้นใช้งานของโครงการใหม่
 * - หน้าภาพรวม (เจ้าของ/ผู้จัดการ): เช็กลิสต์ 4 ขั้น ทำครบหรือกดซ่อนแล้วหายไป
 * - หลังบ้าน: ขั้นตามแผน สมัคร → ตั้งผังแปลง → ลูกค้า 10 รายแรก → ใช้ทุกสัปดาห์ (นับจำนวนแถวเท่านั้น ไม่อ่านเนื้อหา)
 */
import type { TenantDb } from "./tenant-db";

export type Step = { key: string; label: string; done: boolean; href: string; hint: string };

export async function checklist(db: TenantDb, p: { kind: string; construction: boolean; members: number }) {
  const builder = p.kind === "builder";
  const [plots, leads, builds, flags] = await Promise.all([
    builder ? Promise.resolve(0) : db.count("plots"),
    db.count("leads"),
    builder && p.construction ? db.count("builds") : Promise.resolve(0),
    db.list("project_settings", { limit: 20 }),
  ]);
  const flag = (k: string) => flags.some((f) => f.key === k && f.value === "1");
  const steps: Step[] = [
    ...(builder ? [] : [{ key: "plots", label: "สร้างผังแปลง", done: plots > 0, href: "/plots", hint: "สร้างทั้งโซนพร้อมกัน หรือนำเข้าจาก Excel" }]),
    { key: "team", label: "เพิ่มทีมขาย", done: p.members > 1, href: "/members", hint: "ใส่อีเมล Gmail ของแต่ละคน แล้วเลือกบทบาท" },
    { key: "leads", label: "เพิ่มลูกค้ารายแรก", done: leads > 0, href: "/leads", hint: "พิมพ์เอง หรือนำเข้ารายชื่อเดิมจาก Excel" },
    ...(builder && p.construction ? [{ key: "build", label: "เพิ่มงานก่อสร้างหลังแรก", done: builds > 0, href: "/build", hint: "ระบบตั้งงวดงานมาตรฐานให้ แก้ได้ทีหลัง" }] : []),
    { key: "app", label: "ติดตั้งแอปบนมือถือ", done: flag("pwa_seen"), href: "/guide#start", hint: "เปิดเว็บในมือถือ แล้วกด เพิ่มไปยังหน้าจอหลัก" },
  ];
  return { steps, hidden: flag("onboarding_hidden"), done: steps.every((s) => s.done) };
}

export async function setFlag(db: TenantDb, key: "onboarding_hidden" | "pwa_seen") {
  const [cur] = await db.list("project_settings", { where: { key }, limit: 1 });
  if (cur) { if (cur.value !== "1") await db.update("project_settings", cur.id, { value: "1" }); }
  else await db.insert("project_settings", { key, value: "1" });
}

/** ขั้นสำหรับหลังบ้าน (จากจำนวนแถวและผู้ใช้ 7 วัน) */
export function stageOf(kind: string, counts: { plots?: number; leads?: number }, users7d: number) {
  if (kind !== "builder" && !(counts.plots ?? 0)) return { n: 1, label: "ยังไม่ตั้งผังแปลง" };
  if ((counts.leads ?? 0) < 10) return { n: 2, label: `ลูกค้า ${counts.leads ?? 0}/10 รายแรก` };
  if (users7d === 0) return { n: 3, label: "ไม่ได้ใช้ใน 7 วัน" };
  return { n: 4, label: "ใช้ทุกสัปดาห์" };
}
