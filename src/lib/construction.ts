/**
 * ส่วนก่อสร้าง (ส่วนเสียเงิน)
 * - หนึ่งงาน = บ้านหนึ่งหลัง มีงวดงานเรียงลำดับ แต่ละงวดมีกำหนดเสร็จตามแผน งวดเงินที่เก็บจากลูกค้า และงวดเบิกกู้ปลูกสร้าง
 * - โฟร์แมนติ๊กงวดเสร็จ ถ่ายรูป บันทึกหน้างาน → นับเป็น "อัปเดตล่าสุด" ใช้เตือนบ้านที่เงียบ
 * - สถานะบ้านในผังแปลงเปลี่ยนเองตามงวดงาน (ยังไม่เริ่ม → กำลังสร้าง → พร้อมโอน)
 * - งานเพิ่ม-ลดต้องให้ลูกค้ายืนยันก่อน (ผ่านลิงก์ส่วนตัว หรือพนักงานบันทึกแทนพร้อมหมายเหตุ)
 */
import type { BatchOp, TenantDb } from "./tenant-db";
import { bkkDate } from "./sales";

/** ราคาส่วนก่อสร้างต่อหลังที่กำลังก่อสร้างต่อเดือน (ค่าชั่วคราว รอเจ้าของตัดสินใจ) */
export const BUILD_PRICE = () => Number(process.env.BUILD_PRICE_BAHT ?? 400);
export const DEFAULT_STAGES = ["ฐานราก", "โครงสร้าง", "หลังคา", "ระบบไฟฟ้าและประปา", "เก็บงานและส่งมอบ"];
export const BUILD_STATUS_LABEL: Record<string, string> = { active: "กำลังสร้าง", paused: "หยุดชั่วคราว", done: "ส่งมอบแล้ว" };
export const CHANGE_LABEL: Record<string, string> = { pending: "รอลูกค้ายืนยัน", confirmed: "ลูกค้ายืนยันแล้ว", rejected: "ลูกค้าไม่รับ", cancelled: "ยกเลิก" };
export const DRAW_LABEL: Record<string, string> = { "": "–", requested: "ยื่นเบิกแล้ว", released: "ธนาคารจ่ายแล้ว" };
export const LOG_LABEL: Record<string, string> = {
  created: "สร้างงาน", stage_done: "งวดเสร็จ", stage_undo: "ยกเลิกงวดเสร็จ", photo: "รูปหน้างาน", note: "บันทึกหน้างาน", change: "งานเพิ่ม-ลด",
  paid: "งวดเงิน", draw: "เบิกกู้ปลูกสร้าง", finished: "ส่งมอบ", link: "ลิงก์เจ้าของบ้าน", edit: "แก้ไขข้อมูล",
};
const DAY_OK = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const day = (v: unknown, label: string) => { const s = String(v ?? ""); if (!DAY_OK.test(s)) throw new Error(`${label}ไม่ถูกต้อง`); return s; };
const money = (v: unknown, signed = false) => {
  const n = Number(String(v ?? "0").replace(/[,\s฿]/g, "") || 0);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9 || (!signed && n < 0)) throw new Error("จำนวนเงินไม่ถูกต้อง");
  return Math.round(n * 100) / 100;
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400_000);

type Row = Record<string, unknown> & { id: string };
const logOp = (buildId: string, kind: string, actor: string, note = ""): BatchOp => ({ kind: "insert", table: "build_log", data: { build_id: buildId, kind, actor, note: txt(note, 1000) } });
const touch = (buildId: string): BatchOp => ({ kind: "update", table: "builds", id: buildId, patch: { last_update_at: new Date().toISOString() } });

export async function getBuild(db: TenantDb, id: string) {
  const b = await db.get("builds", id);
  if (!b) throw new Error("ไม่พบงานก่อสร้างนี้");
  return b;
}
export async function stagesOf(db: TenantDb, buildId: string) {
  return (await db.list("build_stages", { where: { build_id: buildId }, limit: 100 })).sort((a, b) => Number(a.seq) - Number(b.seq));
}

/** สถานะบ้านในผังแปลง จากงวดงานของหลังที่ผูกแปลงนั้น */
export function houseStatusOf(stages: Row[]): "not_started" | "building" | "ready" {
  const done = stages.filter((s) => s.done_at).length;
  return done === 0 ? "not_started" : done === stages.length ? "ready" : "building";
}
async function syncPlot(db: TenantDb, build: Row, stages: Row[]): Promise<BatchOp | null> {
  const code = String(build.plot_code ?? "");
  if (!code) return null;
  const [plot] = await db.list("plots", { where: { code }, limit: 1 });
  if (!plot) return null;
  const hs = houseStatusOf(stages);
  return plot.house_status === hs ? null : { kind: "update", table: "plots", id: plot.id, patch: { house_status: hs } };
}
const keep = (ops: (BatchOp | null)[]) => ops.filter((o): o is BatchOp => o !== null);

