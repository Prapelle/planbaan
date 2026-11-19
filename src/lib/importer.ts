/**
 * นำเข้าข้อมูลเดิมจาก Excel/CSV ตอนเริ่มใช้ (หน้าเว็บอ่านไฟล์และจับคู่คอลัมน์ ส่งมาเป็นแถวข้อความ)
 * - แปลง: รหัสใหม่ → สร้าง · รหัสที่มีอยู่ → อัปเดตเฉพาะช่องที่มีค่า (แบบบ้าน ราคา เนื้อที่)
 * - ลูกค้า: ข้ามเบอร์ซ้ำ (กับในระบบและในไฟล์) · ช่องทางและขั้นแปลงจากคำไทย/อังกฤษ
 *   ขั้นจองขึ้นไปต้องมีแปลงที่ว่าง ไม่งั้นนำเข้าเป็น "เข้าชมแล้ว" พร้อมบอกเหตุผล
 * ทุกแถวที่ข้ามหรือปรับ มีเหตุผลกลับไปให้ผู้ใช้เห็น
 */
import type { BatchOp, TenantDb } from "./tenant-db";
import * as S from "./sales";

export const MAX_ROWS = 2000;
type Raw = Record<string, string>;
export type ImportReport = { added: number; updated: number; skipped: { row: number; reason: string }[]; notes: { row: number; reason: string }[] };

