import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as C from "@/lib/construction";
import { baht, errMsg } from "@/lib/form";
import { bkkDate } from "@/lib/sales";
import { openShare } from "./data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ติดตามการก่อสร้างบ้าน", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * หน้าติดตามของเจ้าของบ้าน: เปิดผ่านลิงก์ส่วนตัว ไม่ต้องล็อกอิน
 * เห็นเฉพาะงานหลังนี้: งวดงาน รูปที่บริษัทเผยแพร่ งวดเงิน กำหนดส่งมอบ งานเพิ่ม-ลด (ความล่าช้าแสดงตามที่บริษัทตั้ง)
 * ไม่เห็นข้อมูลอื่นของโครงการ ราคาสัญญา บันทึกภายใน หรือรูปที่ยังไม่เผยแพร่
 */
async function decideAction(f: FormData) {
  "use server";
  const token = String(f.get("token") ?? "");
  const path = `/h/${token}`;
  const name = String(f.get("name") ?? "").trim().slice(0, 80);
  const decision = String(f.get("decision")) === "rejected" ? "rejected" : "confirmed";
  const s = await openShare(token);
  if (!s) redirect(path);
  let msg = "";
  try {
    const c = await s.db.get("build_changes", String(f.get("change") ?? ""));
    if (!c || c.build_id !== s.build.id) throw new Error("ไม่พบรายการ");
    if (!name) throw new Error("พิมพ์ชื่อของคุณเพื่อยืนยัน");
    await C.decideChange(s.db, String(c.id), decision, `owner_link:${name}`);
    msg = decision === "confirmed" ? "ยืนยันแล้ว บริษัทจะได้รับแจ้งในระบบ" : "บันทึกว่าไม่รับรายการนี้แล้ว";
  } catch (e) { redirect(`${path}?error=${encodeURIComponent(errMsg(e))}#changes`); }
  revalidatePath(path);
  redirect(`${path}?msg=${encodeURIComponent(msg)}#changes`);
}

const thDay = (d: unknown) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const when = (iso: unknown) => new Date(String(iso)).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" });

