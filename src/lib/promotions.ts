/**
 * ราคาขายจริงและโปรโมชั่น
 *
 * ส่วนลดรวม = (ราคาตั้ง − ราคาขายจริง) + ส่วนลดเงินสด + มูลค่าของแถม + ฟรีค่าโอน/จดจำนอง
 * เกินเกณฑ์ (approve_pct % ของราคาตั้ง ค่าเริ่มต้น 3%) ต้องให้เจ้าของ/ผู้จัดการอนุมัติก่อนเลื่อนลูกค้าไปขั้นจอง
 * อนุมัติแล้ว ถ้าลดเพิ่มเกินยอดที่อนุมัติ ต้องอนุมัติใหม่
 *
 * ผลต่อกำไร: รายรับ = ราคาขายจริง − ส่วนลดเงินสด · ของแถม → ต้นทุนหมวดของแถม · ฟรีค่าโอน → ต้นทุนหมวดค่าโอน
 * ไฟล์นี้ไม่ import sales.ts (sales.ts เรียกใช้ไฟล์นี้)
 */
import type { BatchOp, TenantDb } from "./tenant-db";

export const PROMO_KINDS = ["cash", "gift", "transfer"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];
export const PROMO_KIND_LABEL: Record<PromoKind, string> = { cash: "ส่วนลดเงินสด", gift: "ของแถม", transfer: "ฟรีค่าโอน/จดจำนอง" };
export const PROMO_KIND_NOTE: Record<PromoKind, string> = { cash: "หักออกจากรายรับ", gift: "เป็นต้นทุนหมวดของแถม", transfer: "เป็นต้นทุนหมวดค่าโอน" };
export const DEFAULT_APPROVE_PCT = 3;
const DEFAULT_PROMOS: { name: string; kind: PromoKind; default_value: number }[] = [
  { name: "ส่วนลดเงินสด", kind: "cash", default_value: 0 },
  { name: "ฟรีค่าโอน", kind: "transfer", default_value: 0 },
  { name: "ฟรีค่าจดจำนอง", kind: "transfer", default_value: 0 },
  { name: "แอร์ 2 เครื่อง", kind: "gift", default_value: 30000 },
];
const DAY_OK = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const r2 = (n: number) => Math.round(n * 100) / 100;
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const money = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[,\s฿]/g, "") || 0);
  if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new Error("จำนวนเงินไม่ถูกต้อง");
  return r2(n);
};
const kindOf = (k: string): PromoKind => { if (!(PROMO_KINDS as readonly string[]).includes(k)) throw new Error("ประเภทโปรโมชั่นไม่ถูกต้อง"); return k as PromoKind; };
type Row = Record<string, unknown> & { id: string };

// ── ค่าตั้ง ──
export async function getSetting(db: TenantDb, key: string) {
  return String((await db.list("project_settings", { where: { key }, limit: 1 }))[0]?.value ?? "");
}
async function putSetting(db: TenantDb, key: string, value: string) {
  const [cur] = await db.list("project_settings", { where: { key }, limit: 1 });
  if (cur) await db.update("project_settings", cur.id, { value });
  else await db.insert("project_settings", { key, value });
}
export async function approvePct(db: TenantDb) {
  const v = Number(await getSetting(db, "approve_pct"));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_APPROVE_PCT;
}
export async function setApprovePct(db: TenantDb, raw: string) {
  const v = Number(String(raw).replace(/[%\s]/g, ""));
  if (!(v > 0 && v <= 100)) throw new Error("เกณฑ์อนุมัติต้องอยู่ระหว่าง 0.1–100%");
  await putSetting(db, "approve_pct", String(r2(v)));
}