export type NewBuild = { title?: string; plotCode?: string; leadId?: string; customerName?: string; startDate: string; dueDate: string; price?: string | number; stages?: string[] };

export async function createBuild(db: TenantDb, input: NewBuild, actor: string) {
  const start = day(input.startDate, "วันเริ่ม"), due = day(input.dueDate, "กำหนดส่งมอบ");
  if (due <= start) throw new Error("กำหนดส่งมอบต้องหลังวันเริ่ม");
  const plotCode = txt(input.plotCode, 12).toUpperCase();
  let title = txt(input.title, 120), customer = txt(input.customerName, 120);
  const leadId = txt(input.leadId, 64);
  const [plots, active, lead] = await Promise.all([
    plotCode ? db.list("plots", { where: { code: plotCode }, limit: 1 }) : Promise.resolve([]),
    plotCode ? db.list("builds", { where: { plot_code: plotCode }, limit: 20 }) : leadId ? db.list("builds", { where: { lead_id: leadId }, limit: 20 }) : Promise.resolve([]),
    leadId ? db.get("leads", leadId) : Promise.resolve(null),
  ]);
  if (plotCode && !plots[0]) throw new Error(`ไม่พบแปลง ${plotCode}`);
  if (leadId && !lead) throw new Error("ไม่พบลูกค้ารายนี้");
  if (active.some((b) => b.status !== "done")) throw new Error(plotCode ? `แปลง ${plotCode} มีงานก่อสร้างที่ยังไม่เสร็จอยู่แล้ว` : "ลูกค้ารายนี้มีงานก่อสร้างที่ยังไม่เสร็จอยู่แล้ว");
  if (!customer && lead) customer = String(lead.name);
  if (!title) title = plotCode ? `แปลง ${plotCode}` : customer ? `บ้านคุณ${customer.replace(/^คุณ/, "")}` : "";
  if (!title) throw new Error("ตั้งชื่องาน หรือเลือกแปลง/ลูกค้า");
  const names = (input.stages?.length ? input.stages : DEFAULT_STAGES).map((n) => txt(n, 80)).filter(Boolean).slice(0, 30);
  if (!names.length) throw new Error("ต้องมีงวดงานอย่างน้อย 1 งวด");
  const span = daysBetween(due, start);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ops: BatchOp[] = [
    { kind: "insert", table: "builds", id, data: { title, plot_code: plotCode, lead_id: leadId, customer_name: customer, start_date: start, due_date: due, contract_price: money(input.price), status: "active", show_delay: 1, last_update_at: now } },
    ...names.map((name, i): BatchOp => ({ kind: "insert", table: "build_stages", data: { build_id: id, seq: i + 1, name, planned_end: addDays(start, Math.round((span * (i + 1)) / names.length)) } })),
    logOp(id, "created", actor, `${names.length} งวด ส่งมอบ ${due}`),
  ];
  const [row] = await db.batch(ops);
  return row;
}

export async function updateBuild(db: TenantDb, id: string, p: { title?: string; customerName?: string; dueDate?: string; price?: string; status?: string; showDelay?: boolean; note?: string }, actor: string) {
  const b = await getBuild(db, id);
  const patch: Record<string, unknown> = {};
  if (p.title !== undefined) { const t = txt(p.title, 120); if (!t) throw new Error("ต้องมีชื่องาน"); patch.title = t; }
  if (p.customerName !== undefined) patch.customer_name = txt(p.customerName, 120);
  if (p.dueDate !== undefined) { const d = day(p.dueDate, "กำหนดส่งมอบ"); if (d <= String(b.start_date)) throw new Error("กำหนดส่งมอบต้องหลังวันเริ่ม"); patch.due_date = d; }
  if (p.price !== undefined) patch.contract_price = money(p.price);
  if (p.status !== undefined) { if (!["active", "paused"].includes(p.status) || b.status === "done") throw new Error("เปลี่ยนสถานะไม่ได้"); patch.status = p.status; }
  if (p.showDelay !== undefined) patch.show_delay = p.showDelay ? 1 : 0;
  if (p.note !== undefined) patch.note = txt(p.note, 2000);
  await db.batch([{ kind: "update", table: "builds", id, patch }, logOp(id, "edit", actor)]);
}