export default async function OwnerPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const s = await openShare(token);
  if (!s) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-xl font-bold">ลิงก์นี้ใช้ไม่ได้แล้ว</h1>
        <p className="text-slate-700">บริษัทอาจออกลิงก์ใหม่ให้ ติดต่อพนักงานที่ดูแลบ้านของคุณเพื่อขอลิงก์ล่าสุด</p>
      </main>
    );
  }
  const { project, db, build } = s;
  const [stages, photos, changes] = await Promise.all([
    C.stagesOf(db, build.id),
    db.list("build_photos", { where: { build_id: build.id, published: 1 }, limit: 300, orderBy: "created_at", desc: true }),
    db.list("build_changes", { where: { build_id: build.id }, limit: 200, orderBy: "created_at", desc: true }),
  ]);
  const sum = C.summarize(build, stages, changes, { staleDays: 9999 });
  const showDelay = !!build.show_delay;
  const pays = stages.filter((x) => Number(x.pay_amount) > 0);
  const visibleChanges = changes.filter((c) => c.status !== "cancelled");
  const today = bkkDate();

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-1 text-sm font-semibold text-slate-600">{project.name}</div>
      <h1 className="text-2xl font-bold">{String(build.title)}</h1>
      <p className="mb-4 text-sm text-slate-700">
        {build.customer_name ? `เจ้าของบ้าน ${build.customer_name} · ` : ""}
        {build.status === "done" ? `ส่งมอบแล้วเมื่อ ${thDay(build.done_at)}` : `กำหนดส่งมอบ ${thDay(build.due_date)}`}
      </p>
      {sp.error && <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{sp.error}</p>}
      {sp.msg && <p role="status" className="mb-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">{sp.msg}</p>}

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-1 flex justify-between"><span className="font-semibold">ความคืบหน้า</span><b className="text-xl">{sum.pct}%</b></div>
        <div className="mb-2 h-3 rounded bg-slate-100" aria-hidden="true"><div className="h-3 rounded bg-brand-600" style={{ width: `${sum.pct}%` }} /></div>
        <p className="text-sm text-slate-700">{sum.current ? `กำลังทำงวด ${sum.current.seq}: ${sum.current.name}` : "งานก่อสร้างครบทุกงวดแล้ว"}
          {showDelay && sum.lateDays > 0 && <span className="font-semibold text-red-700"> · ช้ากว่าแผน {sum.lateDays} วัน</span>}</p>
        <p className="mt-1 text-xs text-slate-600">อัปเดตล่าสุด {when(build.last_update_at)}</p>
      </section>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">งวดงาน</h2>
        <ol className="flex flex-col gap-2">
          {stages.map((x) => (
            <li key={x.id} className="flex items-start gap-3">
              <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${x.done_at ? "bg-emerald-700 text-white" : x.id === sum.current?.id ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-700"}`}>{x.done_at ? "✓" : String(x.seq)}</span>
              <div className="text-sm">
                <div className="font-medium">{String(x.name)} <span className="sr-only">{x.done_at ? "เสร็จแล้ว" : "ยังไม่เสร็จ"}</span></div>
                <div className="text-xs text-slate-600">
                  {x.done_at ? `เสร็จ ${thDay(x.done_at)}` : showDelay ? `กำหนดเสร็จ ${thDay(x.planned_end)}${String(x.planned_end) < today ? " (เลยกำหนด)" : ""}` : "ยังไม่เสร็จ"}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">รูปหน้างาน</h2>
        {photos.length === 0 ? <p className="text-sm text-slate-600">ยังไม่มีรูปที่บริษัทเผยแพร่</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((ph) => (
              <li key={ph.id} className="text-xs">
                <a href={`/h/${token}/photo?id=${ph.id}`} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/h/${token}/photo?id=${ph.id}`} alt={String(ph.caption) || "รูปหน้างาน"} loading="lazy" className="aspect-square w-full rounded-md border border-slate-200 object-cover" />
                </a>
                <div className="mt-1 text-slate-600">{when(ph.created_at)}{ph.caption ? ` · ${ph.caption}` : ""}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pays.length > 0 && (
        <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">งวดเงิน</h2>
          <table className="w-full text-sm">
            <tbody>
              {pays.map((x) => (
                <tr key={x.id} className="border-b border-slate-100">
                  <td className="py-2">{String(x.name)}</td>
                  <td className="py-2 text-right tabular-nums">{baht(x.pay_amount)} บาท</td>
                  <td className={`py-2 pl-3 text-right text-xs ${x.paid_at ? "text-emerald-800" : x.done_at ? "font-semibold text-amber-800" : "text-slate-600"}`}>{x.paid_at ? "ชำระแล้ว" : x.done_at ? "ถึงกำหนดชำระ" : "ยังไม่ถึงงวด"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {visibleChanges.length > 0 && (
        <section id="changes" className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-semibold">งานเพิ่ม-ลด</h2>
          <p className="mb-3 text-sm text-slate-600">บริษัทจะเริ่มทำเมื่อคุณยืนยันแล้ว การยืนยันบันทึกชื่อและเวลาไว้เป็นหลักฐาน</p>
          <ul className="flex flex-col gap-3">
            {visibleChanges.map((c) => (
              <li key={c.id} className="rounded-md border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><b>{String(c.title)}</b><span className="tabular-nums">{Number(c.amount) > 0 ? "เพิ่ม " : "ลด "}{baht(Math.abs(Number(c.amount)))} บาท</span></div>
                {c.status === "pending" ? (
                  <form action={decideAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="token" value={token} /><input type="hidden" name="change" value={String(c.id)} />
                    <label className="flex flex-col gap-1">ชื่อผู้ยืนยัน<input name="name" required maxLength={80} autoComplete="name" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                    <button name="decision" value="confirmed" className="min-h-11 rounded-md bg-emerald-700 px-4 font-semibold text-white">ยืนยัน</button>
                    <button name="decision" value="rejected" className="min-h-11 rounded-md border border-slate-400 px-4 font-semibold">ไม่รับ</button>
                  </form>
                ) : (
                  <div className="mt-1 text-xs text-slate-600">{C.CHANGE_LABEL[String(c.status)]} · {when(c.decided_at)}{String(c.decided_by).startsWith("owner_link:") ? ` · ${String(c.decided_by).slice(11)}` : ""}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-center text-xs text-slate-500">หน้านี้สำหรับเจ้าของบ้านเท่านั้น อย่าส่งต่อลิงก์ · ให้บริการโดย PlanBaan</p>
    </main>
  );
}
