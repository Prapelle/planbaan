"use client";
import { useEffect } from "react";

/**
 * กันกดส่งฟอร์มซ้ำ (แตะปุ่มสองครั้งตอนเน็ตช้าบนมือถือ → ข้อมูลซ้ำ เช่น งานก่อสร้างสองงาน ต้นทุนสองรายการ)
 * ฟอร์มที่เพิ่งส่ง จะไม่ยอมให้ส่งซ้ำภายใน 4 วินาที และปุ่มที่กดขึ้นว่ากำลังบันทึก
 * ฟอร์มค้นหา (method GET) ไม่กัน
 */
export function SubmitGuard() {
  useEffect(() => {
    const busy = new WeakMap<HTMLFormElement, number>();
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement) || (form.getAttribute("method") ?? "").toLowerCase() === "get" || form.getAttribute("role") === "search") return;
      const now = Date.now();
      if (now - (busy.get(form) ?? 0) < 4000) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      busy.set(form, now);
      const btn = (e.submitter as HTMLButtonElement | null) ?? null;
      if (btn) {
        btn.setAttribute("aria-busy", "true");
        btn.style.opacity = "0.6";
        setTimeout(() => { btn.removeAttribute("aria-busy"); btn.style.opacity = ""; }, 4000);
      }
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
