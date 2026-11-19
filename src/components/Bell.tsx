"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** กระดิ่งแจ้งเตือน: ดึงจำนวนหลังหน้าโหลดเสร็จ */
export function Bell({ active, size = 22 }: { active?: boolean; size?: number }) {
  const [n, setN] = useState<{ count: number; urgent: number } | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/notify", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off && j) setN(j); }).catch(() => {});
    return () => { off = true; };
  }, []);
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
