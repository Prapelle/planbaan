/**
 * ต้นทุนและกำไรรายหลัง (ส่วนก่อสร้าง) — ข้อมูลลับ เห็นเฉพาะเจ้าของโครงการและบัญชี
 *
 * รายรับ = ราคาขายจริงในหน้าลูกค้า (ไม่มีใช้ราคาสัญญา แล้วราคาแปลง) − ส่วนลดเงินสด + งานเพิ่ม-ลดที่ลูกค้ายืนยัน
 * โปรโมชั่นของแถม/ฟรีค่าโอน นับเป็นต้นทุนหมวดของแถม/ค่าโอนให้เอง
 * ต้นทุน:
 *   - กรอกเอง: วัสดุ ค่าแรง ค่าโอนและภาษี ของแถมและส่วนลด ค่านายหน้า อื่น ๆ (งบจากแม่แบบตามแบบบ้าน)
 *   - ระบบคิดให้: ที่ดิน (ใส่รายแปลง หรือราคารวมหารตามตารางวา), ส่วนกลาง (หารเท่ากันทุกแปลง หรือหารตามตารางวา),
 *     การตลาด (ต้นทุนต่อการจองของช่องทางลูกค้า)
 *   - บริษัทรับสร้างบ้าน: ไม่มีหมวดที่ดินและส่วนกลาง (สร้างบนที่ดินลูกค้า)
 * ต้นทุนคาดการณ์ของหลังที่ยังสร้าง = max(จริง, งบ) ต่อหมวด · หลังที่ส่งมอบแล้วใช้ต้นทุนจริง
 * เตือนล่วงหน้า: วัสดุ/ค่าแรงใช้ไปเร็วกว่าความคืบหน้า (ตั้งแต่งาน 40%) บอกยอดที่อาจเกินถ้าใช้ในอัตรานี้
 */
import type { BatchOp, TenantDb } from "./tenant-db";
import { PIPELINE, bkkDate } from "./sales";

