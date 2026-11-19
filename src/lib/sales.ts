/**
 * กติกาการขาย (ระยะ 1): ผังแปลง ลูกค้า การเลื่อนขั้น และตัวเลขภาพรวม
 * ทุกฟังก์ชันรับ TenantDb ที่ผูกโครงการแล้ว จึงทำงานได้เฉพาะในโครงการนั้น
 */
import type { BatchOp, TenantDb } from "./tenant-db";
import { assertDiscountOk } from "./promotions";

// ── ค่ามาตรฐาน (ไม่ให้แต่ละโครงการปรับเอง) ──
export const STAGES = ["new", "contacted", "visit_scheduled", "visited", "booked", "loan", "transferred", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  new: "รอติดต่อ", contacted: "ติดต่อได้แล้ว", visit_scheduled: "นัดเข้าชม", visited: "เข้าชมแล้ว",
  booked: "จอง", loan: "ยื่นกู้", transferred: "โอนแล้ว", lost: "ไม่ซื้อ",
};
/** บริษัทรับสร้างบ้าน: ขั้นเดียวกันภายใน แต่ชื่อขั้นต่างกัน (ดูที่ดิน → เสนอแบบและราคา → เซ็นสัญญา → ก่อสร้าง → ส่งมอบ) */
export const BUILDER_STAGE_LABEL: Record<Stage, string> = {
  new: "รอติดต่อ", contacted: "ติดต่อได้แล้ว", visit_scheduled: "ดูที่ดิน", visited: "เสนอแบบและราคา",
  booked: "เซ็นสัญญา", loan: "ก่อสร้าง", transferred: "ส่งมอบ", lost: "ไม่สร้าง",
};
export const stageLabels = (kind?: string) => (kind === "builder" ? BUILDER_STAGE_LABEL : STAGE_LABEL);
export const PIPELINE: Stage[] = ["new", "contacted", "visit_scheduled", "visited", "booked", "loan", "transferred"];
const BOOKED_IDX = PIPELINE.indexOf("booked");
export const stageIdx = (s: string) => PIPELINE.indexOf(s as Stage); // lost = -1
export const isClosed = (s: string) => s === "transferred" || s === "lost";

export const CHANNELS = ["facebook", "tiktok", "google", "line", "walkin", "agent", "referral", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  facebook: "Facebook", tiktok: "TikTok", google: "Google", line: "LINE OA", walkin: "เดินเข้าโครงการ", agent: "นายหน้า", referral: "ลูกค้าแนะนำ", other: "อื่น ๆ",
};

export const SALE_STATUS = ["available", "booked", "loan", "transferred", "rent"] as const;
export type SaleStatus = (typeof SALE_STATUS)[number];
export const SALE_LABEL: Record<SaleStatus, string> = { available: "ว่าง", booked: "จอง", loan: "ยื่นกู้", transferred: "โอนแล้ว", rent: "ให้เช่า" };
export const HOUSE_STATUS = ["not_started", "building", "ready"] as const;
export type HouseStatus = (typeof HOUSE_STATUS)[number];
export const HOUSE_LABEL: Record<HouseStatus, string> = { not_started: "ยังไม่เริ่ม", building: "กำลังสร้าง", ready: "พร้อมโอน" };

export const STALE_DAYS = 3;

// ── ตัวช่วย ──
const one = <T extends string>(list: readonly T[], v: unknown, field: string): T => {
  const s = String(v ?? "").trim();
  if (!(list as readonly string[]).includes(s)) throw new Error(`${field} ไม่ถูกต้อง`);
  return s as T;
};
const cleanText = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const cleanPhone = (v: unknown) => String(v ?? "").replace(/[^\d+]/g, "").slice(0, 20);
const cleanDate = (v: unknown) => { const s = String(v ?? "").trim(); if (!s) return ""; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("วันที่ไม่ถูกต้อง"); return s; };
const cleanCode = (v: unknown) => String(v ?? "").trim().toUpperCase();
const CODE_OK = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

