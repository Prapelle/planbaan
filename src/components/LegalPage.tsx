import Link from "next/link";

/** ผู้ให้บริการและช่องทางติดต่อ (ตั้งใน wrangler.jsonc → vars) */
export const legal = () => ({
  operator: process.env.OPERATOR_NAME || "บุรีรัมย์น่าอยู่",
  contact: process.env.CONTACT_EMAIL || process.env.INITIAL_ADMIN_EMAIL || "",
  updated: "17 พฤศจิกายน 2569",
});

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-5 md:p-8">
      <Link href="/" className="text-sm font-semibold tracking-wide text-slate-500">PlanBaan แผนบ้าน</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">{title}</h1>
      <p className="mb-6 text-sm text-slate-600">ปรับปรุงล่าสุด {legal().updated}</p>
      <article className="flex flex-col gap-3 leading-relaxed text-slate-800 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_table]:w-full [&_table]:text-sm [&_td]:border-t [&_td]:border-slate-200 [&_td]:p-2 [&_td]:align-top [&_th]:p-2 [&_th]:text-left [&_th]:text-slate-600">
        {children}
      </article>
      <LegalLinks />
    </main>
  );
}

export function LegalLinks() {
  return (
    <nav aria-label="ข้อกำหนด" className="mt-10 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm text-slate-600">
      <Link href="/privacy" className="underline">นโยบายความเป็นส่วนตัว (Privacy Policy)</Link>
      <Link href="/terms" className="underline">ข้อตกลงการใช้งาน (Terms)</Link>
    </nav>
  );
}
