"use client";
import { useEffect } from "react";

/** แจ้งระบบครั้งเดียวต่อเครื่องเมื่อเปิดจากแอปที่ติดตั้งแล้ว */
export function PwaPing({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      const key = `pb_pwa_${slug}`;
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!standalone || localStorage.getItem(key)) return;
      fetch("/api/pwa", { method: "POST" }).then((r) => { if (r.ok) localStorage.setItem(key, "1"); }).catch(() => {});
    } catch { /* เบราว์เซอร์ไม่รองรับ localStorage */ }
  }, [slug]);
  return null;
}
