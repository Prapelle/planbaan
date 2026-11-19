import { redirect } from "next/navigation";

/** อ่านค่าข้อความจากฟอร์ม */
export const fv = (f: FormData, k: string) => String(f.get(k) ?? "");

/** กลับไปหน้าเดิมพร้อมข้อความ (ใช้ใน server action) */
export function back(path: string, p: { error?: string; msg?: string; extra?: Record<string, string>; hash?: string }): never {
  const u = new URLSearchParams(p.extra ?? {});
  if (p.error) u.set("error", p.error);
  if (p.msg) u.set("msg", p.msg);
  const qs = u.toString();
  // path ที่มี #ส่วนในหน้า: query ต้องอยู่ก่อน # ไม่งั้นเบราว์เซอร์ไม่ส่ง error/msg มาที่หน้า
  const [base, inPathHash = ""] = path.split("#", 2);
  const hash = p.hash ?? inPathHash;
  redirect((qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base) + (hash ? `#${hash}` : ""));
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "เกิดข้อผิดพลาด");

export const baht = (n: unknown) => Number(n ?? 0).toLocaleString("th-TH");