/** เรียงรหัสแปลงแบบธรรมชาติ A2 < A10 */
export const byCode = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.code).localeCompare(String(b.code), "en", { numeric: true });

// ── ผังแปลง ──
export async function createPlotsBulk(db: TenantDb, p: { zone: string; count: number; start?: number; houseType?: string; price?: number }) {
  const zone = cleanCode(p.zone);
  if (!/^[A-Z0-9]{1,4}$/.test(zone)) throw new Error("โซนใช้ตัวอักษรอังกฤษหรือตัวเลข 1–4 ตัว เช่น A");
  const count = Math.floor(Number(p.count));
  if (!(count >= 1 && count <= 300)) throw new Error("จำนวนแปลงต้องอยู่ระหว่าง 1–300");
  const start = Math.max(1, Math.floor(Number(p.start ?? 1)));
  const price = Math.max(0, Math.round(Number(p.price ?? 0)));
  const houseType = cleanText(p.houseType, 80);
  const existing = new Set((await db.list("plots", { limit: 2000 })).map((r) => String(r.code)));
  let skipped = 0;
  const width = Math.max(2, String(start + count - 1).length);
  const ops: BatchOp[] = [];
  for (let i = 0; i < count; i++) {
    const code = zone + String(start + i).padStart(width, "0");
    if (existing.has(code)) { skipped++; continue; }
    ops.push({ kind: "insert", table: "plots", data: { code, zone, house_type: houseType, price, house_status: "not_started", sale_status: "available" } });
  }
  await db.batch(ops); // เขียนทั้งโซนในรอบเดียว
  const created = ops.length;
  return { created, skipped };
}

export async function getPlotByCode(db: TenantDb, code: string) {
  return (await db.list("plots", { where: { code: cleanCode(code) }, limit: 1 }))[0] ?? null;
}

export async function updatePlot(db: TenantDb, code: string, patch: { houseType?: string; price?: number; houseStatus?: string; saleStatus?: string; areaSqw?: number }) {
  const plot = await getPlotByCode(db, code);
  if (!plot) throw new Error("ไม่พบแปลงนี้");
  const out: Record<string, unknown> = {};
  if (patch.houseType !== undefined) out.house_type = cleanText(patch.houseType, 80);
  if (patch.price !== undefined) { const n = Math.round(Number(patch.price)); if (!(n >= 0)) throw new Error("ราคาไม่ถูกต้อง"); out.price = n; }
  if (patch.houseStatus !== undefined) out.house_status = one(HOUSE_STATUS, patch.houseStatus, "สถานะบ้าน");
  if (patch.areaSqw !== undefined) { const a = Math.round(Number(patch.areaSqw) * 10) / 10; if (!(a >= 0 && a < 100000)) throw new Error("เนื้อที่ไม่ถูกต้อง"); out.area_sqw = a; }
  if (patch.saleStatus !== undefined) {
    // จอง/ยื่นกู้/โอน มาจากลูกค้าที่ผูกกับแปลงเท่านั้น ตั้งเองได้แค่ ว่าง หรือ ให้เช่า
    const s = one(SALE_STATUS, patch.saleStatus, "สถานะขาย");
    if (s !== "available" && s !== "rent") throw new Error("สถานะ จอง/ยื่นกู้/โอน เปลี่ยนจากหน้าลูกค้า");
    if (await activeBuyer(db, String(plot.code))) throw new Error("แปลงนี้มีลูกค้าจองอยู่ เปลี่ยนสถานะเองไม่ได้");
    out.sale_status = s;
  }
  await db.update("plots", String(plot.id), out);
}

export async function deletePlot(db: TenantDb, code: string) {
  const plot = await getPlotByCode(db, code);
  if (!plot) throw new Error("ไม่พบแปลงนี้");
  if ((await db.count("leads", { plot_code: String(plot.code) })) > 0) throw new Error("แปลงนี้มีลูกค้าผูกอยู่ ลบไม่ได้");
  await db.remove("plots", String(plot.id));
}