const t = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const num = (v: unknown) => {
  const s = String(v ?? "").replace(/[,\s฿]|บาท|ตร\.?ว\.?/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

// ── แปลง ──
export async function importPlots(db: TenantDb, rows: Raw[]): Promise<ImportReport> {
  if (rows.length > MAX_ROWS) throw new Error(`นำเข้าได้ครั้งละไม่เกิน ${MAX_ROWS} แถว`);
  const have = new Map((await db.list("plots", { limit: 2000 })).map((p) => [String(p.code), p]));
  const seen = new Set<string>();
  const rep: ImportReport = { added: 0, updated: 0, skipped: [], notes: [] };
  const ops: BatchOp[] = [];
  rows.forEach((r, i) => {
    const row = i + 2; // แถวที่ 1 คือหัวตาราง
    const code = t(r.code, 12).toUpperCase().replace(/\s+/g, "");
    if (!code) return rep.skipped.push({ row, reason: "ไม่มีรหัสแปลง" });
    if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(code)) return rep.skipped.push({ row, reason: `รหัสแปลง "${code}" ใช้ได้เฉพาะอังกฤษ ตัวเลข และ -` });
    if (seen.has(code)) return rep.skipped.push({ row, reason: `รหัส ${code} ซ้ำในไฟล์` });
    seen.add(code);
    const price = num(r.price), area = num(r.area_sqw);
    if (Number.isNaN(price) || Number.isNaN(area)) return rep.skipped.push({ row, reason: "ราคาหรือเนื้อที่ไม่ใช่ตัวเลข" });
    const data: Record<string, unknown> = {};
    if (t(r.house_type)) data.house_type = t(r.house_type, 80);
    if (price !== null) data.price = Math.round(price);
    if (area !== null) data.area_sqw = Math.round(area * 10) / 10;
    const cur = have.get(code);
    if (cur) {
      if (!Object.keys(data).length) return;
      ops.push({ kind: "update", table: "plots", id: cur.id, patch: data });
      rep.updated++;
    } else {
      const zone = (t(r.zone, 4).toUpperCase() || /^[A-Z]+/.exec(code)?.[0] || code.slice(0, 1)).slice(0, 4);
      ops.push({ kind: "insert", table: "plots", data: { code, zone, house_type: "", price: 0, house_status: "not_started", sale_status: "available", ...data } });
      rep.added++;
    }
  });
  await db.batch(ops);
  return rep;
}

// ── ลูกค้า ──
const CH: [RegExp, S.Channel][] = [
  [/facebook|fb|เฟส|เฟซ|meta/i, "facebook"], [/tiktok|ติ๊กต็อก|ติกต็อก/i, "tiktok"], [/google|กูเกิล/i, "google"], [/line|ไลน์/i, "line"],
  [/walk|เดิน|หน้าโครงการ|ป้าย/i, "walkin"], [/agent|นายหน้า|โบรก/i, "agent"], [/แนะนำ|refer|เพื่อน|บอกต่อ/i, "referral"],
];
export const channelOf = (v: string): S.Channel => {
  const s = t(v);
  if ((S.CHANNELS as readonly string[]).includes(s.toLowerCase())) return s.toLowerCase() as S.Channel;
  return CH.find(([re]) => re.test(s))?.[1] ?? "other";
};
const ST: [RegExp, S.Stage][] = [
  // คำของรับสร้างบ้านก่อน (ส่งมอบ ก่อสร้าง เซ็นสัญญา เสนอแบบ ดูที่ดิน ไม่สร้าง)
  [/ส่งมอบ|handover/i, "transferred"], [/ไม่สร้าง/i, "lost"], [/ก่อสร้าง|กำลังสร้าง/i, "loan"], [/เซ็นสัญญา|ทำสัญญา|contract/i, "booked"],
  [/เสนอแบบ|เสนอราคา|quotation/i, "visited"], [/ดูที่ดิน/i, "visit_scheduled"],
  [/โอน|transfer/i, "transferred"], [/ยื่นกู้|สินเชื่อ|loan/i, "loan"], [/จอง|book|มัดจำ/i, "booked"],
  [/ไม่ซื้อ|ยกเลิก|lost|cancel/i, "lost"], [/เข้าชมแล้ว|ชมแล้ว|visited/i, "visited"], [/นัด|visit/i, "visit_scheduled"],
  [/ติดต่อได้|ติดต่อแล้ว|contacted/i, "contacted"],
];
export const stageOf = (v: string): S.Stage => {
  const s = t(v);
  if ((S.STAGES as readonly string[]).includes(s)) return s as S.Stage;
  return ST.find(([re]) => re.test(s))?.[1] ?? "new";
};

export async function importLeads(db: TenantDb, rows: Raw[], actor: string, members: string[], kind = "developer"): Promise<ImportReport> {
  const builder = kind === "builder"; // รับสร้างบ้านไม่มีแปลงในผัง เซ็นสัญญาได้โดยไม่ต้องมีแปลง
  if (rows.length > MAX_ROWS) throw new Error(`นำเข้าได้ครั้งละไม่เกิน ${MAX_ROWS} แถว`);
  const [leads, plots] = await Promise.all([db.list("leads", { limit: 2000, columns: ["phone", "plot_code", "stage"] }), db.list("plots", { limit: 2000 })]);
  const phones = new Set(leads.map((l) => S.phoneKey(l.phone)).filter(Boolean));
  const plotBy = new Map(plots.map((p) => [String(p.code), p]));
  const held = new Set(leads.filter((l) => S.stageIdx(String(l.stage)) >= S.stageIdx("booked")).map((l) => String(l.plot_code)));
  const memberSet = new Set(members.map((m) => m.toLowerCase()));
  const rep: ImportReport = { added: 0, updated: 0, skipped: [], notes: [] };
  const ops: BatchOp[] = [];
  const plotStatus = new Map<string, string>();
  const now = new Date().toISOString();
  rows.forEach((r, i) => {
    const row = i + 2;
    const name = t(r.name, 120);
    if (!name) return rep.skipped.push({ row, reason: "ไม่มีชื่อลูกค้า" });
    const phone = String(r.phone ?? "").replace(/[^\d+]/g, "").slice(0, 20);
    const k = S.phoneKey(phone);
    if (k && phones.has(k)) return rep.skipped.push({ row, reason: `เบอร์ ${phone} มีอยู่แล้ว (${name})` });
    if (k) phones.add(k);
    let stage = stageOf(r.stage ?? "");
    let plot = t(r.plot_code, 12).toUpperCase().replace(/\s+/g, "");
    if (plot && !plotBy.has(plot)) { rep.notes.push({ row, reason: `ไม่พบแปลง ${plot} นำเข้าโดยไม่ผูกแปลง` }); plot = ""; }
    if (!builder && S.stageIdx(stage) >= S.stageIdx("booked")) {
      const p = plot ? plotBy.get(plot) : null;
      const why = !plot ? "ไม่มีแปลง" : held.has(plot) ? `แปลง ${plot} มีผู้จองแล้ว` : p?.sale_status === "rent" ? `แปลง ${plot} ตั้งเป็นให้เช่า` : "";
      if (why) { rep.notes.push({ row, reason: `${why} นำเข้าที่ขั้น "เข้าชมแล้ว" แทน "${S.STAGE_LABEL[stage]}"` }); stage = "visited"; }
      else { held.add(plot); plotStatus.set(plot, stage); }
    }
    const owner = t(r.owner_email).toLowerCase();
    const id = crypto.randomUUID();
    ops.push(
      { kind: "insert", table: "leads", id, data: {
        name, phone, channel: channelOf(r.channel ?? ""), stage, plot_code: plot, owner_email: memberSet.has(owner) ? owner : actor,
        last_contact_at: now, note: t(r.note, 1000), next_follow_at: "", max_stage: Math.max(0, S.stageIdx(stage)),
        ...(stage === "lost" ? { lost_reason: "other", lost_note: t(r.lost_reason, 300) || "นำเข้าจากไฟล์เดิม" } : {}),
      } },
      { kind: "insert", table: "lead_activity", data: { lead_id: id, kind: "created", from_stage: "", to_stage: stage, note: "นำเข้าจาก Excel", actor } },
    );
    rep.added++;
  });
  for (const [code, stage] of plotStatus) {
    const p = plotBy.get(code)!;
    if (p.sale_status !== stage) ops.push({ kind: "update", table: "plots", id: String(p.id), patch: { sale_status: stage } });
  }
  await db.batch(ops);
  return rep;
}
