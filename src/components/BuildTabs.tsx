import Link from "next/link";

/** แท็บของหน้างานรายหลัง — แท็บต้นทุนแสดงเฉพาะคนที่เห็นต้นทุนได้ */
export function BuildTabs({ id, active, showCosts }: { id: string; active: "progress" | "costs"; showCosts: boolean }) {
  if (!showCosts) return null;
  const tab = (href: string, key: string, label: string) => (
    <Link href={href} aria-current={active === key ? "page" : undefined}
      className={`-mb-px flex min-h-11 items-center border-b-[3px] px-4 text-sm font-semibold ${active === key ? "border-brand-600 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{label}</Link>
  );
  return (
    <nav aria-label="ส่วนของงานนี้" className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200">
      {tab(`/build/${id}`, "progress", "ความคืบหน้า")}
      {tab(`/build/${id}/costs`, "costs", "ต้นทุนและกำไร")}
      <span className="ml-2 text-xs text-slate-500">ต้นทุนเห็นเฉพาะเจ้าของโครงการและบัญชี</span>
    </nav>
  );
}