export async function updateStage(db: TenantDb, stageId: string, p: { name?: string; plannedEnd?: string; payAmount?: string; drawAmount?: string }, actor: string) {
  const s = await db.get("build_stages", stageId);
  if (!s) throw new Error("ไม่พบงวดงาน");
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) { const n = txt(p.name, 80); if (!n) throw new Error("ต้องมีชื่องวด"); patch.name = n; }
  if (p.plannedEnd !== undefined) patch.planned_end = day(p.plannedEnd, "กำหนดเสร็จ");
  if (p.payAmount !== undefined) patch.pay_amount = money(p.payAmount);
  if (p.drawAmount !== undefined) patch.draw_amount = money(p.drawAmount);
  await db.batch([{ kind: "update", table: "build_stages", id: stageId, patch }, logOp(String(s.build_id), "edit", actor, `งวด ${patch.name ?? s.name}`)]);
}

/** ติ๊กงวดเสร็จ (หรือยกเลิก) — งวดต้องเสร็จตามลำดับ */
export async function setStageDone(db: TenantDb, stageId: string, done: boolean, actor: string, note = "") {
  const s = await db.get("build_stages", stageId);
  if (!s) throw new Error("ไม่พบงวดงาน");
  const buildId = String(s.build_id);
  const [b, stages] = await Promise.all([getBuild(db, buildId), stagesOf(db, buildId)]);
  if (b.status === "done") throw new Error("งานนี้ส่งมอบแล้ว");
  const idx = stages.findIndex((x) => x.id === stageId);
  if (done) {
    if (s.done_at) return;
    if (stages.slice(0, idx).some((x) => !x.done_at)) throw new Error("ติ๊กงวดก่อนหน้าให้เสร็จก่อน");
  } else {
    if (!s.done_at) return;
    if (stages.slice(idx + 1).some((x) => x.done_at)) throw new Error("ยกเลิกงวดหลังสุดที่เสร็จก่อน");
  }
  const doneAt = done ? bkkDate() : "";
  const after = stages.map((x) => (x.id === stageId ? { ...x, done_at: doneAt } : x));
  await db.batch(keep([
    { kind: "update", table: "build_stages", id: stageId, patch: { done_at: doneAt } },
    touch(buildId),
    logOp(buildId, done ? "stage_done" : "stage_undo", actor, `${s.name}${note ? ` · ${note}` : ""}`),
    await syncPlot(db, b, after),
  ]));
}

export async function setPaid(db: TenantDb, stageId: string, paid: boolean, actor: string) {
  const s = await db.get("build_stages", stageId);
  if (!s) throw new Error("ไม่พบงวดงาน");
  await db.batch([
    { kind: "update", table: "build_stages", id: stageId, patch: { paid_at: paid ? bkkDate() : "" } },
    logOp(String(s.build_id), "paid", actor, `${s.name}: ${paid ? "รับเงินแล้ว" : "ยกเลิกรับเงิน"}`),
  ]);
}

export async function setDraw(db: TenantDb, stageId: string, status: string, actor: string) {
  if (!["", "requested", "released"].includes(status)) throw new Error("สถานะเบิกไม่ถูกต้อง");
  const s = await db.get("build_stages", stageId);
  if (!s) throw new Error("ไม่พบงวดงาน");
  if (status && !s.done_at) throw new Error("เบิกกู้ได้เมื่องวดงานนั้นเสร็จแล้ว");
  await db.batch([
    { kind: "update", table: "build_stages", id: stageId, patch: { draw_status: status } },
    logOp(String(s.build_id), "draw", actor, `${s.name}: ${DRAW_LABEL[status]}`),
  ]);
}

export async function addNote(db: TenantDb, buildId: string, note: string, actor: string) {
  const n = txt(note, 1000);
  if (!n) throw new Error("ใส่บันทึกก่อน");
  await getBuild(db, buildId);
  await db.batch([touch(buildId), logOp(buildId, "note", actor, n)]);
}

