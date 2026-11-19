/**
 * สิทธิ์ใช้งานของโครงการ (ส่วนฟรี)
 *
 * ใช้ได้เต็มถึง "วันหมดสิทธิ์" = วันที่ไกลที่สุดของ
 *   - วันสุดท้ายของช่วงทดลอง (trial_ends_at)
 *   - สิทธิ์จากยอดซื้อ Pure Product (pure_until): ยอดรวม 3 เดือนติดกันถึงขั้นต่ำ → ใช้ได้ถึงสิ้นเดือนถัดจากเดือนสุดท้ายของช่วงนั้น
 *   - วันที่ทีมงานขยายให้ (paid_until) เช่น จ่ายเงินเอง หรือกรณีพิเศษ
 *
 * สถานะ: ใช้ได้ → ใกล้หมด (เหลือไม่เกิน WARN_DAYS วัน เตือน) → ผ่อนผัน (เลยมาไม่เกิน GRACE_DAYS วัน ยังแก้ได้ เตือนแดง)
 *        → ดูอย่างเดียว (ดูและส่งออกข้อมูลได้ แก้ไม่ได้ ข้อมูลไม่หาย)
 * ไฟล์นี้แตะเฉพาะตารางระบบ (projects, pure_purchases)
 */
import { type D1Like, nowIso } from "./d1";

export const ENT = {
  trialDays: Number(process.env.TRIAL_DAYS ?? 60),
  pureMin: Number(process.env.PURE_MIN_BAHT ?? 30000),   // ยังรอเจ้าของตัดสินใจ: ค่าชั่วคราว
  windowMonths: 3,
  warnDays: 30, // แผน: แจ้งล่วงหน้า 30 วันก่อนหมดสิทธิ์
  graceDays: 14,
};

export type EntState = "active" | "expiring" | "grace" | "readonly";
export type Entitlement = {
  state: EntState; readonly: boolean; until: string; daysLeft: number; source: "trial" | "pure" | "paid" | "none";
  readonlyFrom: string; manual: boolean;
};

const bkkDay = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400_000);
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};
const endOfMonth = (m: string) => addDays(`${shiftMonth(m, 1)}-01`, -1);

type ProjectEntCols = { status?: string; trial_ends_at?: string; pure_until?: string; paid_until?: string };

export function entitlementOf(p: ProjectEntCols, now = new Date(), cfg = ENT): Entitlement {
  const today = bkkDay(now);
  const cands = [
    { d: p.trial_ends_at ?? "", source: "trial" as const },
    { d: p.pure_until ?? "", source: "pure" as const },
    { d: p.paid_until ?? "", source: "paid" as const },
  ].filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.d)).sort((a, b) => b.d.localeCompare(a.d));
  const best = cands[0];
  // โครงการเก่าที่ยังไม่มีข้อมูลสิทธิ์ ถือว่าใช้ได้ (ไม่ล็อกลูกค้าโดยไม่ตั้งใจ)
  if (!best) return { state: "active", readonly: p.status === "readonly", until: "", daysLeft: Infinity, source: "none", readonlyFrom: "", manual: p.status === "readonly" };
  const daysLeft = diffDays(best.d, today);
  const readonlyFrom = addDays(best.d, cfg.graceDays + 1);
  let state: EntState = daysLeft > cfg.warnDays ? "active" : daysLeft >= 0 ? "expiring" : -daysLeft <= cfg.graceDays ? "grace" : "readonly";
  const manual = p.status === "readonly";
  if (manual) state = "readonly";
  return { state, readonly: state === "readonly", until: best.d, daysLeft, source: best.source, readonlyFrom, manual };
}

/** วันหมดสิทธิ์จากยอดซื้อ: ช่วง 3 เดือนติดกันที่รวมถึงขั้นต่ำ → ใช้ได้ถึงสิ้นเดือนถัดไป */
export function pureUntil(purchases: { month: string; amount: number }[], cfg = ENT): string {
  const by = new Map(purchases.map((p) => [p.month, Number(p.amount)]));
  let best = "";
  for (const m of by.keys()) {
    let sum = 0;
    for (let i = 0; i < cfg.windowMonths; i++) sum += by.get(shiftMonth(m, -i)) ?? 0;
    if (sum >= cfg.pureMin) { const u = endOfMonth(shiftMonth(m, 1)); if (u > best) best = u; }
  }
  return best;
}

export const trialEnd = (now = new Date(), days = ENT.trialDays) => addDays(bkkDay(now), days);

export async function listPurchases(db: D1Like, projectId: string) {
  return (await db.prepare(`SELECT month, amount, recorded_by, updated_at FROM pure_purchases WHERE project_id = ? ORDER BY month DESC`).bind(projectId)
    .all<{ month: string; amount: number; recorded_by: string; updated_at: string }>()).results;
}

/** ทีมงานบันทึกยอดซื้อ Pure Product ของเดือน แล้วคำนวณสิทธิ์ใหม่ (ยอด 0 = ลบเดือนนั้น) */
export async function recordPurchase(db: D1Like, projectId: string, month: string, amountRaw: string | number, by: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("เดือนไม่ถูกต้อง");
  const amount = Number(String(amountRaw).replace(/[,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) throw new Error("ยอดซื้อไม่ถูกต้อง");
  if (amount === 0) await db.prepare(`DELETE FROM pure_purchases WHERE project_id = ? AND month = ?`).bind(projectId, month).run();
  else await db.prepare(`INSERT INTO pure_purchases (project_id, month, amount, recorded_by, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, month) DO UPDATE SET amount = excluded.amount, recorded_by = excluded.recorded_by, updated_at = excluded.updated_at`)
    .bind(projectId, month, amount, by, nowIso()).run();
  const until = pureUntil(await listPurchases(db, projectId));
  await db.prepare(`UPDATE projects SET pure_until = ? WHERE id = ?`).bind(until, projectId).run();
  return until;
}

export async function setAccess(db: D1Like, projectId: string, p: { paidUntil?: string; trialEndsAt?: string; status?: string }) {
  const day = (v: string | undefined) => { if (v === undefined) return undefined; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("วันที่ไม่ถูกต้อง"); return v; };
  const sets: string[] = [], args: unknown[] = [];
  const paid = day(p.paidUntil), trial = day(p.trialEndsAt);
  if (paid !== undefined) { sets.push("paid_until = ?"); args.push(paid); }
  if (trial !== undefined) { sets.push("trial_ends_at = ?"); args.push(trial); }
  if (p.status !== undefined) { if (!["active", "readonly"].includes(p.status)) throw new Error("สถานะไม่ถูกต้อง"); sets.push("status = ?"); args.push(p.status); }
  if (!sets.length) return;
  await db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).bind(...args, projectId).run();
}

export const SOURCE_LABEL = { trial: "ช่วงทดลอง", pure: "ยอดซื้อ Pure Product", paid: "ทีมงานขยายให้", none: "ยังไม่กำหนด" } as const;
export const STATE_LABEL: Record<EntState, string> = { active: "ใช้ได้", expiring: "ใกล้หมด", grace: "ผ่อนผัน", readonly: "ดูอย่างเดียว" };