// ── ชุดโปรโมชั่น ──
/** ชุดโปรของโครงการ ครั้งแรกเติมชุดเริ่มต้นให้ (ลบหมดภายหลังก็ไม่เติมซ้ำ) */
export async function catalog(db: TenantDb) {
  let rows = await db.list("promotions", { limit: 500, orderBy: "created_at" });
  if (!rows.length && !(await getSetting(db, "promos_seeded"))) {
    // จองสิทธิ์เติมก่อน (คีย์ซ้ำไม่ได้) เปิดหน้าพร้อมกันสองคนจะเติมชุดเริ่มต้นแค่ครั้งเดียว
    let claimed = true;
    try { await db.insert("project_settings", { key: "promos_seeded", value: "1" }); } catch { claimed = false; }
    if (claimed) await db.batch(DEFAULT_PROMOS.map((p): BatchOp => ({ kind: "insert", table: "promotions", data: { ...p, valid_until: "", active: 1 } })));
    rows = await db.list("promotions", { limit: 500, orderBy: "created_at" });
  }
  return rows;
}
/** โปรที่ฝ่ายขายเลือกได้วันนี้ (เปิดอยู่และยังไม่หมดเขต) */
export const available = (rows: Row[], today: string) => rows.filter((p) => Number(p.active) === 1 && (!p.valid_until || String(p.valid_until) >= today));

export async function savePromo(db: TenantDb, p: { id?: string; name: string; kind: string; value: string; validUntil?: string; active?: boolean }) {
  const name = txt(p.name, 80);
  if (!name) throw new Error("ใส่ชื่อโปรโมชั่น");
  const valid = (p.validUntil ?? "").trim();
  if (valid && !DAY_OK.test(valid)) throw new Error("วันหมดเขตไม่ถูกต้อง");
  const data = { name, kind: kindOf(p.kind), default_value: money(p.value), valid_until: valid, active: p.active === false ? 0 : 1 };
  if (p.id) { if (!(await db.get("promotions", p.id))) throw new Error("ไม่พบโปรโมชั่น"); await db.update("promotions", p.id, data); return p.id; }
  return String((await db.insert("promotions", data)).id);
}
export async function removePromo(db: TenantDb, id: string) {
  if (!(await db.remove("promotions", id))) throw new Error("ไม่พบโปรโมชั่น");
}

// ── โปรของลูกค้า ──
export async function addLeadPromo(db: TenantDb, leadId: string, p: { promoId?: string; name?: string; kind?: string; value: string }, actor: string) {
  const lead = await db.get("leads", leadId);
  if (!lead) throw new Error("ไม่พบลูกค้ารายนี้");
  let name = txt(p.name, 80), kind = p.kind ?? "";
  if (p.promoId) {
    const promo = await db.get("promotions", p.promoId);
    if (!promo) throw new Error("ไม่พบโปรโมชั่น");
    name = name || String(promo.name); kind = String(promo.kind);
  }
  if (!name) throw new Error("ใส่ชื่อโปรโมชั่น");
  const value = money(p.value);
  if (value <= 0) throw new Error(`ใส่มูลค่าของ "${name}"`);
  return db.insert("lead_promos", { lead_id: leadId, promo_id: p.promoId ?? "", name, kind: kindOf(kind), value, created_by: actor });
}
export async function removeLeadPromo(db: TenantDb, id: string) {
  if (!(await db.remove("lead_promos", id))) throw new Error("ไม่พบรายการ");
}
export async function setSalePrice(db: TenantDb, leadId: string, raw: string) {
  await db.update("leads", leadId, { sale_price: raw.trim() === "" ? 0 : money(raw) });
}

