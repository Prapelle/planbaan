/**
 * สินเชื่อ (ระยะ 2): เช็กลิสต์เอกสาร การยื่นหลายธนาคาร และการแก้หนี้
 * - เก็บเฉพาะสถานะเอกสาร ไม่เก็บไฟล์
 * - ยื่นธนาคารแรก (ยื่นแล้วขึ้นไป) → ลูกค้าที่อยู่ขั้นจองเลื่อนเป็น "ยื่นกู้" อัตโนมัติ
 * - ไม่ผ่านทุกธนาคาร → เปิดส่วนแก้หนี้ และเริ่มนับวันถือแปลง (ไม่ปล่อยแปลงเอง ให้เจ้าของตัดสินใจ)
 * - อนุมัติแล้ว → ปุ่มย้ายลูกค้าไปขั้นโอนแล้ว (กดเอง)
 */
import type { BatchOp, TenantDb } from "./tenant-db";
import { daysSince, moveLead } from "./sales";

export const DOCS = ["id_card", "house_reg", "salary_slip", "statement", "salary_cert", "sale_contract"] as const;
export type DocKey = (typeof DOCS)[number];
export const DOC_LABEL: Record<DocKey, string> = {
  id_card: "บัตรประชาชน", house_reg: "ทะเบียนบ้าน", salary_slip: "สลิปเงินเดือน 3 เดือน",
  statement: "Statement 6 เดือน", salary_cert: "หนังสือรับรองเงินเดือน", sale_contract: "สัญญาจะซื้อจะขาย",
};

export const BANKS = ["ธอส.", "ออมสิน", "กรุงไทย", "กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงศรี", "ทีทีบี", "ธ.ก.ส.", "ยูโอบี", "ซีไอเอ็มบี", "แลนด์ แอนด์ เฮ้าส์", "อื่น ๆ"] as const;

export const LOAN_STATUS = ["preparing", "submitted", "more_docs", "appraisal", "approved", "rejected"] as const;
export type LoanStatus = (typeof LOAN_STATUS)[number];
export const LOAN_LABEL: Record<LoanStatus, string> = {
  preparing: "เตรียมเอกสาร", submitted: "ยื่นแล้ว", more_docs: "ธนาคารขอเอกสารเพิ่ม", appraisal: "ประเมินราคา", approved: "อนุมัติ", rejected: "ไม่ผ่าน",
};
const WAITING = new Set<string>(["submitted", "more_docs", "appraisal"]);
export const STALE_BANK_DAYS = 7;
/** วันถือแปลงระหว่างแก้หนี้ (ค่ามาตรฐาน — ยังรอเจ้าของตัดสินใจตัวเลขจริง) */
export const HOLD_DAYS = 60;

type Row = Record<string, unknown>;

export const docsOf = (lead: Row): DocKey[] => String(lead.loan_docs ?? "").split(",").filter((d): d is DocKey => (DOCS as readonly string[]).includes(d));

export function summarize(lead: Row, apps: Row[], now = new Date()) {
  const docs = docsOf(lead);
  const filed = apps.filter((a) => a.status !== "preparing");
  const approved = apps.filter((a) => a.status === "approved");
  const waiting = apps.filter((a) => WAITING.has(String(a.status)));
  const rejected = apps.filter((a) => a.status === "rejected");
  const allRejected = apps.length > 0 && rejected.length === apps.length;
  const staleApps = waiting.filter((a) => daysSince(String(a.updated_at), now) > STALE_BANK_DAYS);
  const heldDays = lead.debt_since ? daysSince(String(lead.debt_since), now) : 0;
  return {
    docsDone: docs.length, docsTotal: DOCS.length, docs,
    filed: filed.length, approved: approved.length, waiting: waiting.length, rejected: rejected.length,
    allRejected, staleApps: staleApps.length, heldDays, holdWarning: allRejected && heldDays >= HOLD_DAYS - 10,
    bestAmount: Math.max(0, ...approved.map((a) => Number(a.amount) || 0)),
  };
}

