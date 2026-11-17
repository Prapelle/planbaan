import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell, SALE_COLOR } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { back, baht, errMsg, fv } from "@/lib/form";
import { canManagePlots } from "@/lib/roles";
import * as S from "@/lib/sales";
import { PlanMap } from "@/components/PlanMap";
import { controlDb } from "@/lib/d1";
import { setPlanImage } from "@/lib/control";
import { MAX_PLAN_BYTES, placePlot, planKey, sniffImage, unplacePlot } from "@/lib/planmap";

export const dynamic = "force-dynamic";

async function guardEdit() {
  const ctx = await requireProject({ action: "edit", target: "/plots" });
  if (!(canManagePlots(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly)) back("/plots", { error: "ไม่มีสิทธิ์ตั้งค่าผังแปลง" });
  return ctx;
}

async function bulkAction(f: FormData) {
  "use server";
  const ctx = await guardEdit();
  let r;
  try {
    r = await S.createPlotsBulk(ctx.db, { zone: fv(f, "zone"), count: Number(fv(f, "count")), start: Number(fv(f, "start") || 1), houseType: fv(f, "house_type"), price: Number(fv(f, "price") || 0) });
    await ctx.usage("plot_created", { n: r.created });
  } catch (e) { back("/plots", { error: errMsg(e) }); }
  revalidatePath("/plots");
  back("/plots", { msg: `เพิ่ม ${r.created} แปลง${r.skipped ? ` (ข้าม ${r.skipped} แปลงที่มีอยู่แล้ว)` : ""}` });
}

async function updateAction(f: FormData) {
  "use server";
  const ctx = await guardEdit();
  const code = fv(f, "code");
  try {
    await S.updatePlot(ctx.db, code, { houseType: fv(f, "house_type"), price: Number(fv(f, "price") || 0), houseStatus: fv(f, "house_status"), ...(f.has("sale_status") ? { saleStatus: fv(f, "sale_status") } : {}) });
    await ctx.usage("plot_updated");
  } catch (e) { back("/plots", { error: errMsg(e), extra: { plot: code } }); }
  revalidatePath("/plots");
  back("/plots", { msg: `บันทึกแปลง ${code} แล้ว`, extra: { plot: code } });
}

async function deleteAction(f: FormData) {
  "use server";
  const ctx = await guardEdit();
  const code = fv(f, "code");
  try { await S.deletePlot(ctx.db, code); } catch (e) { back("/plots", { error: errMsg(e), extra: { plot: code } }); }
  revalidatePath("/plots");
  back("/plots", { msg: `ลบแปลง ${code} แล้ว` });
}

const MAP = "/plots?view=map";

async function uploadPlanAction(f: FormData) {
  "use server";
  const ctx = await guardEdit();
  const file = f.get("file");
  const bucket = ctx.env.BACKUPS;
  if (!bucket) back(MAP, { error: "ยังไม่ได้เชื่อมที่เก็บไฟล์ (R2)" });
  if (!(file instanceof File) || file.size === 0) back(MAP, { error: "เลือกรูปผังก่อน" });
  if (file.size > MAX_PLAN_BYTES) back(MAP, { error: "รูปใหญ่เกิน 5MB ย่อรูปหรือบันทึกเป็น JPG ก่อน" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) back(MAP, { error: "รองรับเฉพาะรูป PNG JPG หรือ WEBP (ถ้าเป็น PDF ให้แคปหน้าจอเป็นรูปก่อน)" });
  const key = planKey(ctx.project.id, kind.ext);
  await bucket.put(key, bytes, { httpMetadata: { contentType: kind.mime } });
  const old = ctx.project.plan_image;
  await setPlanImage(controlDb(ctx.env), ctx.project.id, key);
  if (old) await bucket.delete(old).catch(() => {});
  revalidatePath("/plots");
  back(MAP, { msg: "อัปโหลดรูปผังแล้ว กด \"วางจุดแปลงบนรูป\" แล้วแตะตำแหน่งของแต่ละแปลง" });
}

async function removePlanAction() {
  "use server";
  const ctx = await guardEdit();
  const old = ctx.project.plan_image;
  await setPlanImage(controlDb(ctx.env), ctx.project.id, "");
  if (old) await ctx.env.BACKUPS?.delete(old).catch(() => {});
  revalidatePath("/plots");
  back("/plots", { msg: "ลบรูปผังแล้ว ตำแหน่งแปลงยังเก็บไว้ ถ้าอัปโหลดรูปเดิมใหม่จะกลับมาที่เดิม" });
}

async function placeAction(f: FormData) {
  "use server";
  const ctx = await guardEdit();
  const code = fv(f, "code");
  try { await placePlot(ctx.db, code, fv(f, "x"), fv(f, "y")); } catch (e) { back(MAP, { error: errMsg(e) }); }
  revalidatePath("/plots");
  back(MAP, { msg: `วางแปลง ${code.toUpperCase()} แล้ว` });
}

async function unplaceAction(f: FormData) {
  "use server";
  const ctx = await guardEdit();
  const code = fv(f, "code");
  try { await unplacePlot(ctx.db, code); } catch (e) { back(MAP, { error: errMsg(e) }); }
  revalidatePath("/plots");
  back(MAP, { msg: `เอาแปลง ${code.toUpperCase()} ออกจากรูปแล้ว`, extra: { plot: code } });
}

export default async function PlotsPage({ searchParams }: { searchParams: Promise<{ plot?: string; view?: string; error?: string; msg?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/plots" });
  await ctx.usage("page_view", { page: "plots" });
  const { plot: selCode, view, error, msg } = await searchParams;
  const hasImage = !!ctx.project.plan_image;
  const mapView = view === "map";
  const base = mapView ? MAP : "/plots";
  const canEdit = (canManagePlots(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly);
  const [plots, leads] = await Promise.all([ctx.db.list("plots", { limit: 2000 }), ctx.db.list("leads", { limit: 2000 })]);
  plots.sort(S.byCode);
  const zones = [...new Set(plots.map((p) => String(p.zone)))];
  const sel = plots.find((p) => p.code === (selCode ?? "").toUpperCase()) ?? null;
  const selLeads = sel ? leads.filter((l) => l.plot_code === sel.code) : [];
  const buyer = selLeads.find((l) => S.stageIdx(String(l.stage)) >= S.stageIdx("booked"));

  return (
    <ProjectShell ctx={ctx} active="/plots">
      <h1 className="mb-1 text-2xl font-bold">ผังแปลง</h1>
      <p className="mb-4 text-sm text-slate-600">สีบอกสถานะขาย ซึ่งเปลี่ยนเองตามขั้นของลูกค้าที่ผูกกับแปลง กดที่แปลงเพื่อดูรายละเอียด</p>
      <Notice error={error} msg={msg} />

      <div role="tablist" aria-label="รูปแบบผัง" className="mb-3 flex gap-2 text-sm">
        <Link role="tab" aria-selected={!mapView} href="/plots" className={`flex min-h-11 items-center rounded-md px-4 font-semibold ${!mapView ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>แบบตาราง</Link>
        <Link role="tab" aria-selected={mapView} href={MAP} className={`flex min-h-11 items-center rounded-md px-4 font-semibold ${mapView ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>แบบรูปผัง</Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {S.SALE_STATUS.map((s) => (
          <span key={s} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1">
            <span aria-hidden className={`h-3 w-3 rounded-sm border ${SALE_COLOR[s]}`} />{S.SALE_LABEL[s]}
            <b>{plots.filter((p) => p.sale_status === s).length}</b>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-[2] rounded-lg border border-slate-200 bg-white p-4">
          {plots.length === 0 && <p className="text-slate-600">ยังไม่มีแปลง {canEdit ? "เพิ่มแปลงจากกล่องด้านล่าง" : "ให้เจ้าของโครงการหรือผู้จัดการเพิ่มแปลง"}</p>}
          {mapView && hasImage && (
            <PlanMap src="/api/plan-image" imgVersion={String(ctx.project.plan_image).slice(-12)} canEdit={canEdit} placeAction={canEdit ? placeAction : undefined} selected={sel ? String(sel.code) : undefined}
              colors={SALE_COLOR} plots={plots.map((p) => ({ code: String(p.code), x: p.map_x === null || p.map_x === undefined ? null : Number(p.map_x), y: p.map_y === null || p.map_y === undefined ? null : Number(p.map_y), status: String(p.sale_status), label: S.SALE_LABEL[p.sale_status as S.SaleStatus] }))} />
          )}
          {mapView && !hasImage && (
            <p className="text-slate-700">ยังไม่มีรูปผัง {canEdit ? "อัปโหลดรูปผังจากกล่องด้านล่าง" : "ให้เจ้าของโครงการหรือผู้จัดการอัปโหลดรูปผัง"} · ระหว่างนี้ใช้แบบตารางได้ตามปกติ</p>
          )}
          {!mapView && zones.map((z) => (
            <section key={z} className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-600">โซน {z}</h2>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8">
                {plots.filter((p) => p.zone === z).map((p) => (
                  <Link key={p.id} href={`${base}${base.includes("?") ? "&" : "?"}plot=${p.code}`} aria-label={`แปลง ${p.code} ${S.SALE_LABEL[p.sale_status as S.SaleStatus]}`}
                    className={`flex min-h-14 flex-col items-center justify-center rounded-md border text-sm font-semibold ${SALE_COLOR[String(p.sale_status)]} ${sel?.id === p.id ? "ring-4 ring-brand-500 ring-offset-1" : ""}`}>
                    {String(p.code)}
                    <span className="text-[11px] font-medium">{S.SALE_LABEL[p.sale_status as S.SaleStatus]}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        {sel && (
          <aside className="flex-1 rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-xl font-bold">แปลง {String(sel.code)}</h2>
              <Link href={base} className="text-sm text-brand-700 underline">ปิด</Link>
            </div>
            <dl className="mb-4 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-slate-600">แบบบ้าน</dt><dd className="font-medium">{String(sel.house_type) || "-"}</dd>
              <dt className="text-slate-600">ราคา</dt><dd className="font-medium">{baht(sel.price)} บาท</dd>
              <dt className="text-slate-600">สถานะขาย</dt><dd className="font-medium">{S.SALE_LABEL[sel.sale_status as S.SaleStatus]}</dd>
              <dt className="text-slate-600">สถานะบ้าน</dt><dd className="font-medium">{S.HOUSE_LABEL[sel.house_status as S.HouseStatus]}</dd>
            </dl>
            <h3 className="mb-1 text-sm font-semibold text-slate-600">ลูกค้าที่ผูกกับแปลงนี้</h3>
            {selLeads.length === 0 ? <p className="mb-4 text-sm">ยังไม่มี</p> : (
              <ul className="mb-4 flex flex-col gap-1 text-sm">
                {selLeads.map((l) => <li key={l.id}><Link href={`/leads/${l.id}`} className="text-brand-700 underline">{String(l.name)}</Link> · {S.STAGE_LABEL[l.stage as S.Stage]}</li>)}
              </ul>
            )}
            {canEdit && (
              <>
                <form action={updateAction} className="flex flex-col gap-2 border-t border-slate-200 pt-3 text-sm">
                  <input type="hidden" name="code" value={String(sel.code)} />
                  <label className="flex flex-col gap-1">แบบบ้าน<input name="house_type" defaultValue={String(sel.house_type)} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                  <label className="flex flex-col gap-1">ราคา (บาท)<input name="price" type="number" min={0} step={1000} defaultValue={Number(sel.price)} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
                  <label className="flex flex-col gap-1">สถานะบ้าน
                    <select name="house_status" defaultValue={String(sel.house_status)} className="min-h-11 rounded-md border border-slate-300 px-3">
                      {S.HOUSE_STATUS.map((h) => <option key={h} value={h}>{S.HOUSE_LABEL[h]}</option>)}
                    </select>
                  </label>
                  {!buyer && (
                    <label className="flex flex-col gap-1">สถานะขาย (ตั้งเองได้เฉพาะ ว่าง / ให้เช่า)
                      <select name="sale_status" defaultValue={sel.sale_status === "rent" ? "rent" : "available"} className="min-h-11 rounded-md border border-slate-300 px-3">
                        <option value="available">ว่าง</option><option value="rent">ให้เช่า</option>
                      </select>
                    </label>
                  )}
                  <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white">บันทึก</button>
                </form>
                {mapView && hasImage && sel.map_x !== null && sel.map_x !== undefined && (
                  <form action={unplaceAction} className="mt-2">
                    <input type="hidden" name="code" value={String(sel.code)} />
                    <button className="min-h-11 w-full rounded-md border border-slate-400 px-4 text-sm font-medium">เอาจุดแปลงนี้ออกจากรูป</button>
                  </form>
                )}
                {selLeads.length === 0 && (
                  <form action={deleteAction} className="mt-2">
                    <input type="hidden" name="code" value={String(sel.code)} />
                    <button className="min-h-11 w-full rounded-md border border-red-300 px-4 text-sm font-medium text-red-700">ลบแปลงนี้</button>
                  </form>
                )}
              </>
            )}
          </aside>
        )}
      </div>

      {canEdit && mapView && (
        <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <form action={uploadPlanAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 font-semibold">{hasImage ? "เปลี่ยนรูปผัง" : "อัปโหลดรูปผัง"} (PNG JPG WEBP ไม่เกิน 5MB)
              <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="min-h-11 py-2 font-normal" />
            </label>
            <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white">อัปโหลด</button>
          </form>
          {hasImage && <form action={removePlanAction}><button className="min-h-11 rounded-md border border-red-300 px-4 font-medium text-red-700">ลบรูปผัง</button></form>}
          <p className="w-full text-xs text-slate-600">เปลี่ยนรูปใหม่ที่สัดส่วนเดิม จุดแปลงยังอยู่ที่เดิม ถ้าสัดส่วนเปลี่ยน ให้วางจุดใหม่</p>
        </div>
      )}

      {canEdit && !mapView && (
        <form action={bulkAction} className="mt-6 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-full font-semibold">เพิ่มแปลงทีละโซน</div>
          <label className="flex flex-col gap-1">โซน<input name="zone" required maxLength={4} placeholder="A" className="min-h-11 rounded-md border border-slate-300 px-3 uppercase" /></label>
          <label className="flex flex-col gap-1">จำนวนแปลง<input name="count" type="number" required min={1} max={300} defaultValue={12} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex flex-col gap-1">เริ่มที่เลข<input name="start" type="number" min={1} defaultValue={1} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex flex-col gap-1">แบบบ้าน<input name="house_type" placeholder="ชั้นเดียว 3 ห้องนอน" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <label className="flex flex-col gap-1">ราคา (บาท)<input name="price" type="number" min={0} step={1000} className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
          <button className="min-h-11 self-end rounded-md bg-brand-600 px-4 font-semibold text-white">เพิ่มแปลง</button>
          <p className="col-span-full text-xs text-slate-600">ตัวอย่าง: โซน A จำนวน 12 เริ่มที่ 1 → A01 ถึง A12 · รหัสที่มีอยู่แล้วจะถูกข้าม</p>
        </form>
      )}
    </ProjectShell>
  );
}
