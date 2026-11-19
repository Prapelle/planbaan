/**
 * การตลาด: งบต่อช่องทาง ค่าโฆษณาจริง (กรอกเองหรือนำเข้า CSV) และต้นทุนต่อลูกค้า/เข้าชม/จอง
 *
 * วิธีนับ (cohort): ลูกค้าที่ "เข้ามาในเดือนนั้น" จากช่องทางนั้น แล้วดูว่าเคยไปถึงขั้นไหน (max_stage)
 * ต้นทุนต่อการจอง = ค่าโฆษณาเดือนนั้น ÷ ลูกค้าเดือนนั้นที่ไปถึงขั้นจอง (ตัวเลขเดือนล่าสุดจะดีขึ้นเมื่อเวลาผ่านไป)
 */
import type { TenantDb, BatchOp } from "./tenant-db";
import { CHANNELS, type Channel, PIPELINE, bkkDate } from "./sales";

export const AD_CHANNELS: Channel[] = ["facebook", "tiktok", "google", "line", "agent", "other"];
const VISIT = PIPELINE.indexOf("visited");
const BOOK = PIPELINE.indexOf("booked");
const TRANSFER = PIPELINE.indexOf("transferred");
const MONTH_OK = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_OK = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const thisMonth = (now = new Date()) => bkkDate(now).slice(0, 7);
export function checkMonth(m: string) {
  if (!MONTH_OK.test(m)) throw new Error("เดือนไม่ถูกต้อง");
  return m;
}
export function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}
function checkChannel(c: string): Channel {
  if (!(CHANNELS as readonly string[]).includes(c)) throw new Error("ช่องทางไม่ถูกต้อง");
  return c as Channel;
}
function money(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[,\s฿]|THB|USD|บาท/gi, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new Error("จำนวนเงินไม่ถูกต้อง");
  return Math.round(n * 100) / 100;
}
const campaignName = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 150);

async function listAll(db: TenantDb, table: "leads" | "marketing_spend", where: Record<string, string> = {}) {
  const out: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 2000) {
    const page = await db.list(table, { where, limit: 2000, offset: off });
    out.push(...page);
    if (page.length < 2000) return out;
  }
}

// ── งบ ──
export async function setBudget(db: TenantDb, monthRaw: string, entries: Record<string, string>) {
  const month = checkMonth(monthRaw);
  const existing = await db.list("marketing_budget", { where: { month }, limit: 100 });
  const ops: BatchOp[] = [];
  for (const [c, raw] of Object.entries(entries)) {
    const channel = checkChannel(c);
    const amount = raw.trim() === "" ? 0 : money(raw);
    const cur = existing.find((b) => b.channel === channel);
    if (cur) { if (Number(cur.amount) !== amount) ops.push({ kind: "update", table: "marketing_budget", id: cur.id, patch: { amount } }); }
    else if (amount > 0) ops.push({ kind: "insert", table: "marketing_budget", data: { month, channel, amount } });
  }
  await db.batch(ops);
  return ops.length;
}

// ── ค่าโฆษณา ──
export type SpendRow = { day: string; channel: Channel; campaign: string; amount: number };

/** บันทึกหลายแถว: คีย์เดียวกัน (ช่องทาง+วัน+แคมเปญ) แทนที่ค่าเดิม — นำเข้าไฟล์เดิมซ้ำได้ไม่นับซ้ำ */
export async function upsertSpend(db: TenantDb, rows: SpendRow[], source: string) {
  const merged = new Map<string, SpendRow>();
  for (const r of rows) {
    const k = `${r.channel}|${r.day}|${r.campaign}`;
    const prev = merged.get(k);
    merged.set(k, prev ? { ...prev, amount: Math.round((prev.amount + r.amount) * 100) / 100 } : r);
  }
  const months = [...new Set([...merged.values()].map((r) => r.day.slice(0, 7)))];
  const existing = (await Promise.all(months.map((m) => listAll(db, "marketing_spend", { month: m })))).flat();
  const byKey = new Map(existing.map((e) => [`${e.channel}|${e.day}|${e.campaign}`, e]));
  const ops: BatchOp[] = [];
  let added = 0, replaced = 0;
  for (const [k, r] of merged) {
    const cur = byKey.get(k);
    if (cur) { replaced++; ops.push({ kind: "update", table: "marketing_spend", id: String(cur.id), patch: { amount: r.amount, source } }); }
    else { added++; ops.push({ kind: "insert", table: "marketing_spend", data: { day: r.day, month: r.day.slice(0, 7), channel: r.channel, campaign: r.campaign, amount: r.amount, source } }); }
  }
  await db.batch(ops);
  return { added, replaced, months };
}

export async function addSpend(db: TenantDb, p: { day: string; channel: string; campaign?: string; amount: string }) {
  if (!DAY_OK.test(p.day)) throw new Error("วันที่ไม่ถูกต้อง");
  return upsertSpend(db, [{ day: p.day, channel: checkChannel(p.channel), campaign: campaignName(p.campaign), amount: money(p.amount) }], "manual");
}

