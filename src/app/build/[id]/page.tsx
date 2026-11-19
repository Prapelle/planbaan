import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { PhotoUpload } from "@/components/PhotoUpload";
import { BuildTabs } from "@/components/BuildTabs";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { activeShareLink, createShareLink, revokeShareLinks, listMembers } from "@/lib/control";
import { back, baht, errMsg, fv } from "@/lib/form";
import { canManageBuild, canSeeCosts, canUpdateBuild } from "@/lib/roles";
import { sniffImage } from "@/lib/planmap";
import * as C from "@/lib/construction";
import * as S from "@/lib/sales";

export const dynamic = "force-dynamic";
const MAX_PHOTO = 5 * 1024 * 1024;
const here = (id: string) => `/build/${id}`;

async function guard(id: string, level: "update" | "manage") {
  const ctx = await requireProject({ action: "edit", target: here(id) });
  if (!ctx.project.construction_enabled) back("/build", { error: "ยังไม่ได้เปิดส่วนก่อสร้าง" });
  const ok = level === "manage" ? canManageBuild(ctx.role, ctx.access.supportCanEdit) : canUpdateBuild(ctx.role, ctx.access.supportCanEdit);
  if (!ok || ctx.readonly) back(here(id), { error: "ไม่มีสิทธิ์ทำรายการนี้" });
  return ctx;
}
async function run(id: string, level: "update" | "manage", fn: (ctx: Awaited<ReturnType<typeof guard>>) => Promise<unknown>, msg: string, extra?: Record<string, string>) {
  const ctx = await guard(id, level);
  try { await fn(ctx); } catch (e) { back(here(id), { error: errMsg(e) }); }
  revalidatePath(here(id));
  revalidatePath("/build");
  back(here(id), { msg, extra });
}