// ── รูปหน้างาน ──
export const photoPrefix = (projectId: string, buildId: string) => `files/${projectId}/build/${buildId}/`;
export async function addPhoto(db: TenantDb, buildId: string, p: { key: string; stageId?: string; caption?: string }, actor: string) {
  const b = await getBuild(db, buildId);
  if (!p.key.startsWith(photoPrefix(db.projectId, buildId))) throw new Error("ไฟล์ไม่ถูกต้อง");
  if (p.stageId) { const s = await db.get("build_stages", p.stageId); if (!s || s.build_id !== b.id) throw new Error("ไม่พบงวดงาน"); }
  const [row] = await db.batch([
    { kind: "insert", table: "build_photos", data: { build_id: buildId, stage_id: p.stageId ?? "", r2_key: p.key, caption: txt(p.caption, 200), published: 0, taken_by: actor } },
    touch(buildId), logOp(buildId, "photo", actor, txt(p.caption, 200)),
  ]);
  return row;
}
export async function setPhotoPublished(db: TenantDb, photoId: string, published: boolean) {
  const ph = await db.get("build_photos", photoId);
  if (!ph) throw new Error("ไม่พบรูป");
  await db.update("build_photos", photoId, { published: published ? 1 : 0 });
}
/** ลบรูป: คืน key ให้ผู้เรียกลบไฟล์ใน R2 */
export async function removePhoto(db: TenantDb, photoId: string) {
  const ph = await db.get("build_photos", photoId);
  if (!ph) throw new Error("ไม่พบรูป");
  await db.remove("build_photos", photoId);
  return String(ph.r2_key);
}

// ── งานเพิ่ม-ลด ──
export async function addChange(db: TenantDb, buildId: string, p: { title: string; amount: string }, actor: string) {
  const b = await getBuild(db, buildId);
  if (b.status === "done") throw new Error("งานนี้ส่งมอบแล้ว");
  const title = txt(p.title, 200);
  if (!title) throw new Error("ใส่รายการงานเพิ่ม-ลด");
  const amount = money(p.amount, true);
  if (amount === 0) throw new Error("ใส่ราคา (งานลดใส่ติดลบ)");
  const [row] = await db.batch([
    { kind: "insert", table: "build_changes", data: { build_id: buildId, title, amount, status: "pending", created_by: actor } },
    logOp(buildId, "change", actor, `เสนอ: ${title} ${amount > 0 ? "+" : ""}${amount}`),
  ]);
  return row;
}

/** ลูกค้าตัดสินใจ — by: "owner_link:<ชื่อ>" (ผ่านลิงก์) หรืออีเมลพนักงาน (บันทึกแทน ต้องมีหมายเหตุ เช่น ลูกค้ายืนยันทางโทรศัพท์) */
export async function decideChange(db: TenantDb, changeId: string, decision: "confirmed" | "rejected", by: string, note = "") {
  if (decision !== "confirmed" && decision !== "rejected") throw new Error("คำตอบไม่ถูกต้อง");
  const c = await db.get("build_changes", changeId);
  if (!c) throw new Error("ไม่พบรายการ");
  if (c.status !== "pending") throw new Error("รายการนี้ตัดสินใจไปแล้ว");
  const viaLink = by.startsWith("owner_link:");
  if (viaLink && by.length <= "owner_link:".length + 1) throw new Error("พิมพ์ชื่อผู้ยืนยัน");
  if (!viaLink && !txt(note, 500)) throw new Error("บันทึกแทนลูกค้าต้องใส่หมายเหตุว่าลูกค้ายืนยันทางไหน");
  await db.batch([
    { kind: "update", table: "build_changes", id: changeId, patch: { status: decision, decided_at: new Date().toISOString(), decided_by: txt(by, 200), decided_note: txt(note, 500) } },
    logOp(String(c.build_id), "change", viaLink ? by : by, `${CHANGE_LABEL[decision]}: ${c.title}`),
  ]);
}
export async function cancelChange(db: TenantDb, changeId: string, actor: string) {
  const c = await db.get("build_changes", changeId);
  if (!c) throw new Error("ไม่พบรายการ");
  if (c.status !== "pending") throw new Error("ยกเลิกได้เฉพาะรายการที่รอลูกค้ายืนยัน");
  await db.batch([
    { kind: "update", table: "build_changes", id: changeId, patch: { status: "cancelled", decided_at: new Date().toISOString(), decided_by: actor } },
    logOp(String(c.build_id), "change", actor, `ยกเลิก: ${c.title}`),
  ]);
}

/** ส่งมอบ: ทุกงวดต้องเสร็จ */
export async function finishBuild(db: TenantDb, buildId: string, actor: string) {
  const [b, stages] = await Promise.all([getBuild(db, buildId), stagesOf(db, buildId)]);
  if (b.status === "done") return b;
  if (stages.some((s) => !s.done_at)) throw new Error("ติ๊กทุกงวดให้เสร็จก่อนส่งมอบ");
  await db.batch(keep([
    { kind: "update", table: "builds", id: buildId, patch: { status: "done", done_at: bkkDate(), last_update_at: new Date().toISOString() } },
    logOp(buildId, "finished", actor), await syncPlot(db, b, stages),
  ]));
  return b;
}