export async function removeSpend(db: TenantDb, id: string) {
  if (!(await db.remove("marketing_spend", id))) throw new Error("ไม่พบรายการนี้");
}

/** ล้างค่าโฆษณาของช่องทางในเดือนหนึ่ง (ก่อนนำเข้าไฟล์ใหม่ทั้งเดือน) */
export async function clearSpend(db: TenantDb, monthRaw: string, channelRaw: string) {
  const month = checkMonth(monthRaw), channel = checkChannel(channelRaw);
  const rows = (await listAll(db, "marketing_spend", { month })).filter((r) => r.channel === channel);
  await db.removeMany("marketing_spend", rows.map((r) => String(r.id)));
  return rows.length;
}

// ── อ่านไฟล์ CSV จาก Facebook / Google / TikTok Ads ──
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const delim = (s.split("\n", 1)[0].match(/\t/g)?.length ?? 0) > (s.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
const DAY_COLS = ["day", "date", "วัน", "วันที่", "reporting starts", "การเริ่มต้นการรายงาน", "เริ่มการรายงาน", "stat time day", "by day"];
const COST_COLS = ["amount spent", "amount spent (thb)", "จำนวนเงินที่ใช้จ่ายไป", "จำนวนเงินที่ใช้จ่ายไป (thb)", "cost", "ค่าใช้จ่าย", "ต้นทุน", "spend", "total cost", "ยอดใช้จ่าย"];
const CAMP_COLS = ["campaign name", "ชื่อแคมเปญ", "campaign", "แคมเปญ"];
const findCol = (header: string[], names: string[]) => {
  const h = header.map(norm);
  for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
  for (const n of names) { const i = h.findIndex((x) => x.startsWith(n)); if (i >= 0) return i; }
  return -1;
};

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** รองรับ 2026-11-01, 01/11/2026, 1/11/2569 (พ.ศ.), Nov 1, 2026, Sat, Nov 1, 2026 */
export function parseDay(v: string, order: "dmy" | "mdy" = "dmy"): string | null {
  const s = v.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fix = (y: number) => (y > 2400 ? y - 543 : y);
  const out = (y: number, m: number, d: number) => {
    const iso = `${fix(y)}-${pad(m)}-${pad(d)}`;
    return DAY_OK.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
  };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return out(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return order === "mdy" ? out(+m[3], +m[1], +m[2]) : out(+m[3], +m[2], +m[1]); // ค่าเริ่มต้น วัน/เดือน/ปี แบบไทย
  m = s.match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/);
  if (m && MON[m[1].toLowerCase()]) return out(+m[3], MON[m[1].toLowerCase()], +m[2]);
  return null;
}

export type ParseResult = { rows: SpendRow[]; skipped: number; total: number; warnings: string[] };

export function parseAdsCsv(text: string, channelRaw: string): ParseResult {
  const channel = checkChannel(channelRaw);
  const all = parseCsv(text);
  const hi = all.slice(0, 15).findIndex((r) => findCol(r, DAY_COLS) >= 0 && findCol(r, COST_COLS) >= 0);
  if (hi < 0) throw new Error("ไม่พบคอลัมน์วันที่และค่าใช้จ่ายในไฟล์ ส่งออกรายงานแบบแยกรายวันจากระบบโฆษณา แล้วลองใหม่");
  const header = all[hi];
  const di = findCol(header, DAY_COLS), ci = findCol(header, COST_COLS), ki = findCol(header, CAMP_COLS);
  const warnings: string[] = [];
  if (norm(header[di]).includes("reporting starts") || norm(header[di]).includes("เริ่มต้นการรายงาน"))
    warnings.push("ไฟล์นี้ใช้วันเริ่มรายงาน ถ้าไม่ได้แยกรายวัน ค่าใช้จ่ายทั้งช่วงจะลงที่วันแรก");
  if (ki < 0) warnings.push("ไม่พบคอลัมน์ชื่อแคมเปญ รวมเป็นรายการเดียวต่อวัน");
  // วันที่แบบ ตัวเลข/ตัวเลข/ปี: ดูทั้งไฟล์ ถ้าเลขตัวที่สองเกิน 12 แปลว่าเป็น เดือน/วัน/ปี (ไฟล์ภาษาอังกฤษแบบอเมริกัน)
  const pairs = all.slice(hi + 1).map((r) => /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/.exec(String(r[di] ?? "").trim())).filter((x): x is RegExpExecArray => !!x);
  const order: "dmy" | "mdy" = pairs.some((x) => +x[2] > 12) && !pairs.some((x) => +x[1] > 12) ? "mdy" : "dmy";
  if (order === "mdy") warnings.push("ไฟล์นี้ใช้วันที่แบบ เดือน/วัน/ปี ระบบอ่านตามนั้นแล้ว");
  const rows: SpendRow[] = [];
  let skipped = 0;
  for (const r of all.slice(hi + 1)) {
    const day = parseDay(r[di] ?? "", order);
    const rawCost = String(r[ci] ?? "").trim();
    if (!day || rawCost === "" || rawCost === "--") { skipped++; continue; } // แถวรวม แถวว่าง
    let amount: number;
    try { amount = money(rawCost); } catch { skipped++; continue; }
    if (amount === 0) continue;
    rows.push({ day, channel, campaign: ki >= 0 ? campaignName(r[ki]) : "", amount });
  }
  if (rows.length > 5000) throw new Error("ไฟล์ใหญ่เกิน 5,000 แถว แบ่งนำเข้าทีละเดือน");
  const total = Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  return { rows, skipped, total, warnings };
}

// ── รายงาน ──
export type ChannelStat = { channel: Channel; budget: number; spend: number; leads: number; visits: number; bookings: number; transfers: number };
const per = (spend: number, n: number) => (n > 0 && spend > 0 ? Math.round(spend / n) : null);
export const cost = (s: { spend: number; leads: number; visits: number; bookings: number }) => ({
  perLead: per(s.spend, s.leads), perVisit: per(s.spend, s.visits), perBooking: per(s.spend, s.bookings),
});

function tally(leads: Record<string, unknown>[], spend: Record<string, unknown>[], budget: Record<string, unknown>[], month: string): ChannelStat[] {
  const mine = leads.filter((l) => bkkDate(new Date(String(l.created_at))).slice(0, 7) === month);
  return CHANNELS.map((channel) => {
    const ls = mine.filter((l) => l.channel === channel);
    const reach = (i: number) => ls.filter((l) => Number(l.max_stage ?? 0) >= i).length;
    const sum = (rows: Record<string, unknown>[]) => Math.round(rows.filter((r) => r.channel === channel).reduce((a, r) => a + Number(r.amount), 0) * 100) / 100;
    return { channel, budget: sum(budget), spend: sum(spend), leads: ls.length, visits: reach(VISIT), bookings: reach(BOOK), transfers: reach(TRANSFER) };
  }).filter((r) => r.budget || r.spend || r.leads);
}

export async function marketingReport(db: TenantDb, monthRaw: string, trendMonths = 6) {
  const month = checkMonth(monthRaw);
  const months = Array.from({ length: trendMonths }, (_, i) => shiftMonth(month, i - trendMonths + 1));
  const [leads, budget, ...spends] = await Promise.all([
    listAll(db, "leads"),
    db.list("marketing_budget", { where: { month }, limit: 100 }),
    ...months.map((m) => listAll(db, "marketing_spend", { month: m })),
  ]);
  const spend = spends[spends.length - 1];
  const channels = tally(leads, spend, budget, month);
  const total = channels.reduce((a, c) => ({
    budget: a.budget + c.budget, spend: a.spend + c.spend, leads: a.leads + c.leads, visits: a.visits + c.visits, bookings: a.bookings + c.bookings, transfers: a.transfers + c.transfers,
  }), { budget: 0, spend: 0, leads: 0, visits: 0, bookings: 0, transfers: 0 });
  const trend = months.map((m, i) => {
    const t = tally(leads, spends[i], [], m);
    const s = t.reduce((a, c) => ({ spend: a.spend + c.spend, leads: a.leads + c.leads, visits: a.visits + c.visits, bookings: a.bookings + c.bookings }), { spend: 0, leads: 0, visits: 0, bookings: 0 });
    return { month: m, ...s };
  });
  const byCampaign = new Map<string, { channel: string; campaign: string; amount: number; days: number }>();
  for (const r of spend) {
    const k = `${r.channel}|${r.campaign}`;
    const cur = byCampaign.get(k) ?? { channel: String(r.channel), campaign: String(r.campaign), amount: 0, days: 0 };
    cur.amount += Number(r.amount); cur.days++;
    byCampaign.set(k, cur);
  }
  // เหตุผลที่ไม่ซื้อ ของลูกค้าที่เข้ามาในช่วงกราฟ (6 เดือน) แยกช่องทาง
  const inWindow = new Set(months);
  const lost = leads.filter((l) => l.stage === "lost" && inWindow.has(bkkDate(new Date(String(l.created_at))).slice(0, 7)));
  const lostReasons = [...lost.reduce((m, l) => {
    const r = String(l.lost_reason || "none");
    const cur = m.get(r) ?? { reason: r, count: 0, byChannel: {} as Record<string, number> };
    cur.count++; cur.byChannel[String(l.channel)] = (cur.byChannel[String(l.channel)] ?? 0) + 1;
    return m.set(r, cur);
  }, new Map<string, { reason: string; count: number; byChannel: Record<string, number> }>()).values()].sort((a, b) => b.count - a.count);
  return {
    month, channels, total, trend, lostReasons, lostTotal: lost.length, windowFrom: months[0],
    campaigns: [...byCampaign.values()].sort((a, b) => b.amount - a.amount),
    recentSpend: [...spend].sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 50),
    budgetByChannel: Object.fromEntries(budget.map((b) => [String(b.channel), Number(b.amount)])),
  };
}
