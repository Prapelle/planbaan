import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { listMembers } from "@/lib/control";
import { back, errMsg, fv } from "@/lib/form";
import { canEditData, canManagePromos } from "@/lib/roles";
import * as S from "@/lib/sales";
import * as P from "@/lib/promotions";

export const dynamic = "force-dynamic";

async function guardEdit(id: string) {
  const ctx = await requireProject({ action: "edit", target: `/leads/${id}` });
  if (!(canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly)) back(`/leads/${id}`, { error: "ไม่มีสิทธิ์แก้ไขข้อมูลลูกค้า" });
  return ctx;
}

async function saveAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(id);
  try {
    await S.updateLead(ctx.db, id, {
      name: fv(f, "name"), phone: fv(f, "phone"), channel: fv(f, "channel"), plotCode: fv(f, "plot_code"),
      ownerEmail: fv(f, "owner_email"), nextFollowAt: fv(f, "next_follow_at"), note: fv(f, "note"),
    }, ctx.email, { requirePlot: ctx.project.kind !== "builder" });
    if (f.has("sale_price")) await P.setSalePrice(ctx.db, id, fv(f, "sale_price"));
    // ใส่บันทึกการติดต่อมาด้วย = นับเป็นการติดต่อ (รีเซ็ตวันค้างติดตาม)
    if (fv(f, "contact")) await S.logContact(ctx.db, id, fv(f, "contact"), ctx.email);
  } catch (e) { back(`/leads/${id}`, { error: errMsg(e) }); }
  revalidatePath(`/leads/${id}`);
  const dup = fv(f, "phone") ? await S.findByPhone(ctx.db, fv(f, "phone"), id) : null;
  back(`/leads/${id}`, { msg: (fv(f, "contact") ? "บันทึกข้อมูลและการติดต่อแล้ว" : "บันทึกข้อมูลแล้ว") + (dup ? ` · เบอร์นี้ซ้ำกับลูกค้า ${dup.name} ตรวจว่าเป็นคนเดียวกันหรือไม่` : "") });
}

async function stageAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(id);
  try {
    await S.moveLead(ctx.db, id, fv(f, "stage"), ctx.email, { requirePlot: ctx.project.kind !== "builder", lostReason: fv(f, "lost_reason"), lostNote: fv(f, "lost_note"), kind: ctx.project.kind });
    await ctx.usage("lead_stage_changed", { to: fv(f, "stage") });
  } catch (e) { back(`/leads/${id}`, { error: errMsg(e) }); }
  revalidatePath(`/leads/${id}`);
  back(`/leads/${id}`, { msg: `เปลี่ยนเป็น ${S.stageLabels(ctx.project.kind)[fv(f, "stage") as S.Stage]} แล้ว` });
}

async function addPromoAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(id);
  try {
    await P.addLeadPromo(ctx.db, id, { promoId: fv(f, "promo_id") || undefined, name: fv(f, "name"), kind: fv(f, "kind"), value: fv(f, "value") }, ctx.email);
  } catch (e) { back(`/leads/${id}`, { error: errMsg(e), hash: "price" }); }
  revalidatePath(`/leads/${id}`);
  back(`/leads/${id}`, { msg: "เพิ่มโปรโมชั่นแล้ว", hash: "price" });
}

async function removePromoAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await guardEdit(id);
  try {
    const row = await ctx.db.get("lead_promos", fv(f, "promo"));
    if (!row || row.lead_id !== id) throw new Error("ไม่พบรายการ");
    await P.removeLeadPromo(ctx.db, row.id);
  } catch (e) { back(`/leads/${id}`, { error: errMsg(e), hash: "price" }); }
  revalidatePath(`/leads/${id}`);
  back(`/leads/${id}`, { msg: "เอาโปรโมชั่นออกแล้ว", hash: "price" });
}

async function approveAction(f: FormData) {
  "use server";
  const id = fv(f, "id");
  const ctx = await requireProject({ action: "edit", target: `/leads/${id}` });
  if (!canManagePromos(ctx.role, ctx.access.supportCanEdit) || ctx.readonly) back(`/leads/${id}`, { error: "เจ้าของหรือผู้จัดการเท่านั้นที่อนุมัติส่วนลดได้" });
  let pct = 0;
  try { pct = (await P.approveDiscount(ctx.db, id, ctx.email)).pct; } catch (e) { back(`/leads/${id}`, { error: errMsg(e) }); }
  revalidatePath(`/leads/${id}`);
  back(`/leads/${id}`, { msg: `อนุมัติส่วนลด ${pct.toFixed(1)}% แล้ว`, hash: "price" });
}

