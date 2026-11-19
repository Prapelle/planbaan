"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Count = { count: number; urgent: number };
let inflight: Promise<Count | null> | null = null; // กระดิ่งบนมือถือกับคอมอยู่ในหน้าเดียวกัน: ถามเซิร์ฟเวอร์ครั้งเดียว
const load = () => (inflight ??= fetch("/api/notify", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).finally(() => { setTimeout(() => { inflight = null; }, 0); }));

/** กระดิ่งแจ้งเตือน: ดึงจำนวนหลังหน้าโหลดเสร็จ */
export function Bell({ active, size = 22 }: { active?: boolean; size?: number }) {
  const [n, setN] = useState<Count | null>(null);
  useEffect(() => {
    // ทุกหน้ามีกระดิ่ง: เก็บผลไว้ 30 วินาที ไม่ต้องคำนวณใหม่ทุกครั้งที่เปลี่ยนหน้า (หน้าแจ้งเตือนเองคำนวณสดเสมอ)
    let off = false;
    const KEY = "pb_notify";
    try {
      const c = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      if (!active && c && Date.now() - c.at < 30_000) { setN(c.v); return; }
    } catch { /* ไม่มี sessionStorage */ }
    load().then((j) => {
      if (off || !j) return;
      setN(j);
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), v: j })); } catch { /* ignore */ }
    });
    return () => { off = true; };
  }, [active]);
  const label = n && n.count ? `แจ้งเตือน ${n.count} รายการ` : "แจ้งเตือน";
  return (
    <Link href="/notifications" aria-label={label} aria-current={active ? "page" : undefined}
      className={`relative flex h-11 w-11 items-center justify-center rounded-lg ${active ? "bg-brand-100 text-brand-800" : "text-slate-700 hover:bg-slate-100"}`}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {!!n?.count && (
        <span aria-hidden="true" className={`absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ${n.urgent ? "bg-red-600" : "bg-amber-500"}`}>{n.count > 99 ? "99+" : n.count}</span>
      )}
    </Link>
  );
}
