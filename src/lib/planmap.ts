/**
 * ผังแบบรูปผัง: อัปโหลดรูปผังโครงการ (เก็บใน R2 ใต้ files/<project_id>/) แล้ววางจุดแปลงบนรูป
 * ตำแหน่งเก็บเป็นร้อยละของความกว้าง/สูงของรูป จึงไม่ขึ้นกับขนาดจอ
 */
import type { TenantDb } from "./tenant-db";

export const MAX_PLAN_BYTES = 5 * 1024 * 1024;

/** ตรวจชนิดไฟล์จากเนื้อไฟล์จริง (ไม่เชื่อนามสกุล) */
export function sniffImage(b: Uint8Array): { ext: string; mime: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}
export const planKey = (projectId: string, ext: string) => `files/${projectId}/plan-${crypto.randomUUID()}.${ext}`;
export const mimeOfKey = (key: string) => (key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg");

const pos = (v: unknown) => {
  const n = Math.round(Number(v) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("ตำแหน่งไม่ถูกต้อง");
  return n;
};

const CODE_OK = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

/** วางจุดแปลงบนรูป · create = ยังไม่มีแปลงนี้ให้สร้างใหม่ (โซนคือตัวอักษรนำหน้า เช่น A12 → โซน A) คืน true ถ้าสร้างใหม่ */
export async function placePlot(db: TenantDb, codeRaw: string, x: unknown, y: unknown, opts: { create?: boolean } = {}) {
  const code = codeRaw.trim().toUpperCase();
  if (!code) throw new Error("เลือกหรือพิมพ์เลขแปลงก่อนแตะบนรูป");
  const at = { map_x: pos(x), map_y: pos(y) };
  const [plot] = await db.list("plots", { where: { code }, limit: 1 });
  if (plot) { await db.update("plots", plot.id, at); return false; }
  if (!opts.create) throw new Error(`ไม่พบแปลง ${code}`);
  if (!CODE_OK.test(code)) throw new Error("เลขแปลงใช้ตัวอักษรอังกฤษ ตัวเลข หรือ - ไม่เกิน 12 ตัว เช่น A01");
  const zone = (/^[A-Z]+/.exec(code)?.[0] ?? code.slice(0, 1)).slice(0, 4);
  await db.insert("plots", { code, zone, house_type: "", price: 0, house_status: "not_started", sale_status: "available", ...at });
  return true;
}

export async function unplacePlot(db: TenantDb, codeRaw: string) {
  const code = codeRaw.trim().toUpperCase();
  const [plot] = await db.list("plots", { where: { code }, limit: 1 });
  if (!plot) throw new Error(`ไม่พบแปลง ${code}`);
  await db.update("plots", plot.id, { map_x: null, map_y: null });
}