async function stageDoneAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  const done = fv(f, "done") === "1";
  await run(id, "update", (c) => C.setStageDone(c.db, fv(f, "stage"), done, c.email, fv(f, "note")), done ? "บันทึกงวดเสร็จแล้ว" : "ยกเลิกงวดเสร็จแล้ว");
}
async function noteAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  await run(id, "update", (c) => C.addNote(c.db, id, fv(f, "note"), c.email), "บันทึกหน้างานแล้ว");
}
async function photoAction(f: FormData): Promise<{ error?: string }> {
  "use server";
  const id = fv(f, "build");
  const ctx = await requireProject({ action: "edit", target: here(id) });
  if (!ctx.project.construction_enabled || ctx.readonly || !canUpdateBuild(ctx.role, ctx.access.supportCanEdit)) return { error: "ไม่มีสิทธิ์" };
  const file = f.get("file");
  const bucket = ctx.env.BACKUPS;
  if (!bucket) return { error: "ยังไม่ได้เชื่อมที่เก็บไฟล์" };
  if (!(file instanceof Blob) || file.size === 0) return { error: "ไม่พบรูป" };
  if (file.size > MAX_PHOTO) return { error: "รูปใหญ่เกิน 5MB" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { error: "รองรับเฉพาะรูป JPG PNG WEBP" };
  try {
    await C.getBuild(ctx.db, id);
    const key = `${C.photoPrefix(ctx.project.id, id)}${crypto.randomUUID()}.${kind.ext}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: kind.mime } });
    await C.addPhoto(ctx.db, id, { key, stageId: fv(f, "stage") || undefined, caption: fv(f, "caption") }, ctx.email);
  } catch (e) { return { error: errMsg(e) }; }
  revalidatePath(here(id));
  return {};
}
async function publishAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  const pub = fv(f, "publish") === "1";
  await run(id, "manage", (c) => C.setPhotoPublished(c.db, fv(f, "photo"), pub), pub ? "เผยแพร่รูปให้เจ้าของบ้านเห็นแล้ว" : "ซ่อนรูปแล้ว");
}
async function deletePhotoAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  await run(id, "manage", async (c) => { const key = await C.removePhoto(c.db, fv(f, "photo")); await c.env.BACKUPS?.delete(key).catch(() => {}); }, "ลบรูปแล้ว");
}
async function stageEditAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  await run(id, "manage", (c) => C.updateStage(c.db, fv(f, "stage"), { name: fv(f, "name"), plannedEnd: fv(f, "planned_end"), payAmount: fv(f, "pay"), drawAmount: fv(f, "draw") }, c.email), "บันทึกงวดแล้ว");
}
async function paidAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  const paid = fv(f, "paid") === "1";
  await run(id, "manage", (c) => C.setPaid(c.db, fv(f, "stage"), paid, c.email), paid ? "บันทึกรับเงินงวดแล้ว" : "ยกเลิกรับเงินแล้ว");
}
async function drawAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  await run(id, "manage", (c) => C.setDraw(c.db, fv(f, "stage"), fv(f, "status"), c.email), "บันทึกการเบิกกู้แล้ว");
}
async function buildEditAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  await run(id, "manage", async (c) => {
    const owner = fv(f, "owner");
    if (owner && !(await listMembers(controlDb(c.env), c.project.id)).some((m) => m.email === owner)) throw new Error("ผู้รับผิดชอบต้องเป็นผู้ใช้ในโครงการ");
    return C.updateBuild(c.db, id, { ownerEmail: owner,
    title: fv(f, "title"), customerName: fv(f, "customer"), dueDate: fv(f, "due"), price: fv(f, "price"), note: fv(f, "note"),
    showDelay: f.get("show_delay") === "1", ...(f.get("status") ? { status: fv(f, "status") } : {}),
  }, c.email); }, "บันทึกข้อมูลงานแล้ว");
}
async function changeAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  await run(id, "manage", (c) => C.addChange(c.db, id, { title: fv(f, "title"), amount: fv(f, "amount") }, c.email), "เพิ่มงานเพิ่ม-ลดแล้ว ส่งลิงก์ให้ลูกค้ายืนยัน หรือบันทึกแทนเมื่อลูกค้ายืนยันทางอื่น");
}
async function decideAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  const d = fv(f, "decision") as "confirmed" | "rejected";
  await run(id, "manage", (c) => (fv(f, "cancel") ? C.cancelChange(c.db, fv(f, "change"), c.email) : C.decideChange(c.db, fv(f, "change"), d, c.email, fv(f, "note"))), "บันทึกแล้ว");
}
async function finishAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  await run(id, "manage", async (c) => {
    const b = await C.finishBuild(c.db, id, c.email);
    // รับสร้างบ้าน: ส่งมอบบ้าน → ลูกค้าไปขั้น "ส่งมอบ"
    if (c.project.kind === "builder" && b.lead_id) {
      const l = await c.db.get("leads", String(b.lead_id));
      if (l && l.stage !== "transferred") await S.moveLead(c.db, String(b.lead_id), "transferred", c.email, { requirePlot: false });
    }
  }, "ส่งมอบบ้านแล้ว");
}
async function linkAction(f: FormData) {
  "use server";
  const id = fv(f, "build");
  const ctx = await guard(id, "manage");
  let token = "";
  try {
    await C.getBuild(ctx.db, id);
    if (fv(f, "revoke")) await revokeShareLinks(controlDb(ctx.env), ctx.project.id, id);
    else token = await createShareLink(controlDb(ctx.env), ctx.project.id, id, ctx.email);
  } catch (e) { back(here(id), { error: errMsg(e) }); }
  revalidatePath(here(id));
  back(here(id), token ? { msg: "ออกลิงก์ใหม่แล้ว คัดลอกส่งให้เจ้าของบ้าน ลิงก์นี้แสดงครั้งเดียว ลิงก์เก่าใช้ไม่ได้แล้ว", extra: { link: token } } : { msg: "ยกเลิกลิงก์แล้ว เจ้าของบ้านเปิดลิงก์เดิมไม่ได้" });
}

const thDay = (d: unknown) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "-");
const when = (iso: unknown) => new Date(String(iso)).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const input = "min-h-10 rounded-md border border-slate-300 px-2";
const H = ({ name, value }: { name: string; value: string }) => <input type="hidden" name={name} value={value} />;

export default async function BuildDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string; link?: string }> }) {
  const { id } = await params;
  const ctx = await requireProject({ action: "view", target: here(id) });
  if (!ctx.project.construction_enabled) back("/build", {});
  const sp = await searchParams;
  const build = await ctx.db.get("builds", id);
  if (!build) notFound();
  await ctx.usage("page_view", { page: "build_detail" });
  const [stages, photos, changes, log, link, members] = await Promise.all([
    C.stagesOf(ctx.db, id),
    ctx.db.list("build_photos", { where: { build_id: id }, limit: 500, orderBy: "created_at", desc: true }),
    ctx.db.list("build_changes", { where: { build_id: id }, limit: 200, orderBy: "created_at", desc: true }),
    ctx.db.list("build_log", { where: { build_id: id }, limit: 50, orderBy: "created_at", desc: true }),
    activeShareLink(controlDb(ctx.env), ctx.project.id, id),
    listMembers(controlDb(ctx.env), ctx.project.id),
  ]);
  const staff = members.filter((m) => ["owner", "manager", "foreman"].includes(m.role) || m.email === build.owner_email);
  const s = C.summarize(build, stages, changes, { staleDays: Number(ctx.project.build_stale_days ?? 7) });
  const canUpdate = canUpdateBuild(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly && build.status !== "done";
  const canManage = canManageBuild(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly;
  const foreman = ctx.role === "foreman";
  const builder = ctx.project.kind === "builder";
  const lastDone = [...stages].reverse().find((x) => x.done_at);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const shareUrl = sp.link && /^[A-Za-z0-9_-]{40,64}$/.test(sp.link) ? `${origin}/h/${sp.link}` : "";
  const showDraws = builder || stages.some((x) => Number(x.draw_amount) > 0);
  const stageName = new Map(stages.map((x) => [x.id, String(x.name)]));

  return (
    <ProjectShell ctx={ctx} active="/build">
      <Link href="/build" className="text-sm text-brand-700 underline">‹ งานก่อสร้างทั้งหมด</Link>
      <div className="mb-3 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{String(build.title)}</h1>
          <div className="text-sm text-slate-600">
            {[build.plot_code && `แปลง ${build.plot_code}`, !foreman && build.customer_name && `เจ้าของบ้าน ${build.customer_name}`, `เริ่ม ${thDay(build.start_date)}`, `ส่งมอบตามสัญญา ${thDay(build.due_date)}`].filter(Boolean).join(" · ")}
            {!foreman && !!build.lead_id && <> · <Link href={`/leads/${build.lead_id}`} className="text-brand-700 underline">ข้อมูลลูกค้า</Link></>}
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{C.BUILD_STATUS_LABEL[String(build.status)]}</span>
      </div>
      <BuildTabs id={id} active="progress" showCosts={canSeeCosts(ctx.role)} />
      <Notice error={sp.error} msg={sp.msg} />
      {shareUrl && (
        <div className="mb-4 rounded-md border-2 border-brand-600 bg-white p-3 text-sm">
          <div className="mb-1 font-semibold">ลิงก์สำหรับเจ้าของบ้าน (คัดลอกตอนนี้ ระบบไม่เก็บลิงก์นี้ไว้)</div>
          <input readOnly value={shareUrl} className="w-full rounded border border-slate-300 p-2 font-mono text-xs" aria-label="ลิงก์เจ้าของบ้าน" />
        </div>
      )}

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-1 flex justify-between text-sm"><span>{s.current ? `งวดปัจจุบัน: ${s.current.name}` : "ครบทุกงวดแล้ว"}</span><b>{s.pct}% ({s.doneCount}/{stages.length} งวด)</b></div>
        <div className="mb-2 h-3 rounded bg-slate-100" aria-hidden="true"><div className="h-3 rounded bg-brand-600" style={{ width: `${s.pct}%` }} /></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {s.lateDays > 0 && <span className="font-semibold text-red-700">ช้ากว่าแผน {s.lateDays} วัน</span>}
          {s.overdueDays > 0 && <span className="font-semibold text-red-700">เลยกำหนดส่งมอบ {s.overdueDays} วัน</span>}
          {build.status !== "done" && <span className={s.stale ? "font-semibold text-red-700" : "text-slate-600"}>อัปเดตล่าสุด {s.idleDays === 0 ? "วันนี้" : `${s.idleDays} วันก่อน`}</span>}
          {!foreman && <span className="text-slate-700">ราคาสัญญา {baht(build.contract_price)} · งานเพิ่ม-ลดที่ยืนยัน {s.changesConfirmed >= 0 ? "+" : ""}{baht(s.changesConfirmed)} · รับเงินแล้ว {baht(s.paidTotal)}/{baht(s.payTotal)}</span>}
        </div>
      </section>

      {canUpdate && (
        <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border-2 border-slate-900 bg-white p-4 text-sm">
            <h2 className="font-semibold">อัปเดตหน้างาน</h2>
            {s.current && (
              <form action={stageDoneAction} className="flex flex-col gap-2">
                <H name="build" value={id} /><H name="stage" value={String(s.current.id)} /><H name="done" value="1" />
                <label className="flex flex-col gap-1">หมายเหตุ (ถ้ามี)<input name="note" maxLength={300} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                <button className="min-h-12 rounded-md bg-emerald-700 px-4 text-base font-semibold text-white">งวด {String(s.current.seq)} &quot;{String(s.current.name)}&quot; เสร็จแล้ว</button>
              </form>
            )}
            <form action={noteAction} className="flex flex-col gap-2 border-t border-slate-200 pt-3">
              <H name="build" value={id} />
              <label className="flex flex-col gap-1">บันทึกหน้างาน (ความคืบหน้า ปัญหา ฝนตก ของไม่มา)<textarea name="note" rows={2} required maxLength={1000} className="rounded-md border border-slate-300 p-3" /></label>
              <button className="min-h-11 rounded-md border border-slate-400 px-4 font-semibold">บันทึก</button>
            </form>
          </div>
          <div className="rounded-lg border-2 border-slate-900 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">รูปหน้างาน</h2>
            <PhotoUpload action={photoAction} projectId={ctx.project.id} buildId={id} stages={stages.map((x) => ({ id: String(x.id), name: String(x.name) }))} defaultStage={s.current ? String(s.current.id) : undefined} />
          </div>
        </section>
      )}

      <section className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 font-semibold">งวดงาน{!foreman && " · งวดเงิน"}{!foreman && showDraws && " · เบิกกู้ปลูกสร้าง"}</h2>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-slate-600"><tr className="border-b border-slate-200">
            <th className="p-3 font-medium">งวด</th><th className="p-3 font-medium">กำหนดเสร็จ</th><th className="p-3 font-medium">เสร็จจริง</th>
            {!foreman && <th className="p-3 text-right font-medium">งวดเงิน (บาท)</th>}{!foreman && showDraws && <th className="p-3 font-medium">เบิกกู้</th>}<th className="p-3" />
          </tr></thead>
          <tbody>
            {stages.map((x) => {
              const late = !x.done_at && String(x.planned_end) < S.bkkDate();
              const lateDone = x.done_at && String(x.done_at) > String(x.planned_end);
              return (
                <tr key={x.id} className="border-b border-slate-100 align-top">
                  <td className="p-3"><b>{String(x.seq)}. {String(x.name)}</b></td>
                  <td className={`p-3 ${late ? "font-semibold text-red-700" : ""}`}>{thDay(x.planned_end)}</td>
                  <td className={`p-3 ${lateDone ? "text-amber-800" : ""}`}>{x.done_at ? `${thDay(x.done_at)}${lateDone ? ` (ช้า ${C.daysBetween(String(x.done_at), String(x.planned_end))} วัน)` : ""}` : "–"}</td>
                  {!foreman && (
                    <td className="p-3 text-right">
                      {Number(x.pay_amount) > 0 ? baht(x.pay_amount) : "–"}
                      {Number(x.pay_amount) > 0 && <div className={`text-xs ${x.paid_at ? "text-emerald-800" : x.done_at ? "font-semibold text-amber-800" : "text-slate-600"}`}>{x.paid_at ? `รับแล้ว ${thDay(x.paid_at)}` : x.done_at ? "รอเก็บ" : "ยังไม่ถึงงวด"}</div>}
                      {canManage && Number(x.pay_amount) > 0 && !!x.done_at && (
                        <form action={paidAction}><H name="build" value={id} /><H name="stage" value={String(x.id)} /><H name="paid" value={x.paid_at ? "" : "1"} />
                          <button className="text-xs text-brand-700 underline">{x.paid_at ? "ยกเลิกรับเงิน" : "บันทึกรับเงิน"}</button></form>
                      )}
                    </td>
                  )}
                  {!foreman && showDraws && (
                    <td className="p-3">
                      {Number(x.draw_amount) > 0 ? <>{baht(x.draw_amount)} · {C.DRAW_LABEL[String(x.draw_status)]}</> : "–"}
                      {canManage && Number(x.draw_amount) > 0 && !!x.done_at && x.draw_status !== "released" && (
                        <form action={drawAction}><H name="build" value={id} /><H name="stage" value={String(x.id)} /><H name="status" value={x.draw_status === "requested" ? "released" : "requested"} />
                          <button className="text-xs text-brand-700 underline">{x.draw_status === "requested" ? "ธนาคารจ่ายแล้ว" : "ยื่นเบิกงวดนี้"}</button></form>
                      )}
                    </td>
                  )}
                  <td className="p-3">
                    {canUpdate && lastDone?.id === x.id && (
                      <form action={stageDoneAction}><H name="build" value={id} /><H name="stage" value={String(x.id)} /><H name="done" value="" />
                        <button className="text-xs text-red-700 underline">ยกเลิกงวดเสร็จ</button></form>
                    )}
                    {canManage && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-brand-700 underline">แก้</summary>
                        <form action={stageEditAction} className="mt-2 flex flex-col gap-1">
                          <H name="build" value={id} /><H name="stage" value={String(x.id)} />
                          <label className="flex flex-col">ชื่องวด<input name="name" defaultValue={String(x.name)} className={input} /></label>
                          <label className="flex flex-col">กำหนดเสร็จ<input type="date" name="planned_end" defaultValue={String(x.planned_end)} className={input} /></label>
                          <label className="flex flex-col">งวดเงินจากลูกค้า<input name="pay" inputMode="decimal" defaultValue={Number(x.pay_amount) || ""} className={input} /></label>
                          <label className="flex flex-col">เบิกกู้ปลูกสร้าง<input name="draw" inputMode="decimal" defaultValue={Number(x.draw_amount) || ""} className={input} /></label>
                          <button className="min-h-10 rounded-md bg-slate-900 px-3 font-semibold text-white">บันทึก</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">รูปหน้างาน ({photos.length})</h2>
        {canManage && <p className="mb-3 text-sm text-slate-600">รูปที่มีป้าย &quot;เจ้าของบ้านเห็น&quot; แสดงในหน้าติดตามของเจ้าของบ้าน</p>}
        {photos.length === 0 && <p className="text-sm text-slate-600">ยังไม่มีรูป</p>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((ph) => (
            <li key={ph.id} className="flex flex-col gap-1 text-xs">
              <a href={`/api/build-photo?id=${ph.id}`} target="_blank" rel="noopener">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/build-photo?id=${ph.id}`} alt={String(ph.caption) || "รูปหน้างาน"} loading="lazy" className="aspect-square w-full rounded-md border border-slate-200 object-cover" />
              </a>
              <div>{when(ph.created_at)}{ph.stage_id ? ` · ${stageName.get(String(ph.stage_id)) ?? ""}` : ""}</div>
              {!!ph.caption && <div className="text-slate-700">{String(ph.caption)}</div>}
              {ph.published ? <span className="self-start rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-900">เจ้าของบ้านเห็น</span> : null}
              {canManage && (
                <div className="flex gap-3">
                  <form action={publishAction}><H name="build" value={id} /><H name="photo" value={String(ph.id)} /><H name="publish" value={ph.published ? "" : "1"} />
                    <button className="text-brand-700 underline">{ph.published ? "ซ่อน" : "เผยแพร่"}</button></form>
                  <form action={deletePhotoAction}><H name="build" value={id} /><H name="photo" value={String(ph.id)} />
                    <button className="text-red-700 underline">ลบ</button></form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">งานเพิ่ม-ลด</h2>
        <p className="mb-3 text-slate-600">เริ่มทำได้เมื่อลูกค้ายืนยันแล้วเท่านั้น ลูกค้ายืนยันเองผ่านลิงก์ หรือพนักงานบันทึกแทนพร้อมหมายเหตุว่ายืนยันทางไหน</p>
        {changes.length === 0 && <p className="mb-3 text-slate-600">ยังไม่มี</p>}
        <ul className="mb-3 flex flex-col divide-y divide-slate-100">
          {changes.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 py-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span><b>{String(c.title)}</b>{!foreman && <> · {Number(c.amount) > 0 ? "+" : ""}{baht(c.amount)} บาท</>}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.status === "confirmed" ? "bg-emerald-100 text-emerald-900" : c.status === "pending" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{C.CHANGE_LABEL[String(c.status)]}</span>
              </div>
              {!!c.decided_at && c.status !== "cancelled" && (
                <div className="text-xs text-slate-600">
                  {String(c.decided_by).startsWith("owner_link:") ? `เจ้าของบ้านยืนยันผ่านลิงก์ ชื่อ "${String(c.decided_by).slice(11)}"` : `บันทึกแทนโดย ${c.decided_by}`} · {when(c.decided_at)}{c.decided_note ? ` · ${c.decided_note}` : ""}
                </div>
              )}
              {canManage && c.status === "pending" && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-brand-700 underline">บันทึกแทนลูกค้า / ยกเลิก</summary>
                  <form action={decideAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <H name="build" value={id} /><H name="change" value={String(c.id)} />
                    <label className="flex flex-col">ลูกค้าตอบ<select name="decision" className={input}><option value="confirmed">ยืนยัน</option><option value="rejected">ไม่รับ</option></select></label>
                    <label className="flex flex-col">ยืนยันทางไหน (จำเป็น)<input name="note" placeholder="เช่น โทรคุยวันที่ 17 พ.ย. / ข้อความ LINE" className={`${input} w-64`} /></label>
                    <button className="min-h-10 rounded-md bg-slate-900 px-3 font-semibold text-white">บันทึก</button>
                    <button name="cancel" value="1" className="min-h-10 rounded-md border border-red-300 px-3 text-red-700">ยกเลิกรายการ</button>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
        {canManage && build.status !== "done" && (
          <form action={changeAction} className="flex flex-wrap items-end gap-2">
            <H name="build" value={id} />
            <label className="flex flex-col gap-1">รายการ<input name="title" required maxLength={200} placeholder="เช่น เพิ่มกันสาดหน้าบ้าน" className="min-h-11 w-72 rounded-md border border-slate-300 px-3" /></label>
            <label className="flex flex-col gap-1">ราคา (งานลดใส่ติดลบ)<input name="amount" required inputMode="decimal" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
            <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white">เพิ่ม</button>
          </form>
        )}
      </section>

      {canManage && (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h2 className="font-semibold">หน้าติดตามของเจ้าของบ้าน</h2>
            <p className="text-slate-600">เจ้าของบ้านเปิดดูได้ไม่ต้องล็อกอิน เห็นงวดงาน รูปที่เผยแพร่ งวดเงิน กำหนดส่งมอบ และยืนยันงานเพิ่ม-ลด{build.show_delay ? " และความล่าช้า" : " (ตั้งไว้ไม่แสดงความล่าช้า)"}</p>
            <p>{link ? `มีลิงก์ใช้งานอยู่ ออกเมื่อ ${when(link.created_at)}` : "ยังไม่มีลิงก์"}</p>
            <div className="flex flex-wrap gap-2">
              <form action={linkAction}><H name="build" value={id} /><button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white">{link ? "ออกลิงก์ใหม่ (ลิงก์เดิมใช้ไม่ได้)" : "ออกลิงก์"}</button></form>
              {link && <form action={linkAction}><H name="build" value={id} /><H name="revoke" value="1" /><button className="min-h-11 rounded-md border border-red-300 px-4 font-medium text-red-700">ยกเลิกลิงก์</button></form>}
            </div>
          </section>

          <form action={buildEditAction} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
            <H name="build" value={id} />
            <h2 className="font-semibold sm:col-span-2">ข้อมูลงาน</h2>
            <label className="flex flex-col gap-1">ชื่องาน<input name="title" defaultValue={String(build.title)} className={input} /></label>
            <label className="flex flex-col gap-1">เจ้าของบ้าน<input name="customer" defaultValue={String(build.customer_name)} className={input} /></label>
            <label className="flex flex-col gap-1">ผู้รับผิดชอบ
              <select name="owner" defaultValue={String(build.owner_email ?? "")} className={input}>
                <option value="">ยังไม่กำหนด</option>
                {staff.map((m) => <option key={m.email} value={m.email}>{m.email}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">กำหนดส่งมอบ<input type="date" name="due" defaultValue={String(build.due_date)} className={input} /></label>
            <label className="flex flex-col gap-1">ราคาสัญญา<input name="price" inputMode="decimal" defaultValue={Number(build.contract_price) || ""} className={input} /></label>
            {build.status !== "done" && (
              <label className="flex flex-col gap-1">สถานะ<select name="status" defaultValue={String(build.status)} className={input}><option value="active">กำลังสร้าง</option><option value="paused">หยุดชั่วคราว</option></select></label>
            )}
            <label className="flex min-h-10 items-center gap-2 self-end"><input type="checkbox" name="show_delay" value="1" defaultChecked={!!build.show_delay} className="h-5 w-5" />แสดงความล่าช้าให้เจ้าของบ้านเห็น</label>
            <label className="flex flex-col gap-1 sm:col-span-2">หมายเหตุภายใน<textarea name="note" rows={2} defaultValue={String(build.note)} className="rounded-md border border-slate-300 p-2" /></label>
            <button className="min-h-10 rounded-md border border-slate-400 px-4 font-semibold sm:col-span-2">บันทึก</button>
          </form>
        </div>
      )}
      {canManage && build.status !== "done" && s.doneCount === stages.length && (
        <form action={finishAction} className="mb-4"><H name="build" value={id} />
          <button className="min-h-12 w-full rounded-md bg-emerald-700 px-4 text-base font-semibold text-white">ส่งมอบบ้าน{builder && build.lead_id ? " (ลูกค้าจะย้ายไปขั้นส่งมอบ)" : ""}</button></form>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">ประวัติ (ล่าสุด 50 รายการ)</h2>
        <ol className="flex flex-col gap-2">
          {log.map((l) => (
            <li key={l.id} className="border-l-2 border-slate-300 pl-3">
              <div className="text-xs text-slate-600">{when(l.created_at)} · {String(l.actor).startsWith("owner_link:") ? `เจ้าของบ้าน (${String(l.actor).slice(11)})` : String(l.actor)}</div>
              <div><b>{C.LOG_LABEL[String(l.kind)] ?? String(l.kind)}</b>{l.note ? ` · ${l.note}` : ""}</div>
            </li>
          ))}
        </ol>
      </section>
    </ProjectShell>
  );
}
