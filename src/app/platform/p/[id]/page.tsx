import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { projectUrl, requireStaff } from "@/lib/context";
import { BackShell } from "@/components/BackShell";
import { controlDb } from "@/lib/d1";
import { getProject, listMembers, listSupportGrants, ownersOf, setConstruction } from "@/lib/control";
import { shardDb } from "@/lib/d1";
import { tenantDb } from "@/lib/tenant-db";
import { BUILD_PRICE, billableInMonth } from "@/lib/construction";
import { projectUsage } from "@/lib/usage";
import { ENT, SOURCE_LABEL, STATE_LABEL, entitlementOf, listPurchases, recordPurchase, setAccess } from "@/lib/entitlement";
import { ROLE_LABEL, type ProjectRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const go = (id: string, p: { error?: string; msg?: string }) => {
  const u = new URLSearchParams(p as Record<string, string>);
  redirect(`/platform/p/${id}?${u}`);
};

async function purchaseAction(f: FormData) {
  "use server";
  const { env, email } = await requireStaff();
  const id = String(f.get("id"));
  let until = "";
  try { until = await recordPurchase(controlDb(env), id, String(f.get("month")), String(f.get("amount") ?? ""), email); }
  catch (e) { go(id, { error: (e as Error).message }); }
  revalidatePath(`/platform/p/${id}`);
  go(id, { msg: until ? `บันทึกแล้ว สิทธิ์จากยอดซื้อใช้ได้ถึง ${until}` : "บันทึกแล้ว ยอดยังไม่ถึงขั้นต่ำ" });
}

async function accessAction(f: FormData) {
  "use server";
  const { env, staffRole } = await requireStaff();
  const id = String(f.get("id"));
  if (staffRole !== "admin") go(id, { error: "เปลี่ยนสิทธิ์ได้เฉพาะ admin" });
  try {
    await setAccess(controlDb(env), id, {
      paidUntil: String(f.get("paid_until") ?? ""), trialEndsAt: String(f.get("trial_ends_at") ?? ""),
      status: f.get("readonly") ? "readonly" : "active",
    });
  } catch (e) { go(id, { error: (e as Error).message }); }
  revalidatePath(`/platform/p/${id}`);
  go(id, { msg: "บันทึกสิทธิ์แล้ว" });
}

async function constructionAction(f: FormData) {
  "use server";
  const { env, staffRole } = await requireStaff();
  const id = String(f.get("id"));
  if (staffRole !== "admin") go(id, { error: "เปิด/ปิดส่วนก่อสร้างได้เฉพาะ admin" });
  await setConstruction(controlDb(env), id, { enabled: f.get("enabled") === "1" });
  revalidatePath(`/platform/p/${id}`);
  go(id, { msg: f.get("enabled") === "1" ? "เปิดส่วนก่อสร้างแล้ว" : "ปิดส่วนก่อสร้างแล้ว (ข้อมูลยังอยู่ เปิดใหม่ได้)" });
}

const EVENT_LABEL: Record<string, string> = {
  page_view: "เปิดหน้า", login: "เข้าสู่ระบบ", lead_created: "เพิ่มลูกค้า", lead_stage_changed: "เปลี่ยนขั้นลูกค้า", plot_created: "เพิ่มแปลง", plot_updated: "แก้แปลง",
  member_added: "เพิ่มผู้ใช้", member_removed: "ลบผู้ใช้", support_granted: "เปิดสิทธิ์ทีมช่วยเหลือ", support_revoked: "ปิดสิทธิ์ทีมช่วยเหลือ",
  export: "ส่งออกข้อมูล", marketing_import: "นำเข้าไฟล์โฆษณา", marketing_updated: "แก้ข้อมูลการตลาด",
};
const input = "min-h-11 rounded-lg border border-ops-line px-3";
const lastMonths = (n: number) => {
  const d = new Date(Date.now() + 7 * 3600_000);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
};

export default async function ProjectAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { env, email, staffRole } = await requireStaff();
  const { id } = await params;
  const { error, msg } = await searchParams;
  const db = controlDb(env);
  const project = await getProject(db, id);
  if (!project) notFound();
  // อ่านพร้อมกันทั้งหมด · งานก่อสร้างอ่านเฉพาะวันที่และสถานะ (ไม่อ่านเนื้อหาอื่นของงาน) เพื่อคิดเงินส่วนก่อสร้าง
  const [owners, members, purchases, usage, grants, buildRows] = await Promise.all([
    ownersOf(db, id), listMembers(db, id), listPurchases(db, id), projectUsage(db, id, 30), listSupportGrants(db, id),
    tenantDb(shardDb(env, project.shard), id).list("builds", { limit: 2000, columns: ["start_date", "done_at", "status"] }),
  ]);
  const ent = entitlementOf(project);
  const builds = buildRows.map((b) => ({ id: b.id, start_date: b.start_date, done_at: b.done_at, status: b.status }));
  const months = lastMonths(6);
  const billing = months.map((m) => ({ month: m, houses: billableInMonth(builds, m) }));
  const roleCount = members.reduce<Record<string, number>>((a, m) => { a[m.role] = (a[m.role] ?? 0) + 1; return a; }, {});
  const maxDay = Math.max(1, ...usage.daily.map((d) => d.n));
  const byMonth = new Map(purchases.map((p) => [p.month, p]));
  const activeGrant = grants.find((g) => !g.revoked_at && g.expires_at > new Date().toISOString());

  return (
    <BackShell env={env} email={email} staffRole={staffRole} active="projects">
      <Link href="/platform/projects" className="text-sm font-medium text-ops-link underline">กลับไปรายการโครงการ</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <div className="text-sm text-ops-muted">{project.slug} · {project.province || "ไม่ระบุจังหวัด"} · สร้างเมื่อ {project.created_at.slice(0, 10)}</div>
        </div>
        <a href={projectUrl(project.slug)} className="text-sm text-ops-link underline">เปิดโครงการ (ต้องได้รับสิทธิ์จากลูกค้า)</a>
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {msg && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <section className="rounded-xl border border-ops-line bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">ติดต่อ</h2>
          <div className="text-ops-muted">เจ้าของโครงการ</div>
          <ul className="mb-2">{owners.map((o) => <li key={o}>{o}</li>)}</ul>
          <div className="text-ops-muted">ผู้ใช้ {members.length} คน</div>
          <div>{Object.entries(roleCount).map(([r, n]) => `${ROLE_LABEL[r as ProjectRole] ?? r} ${n}`).join(" · ")}</div>
        </section>
        <section className="rounded-xl border border-ops-line bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">สิทธิ์ใช้งาน</h2>
          <div className="text-2xl font-bold">{STATE_LABEL[ent.state]}</div>
          <div>{ent.until ? `ถึง ${ent.until} (${SOURCE_LABEL[ent.source]})` : "ยังไม่กำหนด"}</div>
          {ent.until && !ent.readonly && <div className="text-ops-muted">ดูอย่างเดียวตั้งแต่ {ent.readonlyFrom} ถ้าไม่ต่อ</div>}
          {ent.manual && <div className="font-semibold text-red-700">ทีมงานตั้งเป็นดูอย่างเดียวเอง</div>}
          <dl className="mt-2 grid grid-cols-2 text-xs text-ops-muted">
            <dt>ทดลองถึง</dt><dd>{project.trial_ends_at || "-"}</dd>
            <dt>ยอดซื้อถึง</dt><dd>{project.pure_until || "-"}</dd>
            <dt>ขยายให้ถึง</dt><dd>{project.paid_until || "-"}</dd>
          </dl>
        </section>
        <section className="rounded-xl border border-ops-line bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">ทีมช่วยเหลือ</h2>
          {activeGrant
            ? <p>ลูกค้าเปิดสิทธิ์ให้ถึง {new Date(activeGrant.expires_at).toLocaleString("th-TH")} ({activeGrant.can_edit ? "แก้ไขได้" : "ดูอย่างเดียว"})</p>
            : <p className="text-ops-muted">ยังไม่ได้เปิดสิทธิ์ ข้อมูลลูกค้าของโครงการนี้ทีมงานเข้าไม่ได้</p>}
          <p className="mt-2 text-xs text-ops-muted">เปิดสิทธิ์ทั้งหมด {grants.length} ครั้ง</p>
        </section>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-ops-line bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">ยอดซื้อ Pure Product</h2>
          <p className="mb-3 text-ops-muted">ยอดรวม {ENT.windowMonths} เดือนติดกันถึง {ENT.pureMin.toLocaleString("th-TH")} บาท → ใช้ฟรีถึงสิ้นเดือนถัดไป · ใส่ 0 เพื่อลบ</p>
          <table className="mb-3 w-full">
            <tbody>
              {lastMonths(6).map((m) => (
                <tr key={m} className="border-b border-ops-line">
                  <td className="py-2">{m}</td>
                  <td className="py-2 text-right tabular-nums">{byMonth.get(m) ? Number(byMonth.get(m)!.amount).toLocaleString("th-TH") : "–"}</td>
                  <td className="py-2 pl-3 text-xs text-ops-muted">{byMonth.get(m)?.recorded_by ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={purchaseAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <label className="flex flex-col gap-1">เดือน<input type="month" name="month" required defaultValue={lastMonths(1)[0]} className={input} /></label>
            <label className="flex flex-col gap-1">ยอดซื้อ (บาท)<input name="amount" required inputMode="decimal" className={input} /></label>
            <button className="min-h-11 rounded-lg bg-ops-btn px-4 font-semibold text-white">บันทึก</button>
          </form>
        </section>

        <form action={accessAction} className="flex flex-col gap-3 rounded-xl border border-ops-line bg-white p-4 text-sm">
          <input type="hidden" name="id" value={id} />
          <h2 className="font-semibold">ปรับสิทธิ์เอง {staffRole !== "admin" && <span className="font-normal text-ops-muted">(เฉพาะ admin)</span>}</h2>
          <fieldset disabled={staffRole !== "admin"} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">ขยายให้ถึง (จ่ายเงินเอง หรือกรณีพิเศษ) เว้นว่าง = ไม่ขยาย<input type="date" name="paid_until" defaultValue={project.paid_until} className={input} /></label>
            <label className="flex flex-col gap-1">วันสุดท้ายของช่วงทดลอง<input type="date" name="trial_ends_at" defaultValue={project.trial_ends_at} className={input} /></label>
            <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="readonly" defaultChecked={project.status === "readonly"} className="h-5 w-5" />ตั้งเป็นดูอย่างเดียวทันที (เช่น ลูกค้าขอหยุดใช้)</label>
            <button className="min-h-11 self-start rounded-lg border border-ops-600 px-4 font-semibold">บันทึกสิทธิ์</button>
          </fieldset>
        </form>
      </div>

      <section className="mb-4 rounded-xl border border-ops-line bg-white p-4 text-sm">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">ส่วนก่อสร้าง (เสียเงิน) · {project.construction_enabled ? "เปิดอยู่" : "ปิดอยู่"}</h2>
          <form action={constructionAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="enabled" value={project.construction_enabled ? "" : "1"} />
            <button disabled={staffRole !== "admin"} className={`min-h-11 rounded-lg px-4 font-semibold ${project.construction_enabled ? "border border-red-300 text-red-700" : "bg-ops-btn text-white hover:bg-ops-btn-hover"}`}>{project.construction_enabled ? "ปิดส่วนก่อสร้าง" : "เปิดส่วนก่อสร้าง"}</button></form>
        </div>
        <p className="mb-2 text-ops-muted">คิด {BUILD_PRICE().toLocaleString("th-TH")} บาทต่อหลังที่กำลังก่อสร้างในเดือนนั้น (เริ่มแล้วและยังไม่ส่งมอบก่อนต้นเดือน รวมหลังที่หยุดชั่วคราว) · ออกบิลจากระบบบัญชีเอง</p>
        <table className="w-full max-w-md"><thead><tr className="text-left text-ops-muted"><th className="pb-1 font-medium">เดือน</th><th className="pb-1 text-right font-medium">หลัง</th><th className="pb-1 text-right font-medium">ยอด (บาท)</th></tr></thead>
          <tbody>{billing.map((b) => <tr key={b.month} className="border-t border-ops-line"><td className="py-1">{b.month}</td><td className="py-1 text-right tabular-nums">{b.houses}</td><td className="py-1 text-right tabular-nums">{(b.houses * BUILD_PRICE()).toLocaleString("th-TH")}</td></tr>)}</tbody></table>
      </section>

      <section className="mb-4 rounded-xl border border-ops-line bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">การใช้งาน 30 วัน</h2>
        <p className="mb-3 text-ops-muted">ผู้ใช้ {usage.users} คน · ไม่รวมการเข้าของทีมช่วยเหลือ · นับเฉพาะจำนวน ไม่มีเนื้อหาข้อมูลลูกค้า</p>
        <div className="mb-4 flex h-24 items-end gap-1" aria-label="จำนวนการใช้งานรายวัน">
          {usage.daily.length === 0 && <span className="text-ops-muted">ยังไม่มีการใช้งาน</span>}
          {usage.daily.map((d) => (
            <div key={d.day} title={`${d.day}: ${d.n} ครั้ง ${d.users} คน`} className="flex-1 rounded-t bg-ops-btn" style={{ height: `${Math.max(4, (d.n / maxDay) * 100)}%` }} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <table className="w-full"><thead><tr className="text-left text-ops-muted"><th className="pb-1 font-medium">เหตุการณ์</th><th className="pb-1 text-right font-medium">ครั้ง</th></tr></thead>
            <tbody>{usage.byEvent.map((e) => <tr key={e.event} className="border-t border-ops-line"><td className="py-1">{EVENT_LABEL[e.event] ?? e.event}</td><td className="py-1 text-right tabular-nums">{e.n}</td></tr>)}</tbody></table>
          <table className="w-full"><thead><tr className="text-left text-ops-muted"><th className="pb-1 font-medium">หน้า</th><th className="pb-1 text-right font-medium">เปิด</th></tr></thead>
            <tbody>{usage.byPage.map((e) => <tr key={e.page} className="border-t border-ops-line"><td className="py-1">{e.page}</td><td className="py-1 text-right tabular-nums">{e.n}</td></tr>)}</tbody></table>
        </div>
      </section>
    </BackShell>
  );
}