const baht = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
const when = (iso: unknown) => new Date(String(iso)).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const KIND: Record<string, string> = { created: "เพิ่มลูกค้า", stage: "เปลี่ยนขั้น", contact: "ติดต่อ", edit: "แก้ไขข้อมูล", loan: "สินเชื่อ" };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { id } = await params;
  const ctx = await requireProject({ action: "view", target: `/leads/${id}` });
  const lead = await ctx.db.get("leads", id);
  if (!lead) notFound();
  const { error, msg } = await searchParams;
  const canEdit = (canEditData(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly);
  const priced = ctx.project.kind !== "builder" && !!lead.plot_code;
  const [plots, members, history, price, promoRows] = await Promise.all([
    ctx.db.list("plots", { limit: 2000 }), listMembers(controlDb(ctx.env), ctx.project.id), S.leadHistory(ctx.db, id),
    priced ? P.priceFor(ctx.db, lead) : Promise.resolve(null),
    priced && canEdit ? P.catalog(ctx.db) : Promise.resolve([]),
  ]);
  const chips = P.available(promoRows, S.bkkDate());
  const canApprove = canManagePromos(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly;
  plots.sort(S.byCode);
  const stage = String(lead.stage) as S.Stage;
  const stale = S.isStale(lead, new Date(), ctx.project.kind);
  const actorName = (a: unknown) => (members.some((m) => m.email === a) ? String(a).split("@")[0] : "ทีมช่วยเหลือ");

  return (
    <ProjectShell ctx={ctx} active="/leads">
      <Link href="/leads" className="mb-3 inline-flex min-h-11 items-center text-sm text-brand-700 underline">‹ กลับหน้าลูกค้า</Link>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{String(lead.name)}</h1>
          {!!lead.phone && <a href={`tel:${String(lead.phone)}`} className="flex min-h-11 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">โทร {String(lead.phone)}</a>}
        </div>
        <span className="text-sm">ขั้น <b>{S.stageLabels(ctx.project.kind)[stage]}</b>{lead.plot_code ? <> · แปลง <Link href={`/plots?plot=${lead.plot_code}`} className="text-brand-700 underline">{String(lead.plot_code)}</Link></> : null}
          {stale && <span className="ml-2 font-semibold text-red-700">ค้าง {S.daysSince(String(lead.last_contact_at))} วัน</span>}
          {(stage === "booked" || stage === "loan") && ctx.project.kind !== "builder" && <Link href={`/loans?lead=${id}`} className="ml-3 font-semibold text-brand-700 underline">ดูสินเชื่อ</Link>}
          {(stage === "booked" || stage === "loan" || stage === "transferred") && ctx.project.kind === "builder" && !!ctx.project.construction_enabled && <Link href={`/build?lead=${id}`} className="ml-3 font-semibold text-brand-700 underline">งานก่อสร้าง</Link>}</span>
      </div>
      <Notice error={error} msg={msg} />

      {stage === "lost" && !!lead.lost_reason && (
        <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-sm">เหตุผลที่{S.stageLabels(ctx.project.kind).lost}: <b>{S.lostLabels(ctx.project.kind)[lead.lost_reason as S.LostReason] ?? String(lead.lost_reason)}</b>{lead.lost_note ? ` · ${String(lead.lost_note)}` : ""}</p>
      )}
      {canEdit && (
        <div className="mb-4 flex flex-wrap items-start gap-2" aria-label="เปลี่ยนขั้น">
          {S.PIPELINE.map((s) => (
            <form key={s} action={stageAction}>
              <input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value={s} />
              <button disabled={s === stage} aria-pressed={s === stage}
                className={`min-h-10 rounded-full border px-3 text-sm font-medium ${s === stage ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white hover:bg-slate-100"}`}>
                {S.stageLabels(ctx.project.kind)[s]}
              </button>
            </form>
          ))}
          {stage === "lost" ? (
            <span aria-current="true" className="flex min-h-10 items-center rounded-full border border-brand-700 bg-brand-700 px-3 text-sm font-medium text-white">{S.stageLabels(ctx.project.kind).lost}</span>
          ) : (
            <details className="group basis-full sm:basis-auto">
              <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-100 group-open:border-red-300 group-open:bg-red-50">{S.stageLabels(ctx.project.kind).lost}…</summary>
              <form action={stageAction} className="mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-red-200 bg-white p-3 text-sm shadow-sm">
                <input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value="lost" />
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 font-semibold">เหตุผลที่{S.stageLabels(ctx.project.kind).lost}</legend>
                  <div className="flex flex-wrap gap-2">
                    {S.LOST_REASONS.map((r) => (
                      <label key={r} className="flex min-h-10 cursor-pointer items-center rounded-full border border-slate-300 px-3 has-[:checked]:border-red-700 has-[:checked]:bg-red-700 has-[:checked]:text-white">
                        <input type="radio" name="lost_reason" value={r} required className="sr-only" />{S.lostLabels(ctx.project.kind)[r]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1">รายละเอียด (ต้องใส่ถ้าเลือก อื่น ๆ)<input name="lost_note" maxLength={300} placeholder="เช่น ซื้อโครงการ ก. ราคาถูกกว่า 2 แสน" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                {!!lead.plot_code && ctx.project.kind !== "builder" && S.stageIdx(stage) >= S.stageIdx("booked") && <p className="text-xs text-red-700">แปลง {String(lead.plot_code)} จะกลับเป็นว่าง</p>}
                <button className="min-h-11 rounded-md bg-red-700 px-4 font-semibold text-white hover:bg-red-800">ยืนยัน {S.stageLabels(ctx.project.kind).lost}</button>
              </form>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <form id="lead-main" action={saveAction} className="flex flex-1 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={!canEdit} className="contents">
            {/* ใช้บ่อยที่สุดขึ้นก่อน: บันทึกการติดต่อ + นัดครั้งถัดไป */}
            {canEdit && (
              <label className="flex flex-col gap-1 rounded-md bg-brand-50 p-3">
                <span className="font-semibold text-brand-800">บันทึกการติดต่อครั้งนี้</span>
                <textarea name="contact" rows={2} maxLength={1000} placeholder="เช่น โทรแล้ว ลูกค้าขอดูแบบบ้านอีกครั้ง" className="rounded-md border border-slate-300 bg-white p-3" />
                <span className="text-xs text-slate-600">ใส่ข้อความแล้วนับเป็นการติดต่อ ป้ายค้างติดตามจะหายไป</span>
              </label>
            )}
            <label className="flex flex-col gap-1">นัดติดตามครั้งถัดไป<input name="next_follow_at" type="date" defaultValue={String(lead.next_follow_at)} className="min-h-11 rounded-md border border-slate-300 px-3" />
              <Link href={`/calendar?lead=${id}#add`} className="text-xs font-medium text-brand-700 underline">เพิ่มนัดหมายพร้อมเวลาในปฏิทิน</Link></label>
            <details className="group rounded-md border border-slate-200" open={!canEdit}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3 [&::-webkit-details-marker]:hidden">
                <span><b>ข้อมูลลูกค้า</b> <span className="text-xs text-slate-600">{[String(lead.phone), S.CHANNEL_LABEL[lead.channel as S.Channel], lead.plot_code ? `แปลง ${lead.plot_code}` : "", `ดูแลโดย ${String(lead.owner_email).split("@")[0]}`].filter(Boolean).join(" · ")}</span></span>
                <span aria-hidden="true" className="text-slate-500 group-open:rotate-180">▾</span>
              </summary>
              <div className="grid grid-cols-1 gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">ชื่อ<input name="name" required defaultValue={String(lead.name)} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                <label className="flex flex-col gap-1">เบอร์โทร<input name="phone" inputMode="tel" defaultValue={String(lead.phone)} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                <label className="flex flex-col gap-1">ช่องทาง
                  <select name="channel" defaultValue={String(lead.channel)} className="min-h-11 rounded-md border border-slate-300 px-3">
                    {S.CHANNELS.map((c) => <option key={c} value={c}>{S.CHANNEL_LABEL[c]}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">แปลง
                  <select name="plot_code" defaultValue={String(lead.plot_code)} className="min-h-11 rounded-md border border-slate-300 px-3">
                    <option value="">ยังไม่เลือก</option>
                    {plots.map((p) => <option key={p.id} value={String(p.code)}>{String(p.code)} · {S.SALE_LABEL[p.sale_status as S.SaleStatus]}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">ผู้ดูแล
                  <select name="owner_email" defaultValue={String(lead.owner_email)} className="min-h-11 rounded-md border border-slate-300 px-3">
                    {!members.some((m) => m.email === lead.owner_email) && <option value={String(lead.owner_email)}>{String(lead.owner_email) || "ไม่ระบุ"}</option>}
                    {members.map((m) => <option key={m.email} value={m.email}>{m.email}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">หมายเหตุเกี่ยวกับลูกค้า<textarea name="note" rows={2} maxLength={1000} defaultValue={String(lead.note)} className="rounded-md border border-slate-300 p-3" /></label>
              </div>
            </details>
            {canEdit && <button className="min-h-12 rounded-md bg-brand-600 px-4 text-base font-semibold text-white hover:bg-brand-700">บันทึก</button>}
          </fieldset>
        </form>

        <div className="flex flex-1 flex-col gap-4">
          {price && <PriceBox id={id} p={price} chips={chips} canEdit={canEdit} canApprove={canApprove} actorName={actorName} />}
          <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">ประวัติ</h2>
            {S.daysSince(String(lead.created_at)) > Number(process.env.ARCHIVE_DAYS ?? 365) && (
              <p className="mb-2 text-xs text-slate-600">ประวัติที่เก่ากว่า 1 ปีย้ายไปเก็บถาวรแล้ว เจ้าของโครงการดาวน์โหลดได้ที่หน้าส่งออกข้อมูล</p>
            )}
            <ol className="flex flex-col gap-2">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-slate-300 pl-3">
                  <div className="text-xs text-slate-600">{when(h.created_at)} · {actorName(h.actor)}</div>
                  <div>{KIND[String(h.kind)] ?? String(h.kind)}
                    {h.kind === "stage" && <> {S.stageLabels(ctx.project.kind)[h.from_stage as S.Stage]} → <b>{S.stageLabels(ctx.project.kind)[h.to_stage as S.Stage]}</b></>}
                    {h.kind === "created" && <> ที่ขั้น {S.stageLabels(ctx.project.kind)[h.to_stage as S.Stage]}</>}
                  </div>
                  {!!h.note && <div className="whitespace-pre-line">{String(h.note)}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </ProjectShell>
  );
}

type Price = Awaited<ReturnType<typeof P.priceFor>>;
function PriceBox({ id, p, chips, canEdit, canApprove, actorName }: {
  id: string; p: Price; chips: Record<string, unknown>[]; canEdit: boolean; canApprove: boolean; actorName: (a: unknown) => string;
}) {
  const s = p.summary;
  const row = (label: string, v: number, minus = true) => v > 0 && (
    <div className="flex justify-between gap-2"><dt>{label}</dt><dd className="tabular-nums">{minus ? "−" : ""}{baht(v)}</dd></div>
  );
  return (
    <section id="price" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h2 className="mb-1 font-semibold">ราคาและโปรโมชั่น</h2>
      <p className="mb-3 text-slate-700">ราคาตั้งของแปลง <b className="tabular-nums">{baht(s.list)}</b> บาท{s.list <= 0 && <span className="text-amber-700"> · แปลงนี้ยังไม่ใส่ราคา</span>}</p>
      {/* ราคาขายจริงเป็นส่วนหนึ่งของฟอร์มหลัก (form="lead-main") ปุ่มนี้กับปุ่มบันทึกด้านบนคือการบันทึกเดียวกัน */}
      {canEdit && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">ราคาขายจริง (บาท)
            <input form="lead-main" name="sale_price" inputMode="decimal" defaultValue={Number(p.lead.sale_price) > 0 ? String(p.lead.sale_price) : ""} placeholder={`เว้นว่าง = ราคาตั้ง ${baht(s.list)}`} className="min-h-11 rounded-md border border-slate-300 px-3" />
          </label>
          <button form="lead-main" className="min-h-11 rounded-md border border-brand-600 px-4 font-semibold text-brand-700 hover:bg-brand-50">บันทึกราคา</button>
        </div>
      )}

      {p.promos.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1">
          {p.promos.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
              <span>{String(x.name)} <span className="text-xs text-slate-600">· {P.PROMO_KIND_LABEL[x.kind as P.PromoKind]}</span></span>
              <span className="flex items-center gap-2"><span className="tabular-nums">{baht(Number(x.value))}</span>
                {canEdit && (
                  <form action={removePromoAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="promo" value={x.id} />
                    <button aria-label={`เอา ${String(x.name)} ออก`} className="min-h-9 min-w-9 rounded-md text-slate-500 hover:bg-slate-200 hover:text-red-700">✕</button></form>
                )}</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mb-3">
          {chips.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2" aria-label="เลือกโปรโมชั่น">
              {chips.map((c) => (
                <form key={String(c.id)} action={addPromoAction} className="flex items-center overflow-hidden rounded-full border border-brand-300 bg-brand-50">
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="promo_id" value={String(c.id)} />
                  <button className="min-h-10 pl-3 pr-2 font-medium text-brand-800 hover:bg-brand-100">+ {String(c.name)}</button>
                  <input name="value" inputMode="decimal" aria-label={`มูลค่า ${String(c.name)}`} defaultValue={Number(c.default_value) > 0 ? String(c.default_value) : ""} placeholder="มูลค่า" className="h-10 w-24 border-l border-brand-200 bg-white px-2 text-right" />
                </form>
              ))}
            </div>
          )}
          <details>
            <summary className="min-h-10 cursor-pointer py-2 font-medium text-brand-700">เพิ่มโปรโมชั่นอื่น</summary>
            <form action={addPromoAction} className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <input type="hidden" name="id" value={id} />
              <input name="name" required maxLength={80} placeholder="ชื่อ เช่น ผ้าม่านทั้งหลัง" aria-label="ชื่อโปรโมชั่น" className="min-h-10 rounded-md border border-slate-300 px-3" />
              <select name="kind" aria-label="ประเภท" defaultValue="gift" className="min-h-10 rounded-md border border-slate-300 px-2">
                {P.PROMO_KINDS.map((k) => <option key={k} value={k}>{P.PROMO_KIND_LABEL[k]}</option>)}
              </select>
              <input name="value" required inputMode="decimal" placeholder="มูลค่า" aria-label="มูลค่า (บาท)" className="min-h-10 w-full rounded-md border border-slate-300 px-3 text-right sm:w-28" />
              <button className="min-h-10 rounded-md bg-brand-600 px-3 font-semibold text-white hover:bg-brand-700">เพิ่ม</button>
            </form>
          </details>
        </div>
      )}

      <dl className="flex flex-col gap-1 border-t border-slate-200 pt-3">
        {row("ลดจากราคาตั้ง", s.priceCut)}
        {row("ส่วนลดเงินสด", s.cash)}
        {row("ของแถม", s.gift)}
        {row("ฟรีค่าโอน/จดจำนอง", s.transfer)}
        <div className="flex justify-between gap-2 font-semibold"><dt>ส่วนลดรวม</dt><dd className="tabular-nums">{baht(s.totalDiscount)} <span className={s.pct > s.threshold ? "text-amber-700" : "text-slate-600"}>({s.pct.toFixed(1)}%)</span></dd></div>
        <div className="flex justify-between gap-2"><dt>รายรับสุทธิ (ราคาขาย − ส่วนลดเงินสด)</dt><dd className="font-semibold tabular-nums">{baht(s.netRevenue)}</dd></div>
      </dl>
      <p className="mt-1 text-xs text-slate-600">ของแถมและฟรีค่าโอนนับเป็นต้นทุนของหลังนี้ในหน้ากำไรให้เอง</p>

      {s.needsApproval && (
        <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="font-semibold text-amber-900">ส่วนลดเกินเกณฑ์ {s.threshold}% ต้องให้ผู้จัดการอนุมัติก่อนเลื่อนไปขั้นจอง</p>
          {s.approvedBy && <p className="text-xs text-amber-900">เคยอนุมัติไว้ {baht(Number(p.lead.discount_approved))} บาท แต่ส่วนลดเพิ่มขึ้นหลังจากนั้น</p>}
          {canApprove ? (
            <form action={approveAction} className="mt-2"><input type="hidden" name="id" value={id} />
              <button className="min-h-11 rounded-md bg-amber-600 px-4 font-semibold text-white hover:bg-amber-700">อนุมัติส่วนลด {baht(s.totalDiscount)} บาท</button></form>
          ) : <p className="mt-1 text-amber-900">แจ้งเจ้าของหรือผู้จัดการให้เปิดหน้านี้แล้วกดอนุมัติ</p>}
        </div>
      )}
      {s.approved && <p className="mt-3 text-xs text-emerald-800">อนุมัติส่วนลดแล้วโดย {actorName(s.approvedBy)} · {when(s.approvedAt)}</p>}
    </section>
  );
}