// ── สรุป ──
export type BuildSummary = {
  build: Row; stages: Row[]; pct: number; doneCount: number; current: Row | null; lateDays: number; overdueDays: number;
  idleDays: number; stale: boolean; payDue: number; payDueCount: number; paidTotal: number; payTotal: number;
  changesConfirmed: number; changesPending: number; drawPending: number;
};
export function summarize(build: Row, stages: Row[], changes: Row[], opts: { staleDays: number; now?: Date }): BuildSummary {
  const today = bkkDate(opts.now);
  const doneCount = stages.filter((s) => s.done_at).length;
  const current = stages.find((s) => !s.done_at) ?? null;
  const active = build.status === "active";
  const lateDays = current && build.status !== "done" ? Math.max(0, daysBetween(today, String(current.planned_end))) : 0;
  const overdueDays = build.status !== "done" ? Math.max(0, daysBetween(today, String(build.due_date))) : 0;
  const idleDays = Math.max(0, daysBetween(today, bkkDate(new Date(String(build.last_update_at)))));
  const due = stages.filter((s) => s.done_at && Number(s.pay_amount) > 0 && !s.paid_at);
  const mine = changes.filter((c) => c.build_id === build.id);
  return {
    build, stages, doneCount, current,
    pct: stages.length ? Math.round((doneCount / stages.length) * 100) : 0,
    lateDays, overdueDays, idleDays, stale: active && idleDays > opts.staleDays,
    payDue: due.reduce((a, s) => a + Number(s.pay_amount), 0), payDueCount: due.length,
    paidTotal: stages.filter((s) => s.paid_at).reduce((a, s) => a + Number(s.pay_amount), 0),
    payTotal: stages.reduce((a, s) => a + Number(s.pay_amount), 0),
    changesConfirmed: mine.filter((c) => c.status === "confirmed").reduce((a, c) => a + Number(c.amount), 0),
    changesPending: mine.filter((c) => c.status === "pending").length,
    drawPending: stages.filter((s) => s.done_at && Number(s.draw_amount) > 0 && s.draw_status !== "released").length,
  };
}

async function listAll(db: TenantDb, table: "builds" | "build_stages" | "build_changes") {
  const out: Row[] = [];
  for (let off = 0; ; off += 2000) {
    const page = await db.list(table, { limit: 2000, offset: off });
    out.push(...page);
    if (page.length < 2000) return out;
  }
}

export async function buildBoard(db: TenantDb, staleDays: number, now = new Date()) {
  const [builds, stages, changes] = await Promise.all([listAll(db, "builds"), listAll(db, "build_stages"), listAll(db, "build_changes")]);
  const byBuild = new Map<string, Row[]>();
  for (const s of stages) { const k = String(s.build_id); (byBuild.get(k) ?? byBuild.set(k, []).get(k)!).push(s); }
  const all = builds.map((b) => summarize(b, (byBuild.get(b.id) ?? []).sort((x, y) => Number(x.seq) - Number(y.seq)), changes, { staleDays, now }));
  const rank = (s: BuildSummary) => (s.build.status === "done" ? 3 : s.build.status === "paused" ? 2 : s.stale || s.lateDays || s.overdueDays ? 0 : 1);
  all.sort((a, b) => rank(a) - rank(b) || b.lateDays - a.lateDays || b.idleDays - a.idleDays || String(a.build.title).localeCompare(String(b.build.title), "th"));
  const live = all.filter((s) => s.build.status !== "done");
  return {
    all,
    counts: {
      active: all.filter((s) => s.build.status === "active").length, paused: all.filter((s) => s.build.status === "paused").length,
      done: all.filter((s) => s.build.status === "done").length, late: live.filter((s) => s.lateDays > 0 || s.overdueDays > 0).length,
      stale: live.filter((s) => s.stale).length, payDue: live.reduce((a, s) => a + s.payDue, 0), pending: live.reduce((a, s) => a + s.changesPending, 0),
    },
  };
}

/** หลังที่คิดเงินในเดือน: เริ่มแล้วก่อนสิ้นเดือน และยังไม่ส่งมอบก่อนต้นเดือน */
export function billableInMonth(builds: Row[], month: string) {
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return builds.filter((b) => String(b.start_date) < end && (!b.done_at || String(b.done_at) >= start)).length;
}