export const MANUAL_CATS = ["material", "labor", "transfer", "giveaway", "commission", "other"] as const;
export type ManualCat = (typeof MANUAL_CATS)[number];
export const AUTO_CATS = ["land", "shared", "marketing"] as const;
export type CostCat = ManualCat | (typeof AUTO_CATS)[number];
export const CAT_LABEL: Record<CostCat, string> = {
  land: "ที่ดินและถมดิน", material: "วัสดุ", labor: "ค่าแรงและผู้รับเหมา", transfer: "ค่าโอนและภาษี",
  giveaway: "ของแถมและส่วนลด", commission: "ค่านายหน้า", other: "อื่น ๆ", shared: "ส่วนกลาง", marketing: "การตลาด",
};
export const CAT_ORDER: CostCat[] = ["land", "material", "labor", "transfer", "giveaway", "commission", "shared", "marketing", "other"];
/** บริษัทรับสร้างบ้านสร้างบนที่ดินของลูกค้า: ไม่มีต้นทุนที่ดินและค่าส่วนกลางของโครงการ */
export const catsFor = (kind?: string): CostCat[] => (kind === "builder" ? CAT_ORDER.filter((c) => c !== "land" && c !== "shared") : CAT_ORDER);
/** หมวดที่ใช้เงินตามความคืบหน้างาน — ใช้เตือนล่วงหน้าว่าจะเกินงบ */
const PACED: CostCat[] = ["material", "labor"];
const BOOK = PIPELINE.indexOf("booked");
const DAY_OK = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const money = (v: unknown, allowZero = true) => {
  const n = Number(String(v ?? "").replace(/[,\s฿]/g, "") || 0);
  if (!Number.isFinite(n) || n < 0 || n > 1e10 || (!allowZero && n === 0)) throw new Error("จำนวนเงินไม่ถูกต้อง");
  return Math.round(n * 100) / 100;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
type Row = Record<string, unknown> & { id: string };

async function listAll(db: TenantDb, table: Parameters<TenantDb["list"]>[0], where: Record<string, string> = {}) {
  const out: Row[] = [];
  for (let off = 0; ; off += 2000) {
    const page = await db.list(table, { where, limit: 2000, offset: off });
    out.push(...page);
    if (page.length < 2000) return out;
  }
}

// ── บันทึกต้นทุน ──
export type NewCost = { buildIds: string[]; category: string; item: string; amount: string | number; date: string; stageId?: string };

/** บันทึกต้นทุน หลายหลังแบ่งเท่ากัน (เศษสตางค์ไปหลังแรก) */
export async function addCosts(db: TenantDb, c: NewCost, actor: string) {
  const ids = [...new Set(c.buildIds.filter(Boolean))];
  if (!ids.length) throw new Error("เลือกหลังอย่างน้อย 1 หลัง");
  if (ids.length > 200) throw new Error("เลือกได้ไม่เกิน 200 หลัง");
  if (!(MANUAL_CATS as readonly string[]).includes(c.category)) throw new Error("หมวดไม่ถูกต้อง");
  if (!DAY_OK.test(c.date)) throw new Error("วันที่ไม่ถูกต้อง");
  const item = txt(c.item, 200);
  if (!item) throw new Error("ใส่รายการ");
  const total = money(c.amount, false);
  const builds = await Promise.all(ids.map((id) => db.get("builds", id)));
  if (builds.some((b) => !b)) throw new Error("ไม่พบบางหลังที่เลือก");
  let stageId = "";
  if (c.stageId) {
    if (ids.length > 1) throw new Error("ระบุงวดได้เมื่อบันทึกหลังเดียว");
    const s = await db.get("build_stages", c.stageId);
    if (!s || s.build_id !== ids[0]) throw new Error("ไม่พบงวดงาน");
    stageId = c.stageId;
  }
  const each = Math.floor((total / ids.length) * 100) / 100;
  const first = r2(total - each * (ids.length - 1));
  const batch = ids.length > 1 ? crypto.randomUUID() : "";
  const label = ids.length > 1 ? `${item} (แบ่ง ${ids.length} หลัง)` : item;
  const ops: BatchOp[] = ids.map((id, i) => ({
    kind: "insert", table: "build_costs",
    data: { build_id: id, category: c.category, stage_id: stageId, item: label, amount: i === 0 ? first : each, cost_date: c.date, entered_by: actor, batch_id: batch },
  }));
  await db.batch(ops);
  return { count: ids.length, each, first };
}

/** ลบรายการ — ถ้าเป็นรายการที่แบ่งหลายหลัง ลบทั้งชุด */
export async function removeCost(db: TenantDb, id: string) {
  const c = await db.get("build_costs", id);
  if (!c) throw new Error("ไม่พบรายการ");
  const ids = c.batch_id ? (await listAll(db, "build_costs", { batch_id: String(c.batch_id) })).map((x) => x.id) : [id];
  await db.removeMany("build_costs", ids);
  return ids.length;
}

// ── ตั้งค่า ──
export async function setBudgetTemplate(db: TenantDb, houseTypeRaw: string, amounts: Record<string, string>) {
  const houseType = txt(houseTypeRaw, 60);
  const existing = await listAll(db, "cost_budgets", { house_type: houseType });
  const ops: BatchOp[] = [];
  for (const cat of MANUAL_CATS) {
    if (amounts[cat] === undefined) continue;
    const amount = money(amounts[cat]);
    const cur = existing.find((e) => e.category === cat);
    if (cur) { if (Number(cur.amount) !== amount) ops.push({ kind: "update", table: "cost_budgets", id: cur.id, patch: { amount } }); }
    else if (amount > 0) ops.push({ kind: "insert", table: "cost_budgets", data: { house_type: houseType, category: cat, amount } });
  }
  await db.batch(ops);
}

export type SettingKey = "shared_total" | "shared_mode" | "land_mode" | "land_total";
export async function setSetting(db: TenantDb, key: SettingKey, value: string) {
  let v: string;
  if (key === "shared_mode") { if (!["equal", "area"].includes(value)) throw new Error("วิธีหารไม่ถูกต้อง"); v = value; }
  else if (key === "land_mode") { if (!["plot", "area"].includes(value)) throw new Error("วิธีใส่ต้นทุนที่ดินไม่ถูกต้อง"); v = value; }
  else v = String(money(value));
  const [cur] = await db.list("cost_settings", { where: { key }, limit: 1 });
  if (cur) await db.update("cost_settings", cur.id, { value: v });
  else await db.insert("cost_settings", { key, value: v });
}

/** บันทึกเนื้อที่ (ตร.ว.) และ/หรือต้นทุนที่ดินรายแปลง ทีละหลายแปลง */
export async function setPlotLand(db: TenantDb, byCode: Record<string, { area?: string; land?: string }>) {
  const plots = await listAll(db, "plots");
  const ops: BatchOp[] = [];
  for (const p of plots) {
    const v = byCode[String(p.code)];
    if (!v) continue;
    const patch: Record<string, unknown> = {};
    if (v.area !== undefined) {
      const a = Math.round(Number(String(v.area).replace(/[,\s]/g, "") || 0) * 10) / 10;
      if (!(a >= 0 && a < 100000)) throw new Error(`เนื้อที่แปลง ${p.code} ไม่ถูกต้อง`);
      if (Number(p.area_sqw ?? 0) !== a) patch.area_sqw = a;
    }
    if (v.land !== undefined) { const l = money(v.land); if (Number(p.land_cost ?? 0) !== l) patch.land_cost = l; }
    if (Object.keys(patch).length) ops.push({ kind: "update", table: "plots", id: p.id, patch });
  }
  await db.batch(ops);
  return ops.length;
}

// ── รายงาน ──
/** promo = ส่วนของ actual ที่มาจากโปรโมชั่นในหน้าลูกค้า (ของแถม/ฟรีค่าโอน) */
export type CatLine = { cat: CostCat; budget: number; actual: number; projected: number; auto: boolean; paceWarn: number; promo: number };
export type ProfitRow = {
  build: Row; plotCode: string; revenue: number; salePrice: number; cashDiscount: number; leadId: string; budgetTotal: number; actualTotal: number; projectedTotal: number;
  profit: number; margin: number; progress: number; done: boolean; lines: CatLine[]; flags: string[];
};

export async function profitReport(db: TenantDb, opts: { kind?: string; now?: Date } = {}) {
  const [builds, stages, changes, costs, plots, budgets, settings, leads, spend, leadPromos] = await Promise.all([
    listAll(db, "builds"), listAll(db, "build_stages"), listAll(db, "build_changes"), listAll(db, "build_costs"),
    listAll(db, "plots"), listAll(db, "cost_budgets"), listAll(db, "cost_settings"), listAll(db, "leads"), listAll(db, "marketing_spend"),
    listAll(db, "lead_promos"),
  ]);
  const builder = opts.kind === "builder";
  const plotBy = new Map(plots.map((p) => [String(p.code), p]));
  const setting = (k: string) => String(settings.find((s) => s.key === k)?.value ?? "");
  const sharedTotal = Number(setting("shared_total") || 0);
  const landTotal = Number(setting("land_total") || 0);
  // หารตามตารางวาใช้ได้เฉพาะโครงการจัดสรร (รับสร้างบ้านไม่มีแปลง)
  const sharedMode = !builder && setting("shared_mode") === "area" ? "area" : "equal";
  const landMode = !builder && setting("land_mode") === "area" ? "area" : "plot";
  const totalArea = plots.reduce((a, p) => a + Number(p.area_sqw ?? 0), 0);
  const missingArea = plots.filter((p) => !(Number(p.area_sqw ?? 0) > 0)).length;
  const sharedDiv = Math.max(1, plots.length);
  const sharedEach = builder ? 0 : r2(sharedTotal / sharedDiv);
  const byArea = (total: number, p: Row | undefined) => (p && totalArea > 0 ? r2((total * Number(p.area_sqw ?? 0)) / totalArea) : 0);
  const sharedOf = (p: Row | undefined) => (sharedMode === "area" ? byArea(sharedTotal, p) : sharedEach);
  const landOf = (p: Row | undefined) => (landMode === "area" ? byArea(landTotal, p) : Number(p?.land_cost ?? 0));

  // ต้นทุนต่อการจองตามช่องทาง (ทั้งหมดที่มีข้อมูล)
  const cpb = new Map<string, number>();
  const spendBy = new Map<string, number>();
  for (const s of spend) spendBy.set(String(s.channel), (spendBy.get(String(s.channel)) ?? 0) + Number(s.amount));
  for (const [ch, total] of spendBy) {
    const booked = leads.filter((l) => l.channel === ch && Number(l.max_stage ?? 0) >= BOOK).length;
    if (booked > 0) cpb.set(ch, r2(total / booked));
  }
  const leadOf = (b: Row) => {
    if (b.lead_id) return leads.find((l) => l.id === b.lead_id);
    if (!b.plot_code) return undefined;
    return leads.filter((l) => l.plot_code === b.plot_code && l.stage !== "lost").sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0];
  };
  const tmpl = (houseType: string) => {
    const own = budgets.filter((x) => x.house_type === houseType);
    const use = own.length ? own : budgets.filter((x) => x.house_type === "");
    return new Map(use.map((x) => [String(x.category), Number(x.amount)]));
  };

  const rows: ProfitRow[] = builds.map((b) => {
    const st = stages.filter((s) => s.build_id === b.id);
    const done = b.status === "done";
    const progress = st.length ? st.filter((s) => s.done_at).length / st.length : 0;
    const plot = plotBy.get(String(b.plot_code ?? ""));
    const confirmed = changes.filter((c) => c.build_id === b.id && c.status === "confirmed").reduce((a, c) => a + Number(c.amount), 0);
    const lead = leadOf(b);
    // ราคา: ราคาขายจริงในหน้าลูกค้า > ราคาสัญญาในงานก่อสร้าง > ราคาตั้งของแปลง · ส่วนลดเงินสดหักออกจากรายรับ
    const promos = lead ? leadPromos.filter((x) => x.lead_id === lead.id) : [];
    const promoSum = (k: string) => r2(promos.filter((x) => x.kind === k).reduce((a, x) => a + Number(x.value), 0));
    const base = (lead && Number(lead.sale_price) > 0 ? Number(lead.sale_price) : 0) || Number(b.contract_price) || Number(plot?.price ?? 0);
    const revenue = r2(base - promoSum("cash") + confirmed);
    const budget = tmpl(String(plot?.house_type ?? ""));
    const mine = costs.filter((c) => c.build_id === b.id);
    const lines: CatLine[] = catsFor(opts.kind).map((cat) => {
      if (cat === "land") { const v = landOf(plot); return { cat, budget: v, actual: v, projected: v, auto: true, paceWarn: 0, promo: 0 }; }
      if (cat === "shared") { const v = sharedOf(plot); return { cat, budget: v, actual: v, projected: v, auto: true, paceWarn: 0, promo: 0 }; }
      if (cat === "marketing") { const v = lead ? cpb.get(String(lead.channel)) ?? 0 : 0; return { cat, budget: v, actual: v, projected: v, auto: true, paceWarn: 0, promo: 0 }; }
      const bud = budget.get(cat) ?? 0;
      const promo = cat === "giveaway" ? promoSum("gift") : cat === "transfer" ? promoSum("transfer") : 0;
      const act = r2(mine.filter((c) => c.category === cat).reduce((a, c) => a + Number(c.amount), 0) + promo);
      const projected = done ? act : Math.max(act, bud);
      let paceWarn = 0;
      // เตือนเมื่องานคืบหน้าอย่างน้อย 40% (ช่วงต้นงานซื้อของล่วงหน้าเยอะเป็นปกติ) — เป็นคำเตือน ไม่นำไปหักกำไรคาดการณ์
      if (!done && PACED.includes(cat) && bud > 0 && progress >= 0.4 && progress < 1 && act / bud > progress + 0.05) {
        const pace = r2(act / progress);
        if (pace > bud) paceWarn = r2(pace - bud);
      }
      return { cat, budget: bud, actual: act, projected: r2(projected), auto: false, paceWarn, promo };
    });
    const sum = (k: "budget" | "actual" | "projected") => r2(lines.reduce((a, l) => a + l[k], 0));
    const projectedTotal = sum("projected");
    const profit = r2(revenue - projectedTotal);
    const flags: string[] = [];
    for (const l of lines) {
      if (l.auto || l.budget <= 0) continue;
      if (l.actual > l.budget) flags.push(`${CAT_LABEL[l.cat]}เกินงบ ${Math.round(((l.actual - l.budget) / l.budget) * 100)}%`);
      else if (l.paceWarn > 0) flags.push(`${CAT_LABEL[l.cat]}ใช้เร็วกว่างาน`);
    }
    if (!budget.size) flags.push("ยังไม่ได้ตั้งงบ");
    if ((sharedMode === "area" || landMode === "area") && plot && !(Number(plot.area_sqw ?? 0) > 0)) flags.push("ยังไม่ใส่ตร.ว.");
    return {
      build: b, plotCode: String(b.plot_code ?? ""), revenue, salePrice: r2(base), cashDiscount: promoSum("cash"), leadId: lead ? String(lead.id) : "", budgetTotal: sum("budget"), actualTotal: sum("actual"), projectedTotal,
      profit, margin: revenue > 0 ? r2((profit / revenue) * 100) : 0, progress, done, lines, flags,
    };
  }).sort((a, b) => a.margin - b.margin);

  const totals = rows.reduce((t, r) => ({ revenue: t.revenue + r.revenue, cost: t.cost + r.projectedTotal, profit: t.profit + r.profit }), { revenue: 0, cost: 0, profit: 0 });
  return {
    rows,
    totals: { ...totals, margin: totals.revenue > 0 ? r2((totals.profit / totals.revenue) * 100) : 0, overBudget: rows.filter((r) => r.lines.some((l) => !l.auto && l.budget > 0 && (l.actual > l.budget || l.paceWarn > 0))).length },
    sharedTotal, sharedEach, sharedDiv, sharedMode, landMode, landTotal, totalArea, missingArea, sharedOf, landOf, budgets, plots, costs,
    houseTypes: [...new Set(plots.map((p) => String(p.house_type ?? "")).filter(Boolean))].sort(),
    today: bkkDate(opts.now),
  };
}