/** ลูกค้าที่ถือแปลงนี้อยู่ (ขั้นจองขึ้นไป) */
async function activeBuyer(db: TenantDb, code: string, exceptLeadId?: string) {
  const leads = await db.list("leads", { where: { plot_code: code }, limit: 2000 });
  return leads.find((l) => l.id !== exceptLeadId && stageIdx(String(l.stage)) >= BOOKED_IDX) ?? null;
}

/** คำนวณสถานะขายของแปลงใหม่จากลูกค้าที่ผูกอยู่ */
export async function recomputePlot(db: TenantDb, code: string) {
  if (!code) return;
  const plot = await getPlotByCode(db, code);
  if (!plot) return;
  const buyer = await activeBuyer(db, code);
  const cur = String(plot.sale_status);
  let next = cur;
  if (buyer) next = String(buyer.stage);
  else if (cur === "booked" || cur === "loan" || cur === "transferred") next = "available";
  if (next !== cur) await db.update("plots", String(plot.id), { sale_status: next });
}

// ── ลูกค้า ──
export type LeadInput = { name?: string; phone?: string; channel?: string; plotCode?: string; ownerEmail?: string; nextFollowAt?: string; note?: string; stage?: string };

const SOLD = new Set(["booked", "loan", "transferred"]);
type PlotState = { plot: Record<string, unknown> | null; buyer: Record<string, unknown> | null };

/** แปลง + ลูกค้าที่ถือแปลงอยู่ (ยกเว้นรายที่กำลังแก้) อ่านพร้อมกันในรอบเดียว */
async function plotState(db: TenantDb, code: string, exceptLeadId?: string): Promise<PlotState> {
  if (!code) return { plot: null, buyer: null };
  const [plots, leads] = await Promise.all([
    db.list("plots", { where: { code }, limit: 1 }),
    db.list("leads", { where: { plot_code: code }, limit: 2000 }),
  ]);
  const buyer = leads.find((l) => l.id !== exceptLeadId && stageIdx(String(l.stage)) >= BOOKED_IDX) ?? null;
  return { plot: plots[0] ?? null, buyer };
}

/** สถานะขายของแปลงหลังเปลี่ยน: ลูกค้ารายนี้อยู่ขั้นไหน + มีผู้ถือแปลงรายอื่นหรือไม่ */
function plotUpdate(st: PlotState, myStage: string | null): BatchOp | null {
  if (!st.plot) return null;
  const cur = String(st.plot.sale_status);
  let next = cur;
  if (myStage && stageIdx(myStage) >= BOOKED_IDX) next = myStage;
  else if (st.buyer) next = String(st.buyer.stage);
  else if (SOLD.has(cur)) next = "available";
  return next === cur ? null : { kind: "update", table: "plots", id: String(st.plot.id), patch: { sale_status: next } };
}

function checkPlotState(code: string, st: PlotState, stage: string) {
  if (!code) return;
  if (!st.plot) throw new Error(`ไม่พบแปลง ${code}`);
  if (stageIdx(stage) >= BOOKED_IDX && st.buyer) throw new Error(`แปลง ${code} มีลูกค้าจองแล้ว`);
}

const activityOp = (leadId: string, kind: string, actor: string, extra: { from?: string; to?: string; note?: string } = {}): BatchOp => ({
  kind: "insert", table: "lead_activity", data: { lead_id: leadId, kind, from_stage: extra.from ?? "", to_stage: extra.to ?? "", note: cleanText(extra.note, 1000), actor },
});
const keep = (ops: (BatchOp | null)[]) => ops.filter((o): o is BatchOp => o !== null);

// แต่ละคำสั่งด้านล่างคุยกับฐานข้อมูลไม่เกิน 3 รอบ: อ่านลูกค้า → อ่านแปลง (พร้อมกัน) → เขียนทั้งหมดในรอบเดียว

