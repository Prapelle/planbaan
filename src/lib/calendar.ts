/**
 * ปฏิทิน: รวมวันที่ที่มีอยู่แล้วในระบบ + นัดหมายที่ผู้ใช้เพิ่มเอง
 * - นัดติดตามลูกค้า (leads.next_follow_at) ลูกค้าที่ปิดแล้วไม่แสดง
 * - ยื่นกู้ใหม่ (leads.debt_retry_at) เฉพาะลูกค้าที่ยังอยู่ขั้นยื่นกู้
 * - กำหนดเสร็จงวดงาน และกำหนดส่งมอบบ้าน (เฉพาะโครงการที่เปิดส่วนก่อสร้าง งานที่ยังไม่ส่งมอบ)
 * - นัดหมายที่เพิ่มเอง (ตาราง events)
 */
import type { TenantDb } from "./tenant-db";
import { isClosed } from "./sales";

export type CalKind = "event" | "follow" | "loan" | "stage" | "due";
export const KIND_LABEL: Record<CalKind, string> = {
  event: "นัดหมาย", follow: "นัดติดตามลูกค้า", loan: "ยื่นกู้ใหม่", stage: "กำหนดเสร็จงวดงาน", due: "กำหนดส่งมอบบ้าน",
};
export type CalItem = {
  date: string; time: string; kind: CalKind; title: string; sub: string; href: string;
  eventId?: string; createdBy?: string; owner?: string;
};

const DAY_OK = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_OK = /^([01]\d|2[0-3]):[0-5]\d$/;
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

async function listAll(db: TenantDb, table: "leads" | "builds" | "build_stages") {
  const out: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 2000) {
    const page = await db.list(table, { limit: 2000, offset: off });
    out.push(...page);
    if (page.length < 2000) return out;
  }
}

export async function addEvent(db: TenantDb, e: { title: string; date: string; time?: string; note?: string; leadId?: string }, actor: string) {
  const title = txt(e.title, 120);
  if (!title) throw new Error("ใส่หัวข้อนัดหมาย");
  if (!DAY_OK.test(e.date) || Number.isNaN(Date.parse(e.date))) throw new Error("วันที่ไม่ถูกต้อง");
  const time = (e.time ?? "").trim();
  if (time && !TIME_OK.test(time)) throw new Error("เวลาไม่ถูกต้อง");
  const leadId = txt(e.leadId, 64);
  if (leadId && !(await db.get("leads", leadId))) throw new Error("ไม่พบลูกค้าที่เลือก");
  return db.insert("events", { title, event_date: e.date, event_month: e.date.slice(0, 7), event_time: time, note: txt(e.note, 1000), lead_id: leadId, created_by: actor });
}

/** ลบนัดหมาย: คนที่สร้าง หรือผู้ที่จัดการได้ทั้งหมด (เจ้าของ/ผู้จัดการ) */
export async function removeEvent(db: TenantDb, id: string, actor: string, canManageAll: boolean) {
  const ev = await db.get("events", id);
  if (!ev) throw new Error("ไม่พบนัดหมาย");
  if (!canManageAll && ev.created_by !== actor) throw new Error("ลบได้เฉพาะนัดหมายที่คุณสร้าง");
  await db.remove("events", id);
}

export async function monthItems(db: TenantDb, month: string, opts: { construction: boolean; mine?: string }) {
  const inMonth = (d: unknown) => typeof d === "string" && d.startsWith(month);
  const [events, leads, builds, stages] = await Promise.all([
    db.list("events", { where: { event_month: month }, limit: 2000 }),
    listAll(db, "leads"),
    opts.construction ? listAll(db, "builds") : Promise.resolve([]),
    opts.construction ? listAll(db, "build_stages") : Promise.resolve([]),
  ]);
  const leadName = new Map(leads.map((l) => [String(l.id), String(l.name)]));
  const items: CalItem[] = [];
  for (const e of events) {
    items.push({
      date: String(e.event_date), time: String(e.event_time), kind: "event", title: String(e.title),
      sub: [e.lead_id ? `ลูกค้า ${leadName.get(String(e.lead_id)) ?? ""}` : "", String(e.note)].filter(Boolean).join(" · "),
      href: e.lead_id ? `/leads/${e.lead_id}` : "", eventId: String(e.id), createdBy: String(e.created_by), owner: String(e.created_by),
    });
  }
  for (const l of leads) {
    if (isClosed(String(l.stage))) continue;
    if (inMonth(l.next_follow_at)) items.push({ date: String(l.next_follow_at), time: "", kind: "follow", title: String(l.name), sub: [l.plot_code ? `แปลง ${l.plot_code}` : "", String(l.phone ?? "")].filter(Boolean).join(" · "), href: `/leads/${l.id}`, owner: String(l.owner_email) });
    if (l.stage === "loan" && inMonth(l.debt_retry_at)) items.push({ date: String(l.debt_retry_at), time: "", kind: "loan", title: String(l.name), sub: "ยื่นกู้ใหม่หลังแก้หนี้", href: `/loans?lead=${l.id}`, owner: String(l.owner_email) });
  }
  const buildBy = new Map(builds.map((b) => [String(b.id), b]));
  for (const b of builds) {
    if (b.status === "done") continue;
    if (inMonth(b.due_date)) items.push({ date: String(b.due_date), time: "", kind: "due", title: String(b.title), sub: b.customer_name ? `เจ้าของบ้าน ${b.customer_name}` : "", href: `/build/${b.id}` });
  }
  for (const s of stages) {
    const b = buildBy.get(String(s.build_id));
    if (!b || b.status === "done" || s.done_at || !inMonth(s.planned_end)) continue;
    items.push({ date: String(s.planned_end), time: "", kind: "stage", title: `${b.title}: ${s.name}`, sub: "งวดงานครบกำหนด", href: `/build/${b.id}` });
  }
  const shown = opts.mine ? items.filter((i) => i.kind === "stage" || i.kind === "due" || i.owner === opts.mine) : items;
  const order: Record<CalKind, number> = { event: 0, follow: 1, loan: 2, due: 3, stage: 4 };
  return shown.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99") || order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, "th"));
}

/** ตารางเดือน: เริ่มวันอาทิตย์ แต่ละช่องเป็น YYYY-MM-DD หรือ "" (นอกเดือน) */
export function monthGrid(month: string) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: string[] = Array(first.getUTCDay()).fill("");
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push("");
  return cells;
}