/** ลูกค้าที่อยู่ในงานสินเชื่อ (จองหรือยื่นกู้) พร้อมรายการยื่นของแต่ละคน */
export async function loanCases(db: TenantDb, now = new Date()) {
  const [booked, loan, apps] = await Promise.all([
    db.list("leads", { where: { stage: "booked" }, limit: 2000 }),
    db.list("leads", { where: { stage: "loan" }, limit: 2000 }),
    db.list("loan_apps", { limit: 2000 }),
  ]);
  return [...loan, ...booked].map((lead) => {
    const mine = apps.filter((a) => a.lead_id === lead.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return { lead, apps: mine, sum: summarize(lead, mine, now) };
  });
}

export async function appsOf(db: TenantDb, leadId: string) {
  return (await db.list("loan_apps", { where: { lead_id: leadId }, limit: 50 })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

const act = (leadId: string, actor: string, note: string): BatchOp => ({ kind: "insert", table: "lead_activity", data: { lead_id: leadId, kind: "loan", note, actor } });

async function needLead(db: TenantDb, id: string) {
  const lead = await db.get("leads", id);
  if (!lead) throw new Error("ไม่พบลูกค้ารายนี้");
  if (lead.stage !== "booked" && lead.stage !== "loan") throw new Error("จัดการสินเชื่อได้เฉพาะลูกค้าที่จองหรือยื่นกู้");
  return lead;
}

export async function setDocs(db: TenantDb, leadId: string, keys: string[]) {
  await needLead(db, leadId);
  const clean = DOCS.filter((d) => keys.includes(d));
  await db.update("leads", leadId, { loan_docs: clean.join(",") });
}

export async function addBank(db: TenantDb, leadId: string, bankRaw: string, actor: string) {
  const bank = String(bankRaw ?? "").trim();
  if (!(BANKS as readonly string[]).includes(bank)) throw new Error("เลือกธนาคารจากรายการ");
  await needLead(db, leadId);
  if ((await db.count("loan_apps", { lead_id: leadId, bank })) > 0) throw new Error(`ยื่น ${bank} ไว้แล้ว`);
  await db.batch([{ kind: "insert", table: "loan_apps", data: { lead_id: leadId, bank, status: "preparing" } }, act(leadId, actor, `เพิ่มธนาคาร ${bank}`)]);
}

export async function setAppStatus(db: TenantDb, appId: string, statusRaw: string, actor: string, opts: { amount?: number; officer?: string; note?: string } = {}) {
  const app = await db.get("loan_apps", appId);
  if (!app) throw new Error("ไม่พบรายการยื่นนี้");
  const status = String(statusRaw) as LoanStatus;
  if (!(LOAN_STATUS as readonly string[]).includes(status)) throw new Error("สถานะไม่ถูกต้อง");
  const leadId = String(app.lead_id);
  const lead = await needLead(db, leadId);
  const patch: Record<string, unknown> = { status };
  if (opts.amount !== undefined) { const n = Math.round(Number(opts.amount)); if (!(n >= 0)) throw new Error("วงเงินไม่ถูกต้อง"); patch.amount = n; }
  if (opts.officer !== undefined) patch.officer = String(opts.officer).trim().slice(0, 120);
  if (opts.note !== undefined) patch.note = String(opts.note).trim().slice(0, 500);

  // สถานะใหม่ของทุกธนาคาร (รวมรายการนี้) เพื่อดูว่าไม่ผ่านครบหรือยัง
  const apps = (await appsOf(db, leadId)).map((a) => (a.id === appId ? { ...a, status } : a));
  const allRejected = apps.length > 0 && apps.every((a) => a.status === "rejected");
  const leadPatch: Record<string, unknown> = {};
  if (allRejected && !lead.debt_since) leadPatch.debt_since = new Date().toISOString();
  if (!allRejected && lead.debt_since) leadPatch.debt_since = "";

  const ops: BatchOp[] = [{ kind: "update", table: "loan_apps", id: appId, patch }, act(leadId, actor, `${app.bank}: ${LOAN_LABEL[status]}`)];
  if (Object.keys(leadPatch).length) ops.push({ kind: "update", table: "leads", id: leadId, patch: leadPatch });
  await db.batch(ops);

  // ยื่นธนาคารแล้ว แต่ลูกค้ายังอยู่ขั้นจอง → เลื่อนเป็นยื่นกู้
  if (status !== "preparing" && lead.stage === "booked") await moveLead(db, leadId, "loan", actor);
}

export async function removeApp(db: TenantDb, appId: string, actor: string) {
  const app = await db.get("loan_apps", appId);
  if (!app) throw new Error("ไม่พบรายการยื่นนี้");
  const leadId = String(app.lead_id);
  const lead = await needLead(db, leadId);
  // ลบแล้วที่เหลือไม่ผ่านทุกธนาคาร → เริ่มนับแก้หนี้ / ไม่เหลือหรือยังมีธนาคารที่รออยู่ → เลิกนับ
  const rest = (await appsOf(db, leadId)).filter((a) => a.id !== appId);
  const allRejected = rest.length > 0 && rest.every((a) => a.status === "rejected");
  const ops: BatchOp[] = [act(leadId, actor, `ลบธนาคาร ${app.bank}`)];
  if (allRejected && !lead.debt_since) ops.push({ kind: "update", table: "leads", id: leadId, patch: { debt_since: new Date().toISOString() } });
  if (!allRejected && lead.debt_since) ops.push({ kind: "update", table: "leads", id: leadId, patch: { debt_since: "" } });
  await db.remove("loan_apps", appId);
  await db.batch(ops);
}

export async function saveDebt(db: TenantDb, leadId: string, p: { reason: string; plan: string; retryAt: string }) {
  await needLead(db, leadId);
  const retry = String(p.retryAt ?? "").trim();
  if (retry && !/^\d{4}-\d{2}-\d{2}$/.test(retry)) throw new Error("วันที่ไม่ถูกต้อง");
  await db.update("leads", leadId, { debt_reason: String(p.reason).trim().slice(0, 300), debt_plan: String(p.plan).trim().slice(0, 500), debt_retry_at: retry });
}

/** อนุมัติแล้ว → ย้ายลูกค้าไปขั้นโอนแล้ว */
export async function markTransferred(db: TenantDb, leadId: string, actor: string) {
  const lead = await needLead(db, leadId);
  const apps = await appsOf(db, leadId);
  if (!apps.some((a) => a.status === "approved")) throw new Error("ยังไม่มีธนาคารอนุมัติ");
  if (lead.stage === "booked") await moveLead(db, leadId, "loan", actor);
  await moveLead(db, leadId, "transferred", actor);
}