export async function createLead(db: TenantDb, input: LeadInput, actor: string) {
  const name = cleanText(input.name, 120);
  if (!name) throw new Error("ต้องมีชื่อลูกค้า");
  const channel = one(CHANNELS, input.channel || "other", "ช่องทาง");
  const stage = one(STAGES, input.stage || "new", "ขั้น");
  const plot = input.plotCode ? cleanCode(input.plotCode) : "";
  if (plot && !CODE_OK.test(plot)) throw new Error("รหัสแปลงไม่ถูกต้อง");
  const st = await plotState(db, plot);
  checkPlotState(plot, st, stage);
  const id = crypto.randomUUID();
  const [row] = await db.batch(keep([
    { kind: "insert", table: "leads", id, data: {
      name, phone: cleanPhone(input.phone), channel, stage, plot_code: plot, owner_email: cleanText(input.ownerEmail || actor, 200).toLowerCase(),
      last_contact_at: new Date().toISOString(), note: cleanText(input.note, 1000), next_follow_at: cleanDate(input.nextFollowAt),
      max_stage: Math.max(0, stageIdx(stage)),
    } },
    activityOp(id, "created", actor, { to: stage }),
    plotUpdate(st, stage),
  ]));
  return row;
}

export async function updateLead(db: TenantDb, id: string, input: LeadInput, actor: string) {
  const lead = await db.get("leads", id);
  if (!lead) throw new Error("ไม่พบลูกค้ารายนี้");
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) { const n = cleanText(input.name, 120); if (!n) throw new Error("ต้องมีชื่อลูกค้า"); patch.name = n; }
  if (input.phone !== undefined) patch.phone = cleanPhone(input.phone);
  if (input.channel !== undefined) patch.channel = one(CHANNELS, input.channel, "ช่องทาง");
  if (input.ownerEmail !== undefined) patch.owner_email = cleanText(input.ownerEmail, 200).toLowerCase();
  if (input.nextFollowAt !== undefined) patch.next_follow_at = cleanDate(input.nextFollowAt);
  if (input.note !== undefined) patch.note = cleanText(input.note, 1000);
  const oldPlot = String(lead.plot_code);
  const stage = String(lead.stage);
  const ops: (BatchOp | null)[] = [];
  if (input.plotCode !== undefined) {
    const plot = input.plotCode ? cleanCode(input.plotCode) : "";
    if (plot && !CODE_OK.test(plot)) throw new Error("รหัสแปลงไม่ถูกต้อง");
    if (plot !== oldPlot) {
      const [oldSt, newSt] = await Promise.all([plotState(db, oldPlot, id), plotState(db, plot, id)]);
      checkPlotState(plot, newSt, stage);
      patch.plot_code = plot;
      ops.push(plotUpdate(oldSt, null), plotUpdate(newSt, stage));
    }
  }
  if (!Object.keys(patch).length) return;
  await db.batch(keep([{ kind: "update", table: "leads", id, patch }, activityOp(id, "edit", actor), ...ops]));
}

export async function moveLead(db: TenantDb, id: string, stageRaw: string, actor: string, opts: { requirePlot?: boolean } = {}) {
  const lead = await db.get("leads", id);
  if (!lead) throw new Error("ไม่พบลูกค้ารายนี้");
  const stage = one(STAGES, stageRaw, "ขั้น");
  const from = String(lead.stage);
  if (stage === from) return;
  const plot = String(lead.plot_code);
  if (opts.requirePlot !== false && stageIdx(stage) >= BOOKED_IDX && !plot) throw new Error("เลือกแปลงให้ลูกค้าก่อนเลื่อนไปขั้นจอง");
  // เข้าขั้นจองครั้งแรก: ส่วนลดเกินเกณฑ์ต้องได้รับอนุมัติก่อน (อ่านพร้อมสถานะแปลงในรอบเดียว)
  const crossing = !!plot && stageIdx(stage) >= BOOKED_IDX && stageIdx(from) < BOOKED_IDX;
  const [st] = await Promise.all([plotState(db, plot, id), crossing ? assertDiscountOk(db, lead) : Promise.resolve()]);
  checkPlotState(plot, st, stage);
  await db.batch(keep([
    { kind: "update", table: "leads", id, patch: { stage, last_contact_at: new Date().toISOString(), max_stage: Math.max(Number(lead.max_stage ?? 0), stageIdx(stage)) } },
    activityOp(id, "stage", actor, { from, to: stage }),
    plotUpdate(st, stage),
  ]));
}