// ── สรุปราคา ──
export type PriceSummary = {
  list: number; sale: number; priceCut: number; cash: number; gift: number; transfer: number;
  totalDiscount: number; pct: number; netRevenue: number; threshold: number;
  needsApproval: boolean; approved: boolean; approvedBy: string; approvedAt: string;
};
export function summarize(lead: Row, plotPrice: number, promos: Row[], threshold: number): PriceSummary {
  const list = r2(Number(plotPrice) || 0);
  const sale = Number(lead.sale_price) > 0 ? r2(Number(lead.sale_price)) : list;
  const sum = (k: PromoKind) => r2(promos.filter((p) => p.kind === k).reduce((a, p) => a + Number(p.value), 0));
  const cash = sum("cash"), gift = sum("gift"), transfer = sum("transfer");
  const priceCut = r2(Math.max(0, list - sale));
  const totalDiscount = r2(priceCut + cash + gift + transfer);
  const pct = list > 0 ? r2((totalDiscount / list) * 100) : 0;
  const over = list > 0 && pct > threshold;
  const approvedAmt = Number(lead.discount_approved ?? 0);
  const approved = over && !!lead.discount_approved_by && totalDiscount <= approvedAmt + 0.005;
  return {
    list, sale, priceCut, cash, gift, transfer, totalDiscount, pct, netRevenue: r2(sale - cash), threshold,
    needsApproval: over && !approved, approved, approvedBy: String(lead.discount_approved_by ?? ""), approvedAt: String(lead.discount_approved_at ?? ""),
  };
}

/** ราคาของลูกค้าที่โหลดมาแล้ว (คำสั่งอ่านทั้งหมดไปพร้อมกัน = หนึ่งรอบ) */
export async function priceFor(db: TenantDb, lead: Row) {
  const [plots, promos, threshold] = await Promise.all([
    lead.plot_code ? db.list("plots", { where: { code: String(lead.plot_code) }, limit: 1 }) : Promise.resolve([]),
    db.list("lead_promos", { where: { lead_id: lead.id }, limit: 100, orderBy: "created_at" }),
    approvePct(db),
  ]);
  return { lead, promos, summary: summarize(lead, Number(plots[0]?.price ?? 0), promos, threshold) };
}
export async function priceOf(db: TenantDb, leadId: string) {
  const lead = await db.get("leads", leadId);
  if (!lead) throw new Error("ไม่พบลูกค้ารายนี้");
  return priceFor(db, lead);
}

/** ผู้จัดการอนุมัติส่วนลดยอดปัจจุบัน */
export async function approveDiscount(db: TenantDb, leadId: string, actor: string) {
  const { summary } = await priceOf(db, leadId);
  await db.update("leads", leadId, { discount_approved: summary.totalDiscount, discount_approved_by: actor, discount_approved_at: new Date().toISOString() });
  return summary;
}

/** ใช้ก่อนเลื่อนเข้าขั้นจอง: ส่วนลดเกินเกณฑ์และยังไม่อนุมัติ → ห้าม */
export async function assertDiscountOk(db: TenantDb, lead: Row) {
  const { summary } = await priceFor(db, lead);
  if (summary.needsApproval) throw new Error(`ส่วนลดรวม ${summary.pct.toFixed(1)}% เกินเกณฑ์ ${summary.threshold}% ให้ผู้จัดการกดอนุมัติในหน้าลูกค้าก่อน`);
}

/** ใช้ไปกี่รายและมูลค่ารวมเท่าไร ต่อโปร (รวมโปรที่พิมพ์เองตามชื่อ) */
export async function usageStats(db: TenantDb) {
  const rows = await db.list("lead_promos", { limit: 2000 });
  const byPromo = new Map<string, { count: number; total: number }>();
  const custom = new Map<string, { kind: string; count: number; total: number }>();
  for (const r of rows) {
    if (r.promo_id) {
      const s = byPromo.get(String(r.promo_id)) ?? { count: 0, total: 0 };
      s.count++; s.total = r2(s.total + Number(r.value)); byPromo.set(String(r.promo_id), s);
    } else {
      const k = String(r.name);
      const s = custom.get(k) ?? { kind: String(r.kind), count: 0, total: 0 };
      s.count++; s.total = r2(s.total + Number(r.value)); custom.set(k, s);
    }
  }
  return { byPromo, custom: [...custom.entries()].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.count - a.count) };
}