/** เลื่อนไปขั้นถัดไป/ก่อนหน้าในเส้นทางขาย */
export function neighborStage(stage: string, dir: 1 | -1): Stage | null {
  const i = stageIdx(stage);
  if (i < 0) return dir === 1 ? null : "new";
  const j = i + dir;
  return j >= 0 && j < PIPELINE.length ? PIPELINE[j] : null;
}

export async function logContact(db: TenantDb, id: string, note: string, actor: string, nextFollowAt?: string) {
  const n = cleanText(note, 1000);
  if (!n) throw new Error("ใส่บันทึกการติดต่อ");
  const lead = await db.get("leads", id);
  if (!lead) throw new Error("ไม่พบลูกค้ารายนี้");
  const patch: Record<string, unknown> = { last_contact_at: new Date().toISOString() };
  if (nextFollowAt !== undefined) patch.next_follow_at = cleanDate(nextFollowAt);
  await db.batch([{ kind: "update", table: "leads", id, patch }, activityOp(id, "contact", actor, { note: n })]);
}

export async function leadHistory(db: TenantDb, id: string) {
  return db.list("lead_activity", { where: { lead_id: id }, orderBy: "created_at", desc: true, limit: 200 });
}

export function daysSince(iso: string, now = new Date()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((now.getTime() - t) / 86400_000);
}
export const isStale = (lead: Record<string, unknown>, now = new Date()) =>
  !isClosed(String(lead.stage)) && daysSince(String(lead.last_contact_at), now) > STALE_DAYS;

/** วันที่แบบไทย (เขตเวลา Asia/Bangkok) YYYY-MM-DD */
export const bkkDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

// ── ภาพรวม ──
export async function overview(db: TenantDb, now = new Date()) {
  const [leads, plots] = await Promise.all([db.list("leads", { limit: 2000 }), db.list("plots", { limit: 2000 })]);
  const month = bkkDate(now).slice(0, 7);
  const today = bkkDate(now);
  const inMonth = (iso: unknown) => bkkDate(new Date(String(iso))).slice(0, 7) === month;
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const l of leads) byStage[l.stage as Stage] = (byStage[l.stage as Stage] ?? 0) + 1;
  const reached = (s: Stage) => leads.filter((l) => stageIdx(String(l.stage)) >= stageIdx(s)).length;
  const byChannel = CHANNELS.map((c) => {
    const mine = leads.filter((l) => l.channel === c);
    return { channel: c, leads: mine.length, visited: mine.filter((l) => stageIdx(String(l.stage)) >= stageIdx("visited")).length, booked: mine.filter((l) => stageIdx(String(l.stage)) >= BOOKED_IDX).length };
  }).filter((r) => r.leads > 0);
  const plotStatus = Object.fromEntries(SALE_STATUS.map((s) => [s, plots.filter((p) => p.sale_status === s).length])) as Record<SaleStatus, number>;
  return {
    totalLeads: leads.length,
    newThisMonth: leads.filter((l) => inMonth(l.created_at)).length,
    reachedVisit: reached("visited"),
    reachedBooked: reached("booked"),
    transferred: byStage.transferred,
    byStage, byChannel, plotStatus, totalPlots: plots.length,
    stale: leads.filter((l) => isStale(l, now)).sort((a, b) => String(a.last_contact_at).localeCompare(String(b.last_contact_at))),
    followToday: leads.filter((l) => !isClosed(String(l.stage)) && l.next_follow_at && String(l.next_follow_at) <= today)
      .sort((a, b) => String(a.next_follow_at).localeCompare(String(b.next_follow_at))),
  };
}
