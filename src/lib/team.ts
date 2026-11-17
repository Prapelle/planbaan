/**
 * ผลงานรายคน (ต่อเดือน)
 * - งานที่ทำ (ติดต่อลูกค้า) นับให้ "คนที่บันทึก"
 * - ผลลัพธ์ (เข้าชม จอง โอน) นับให้ "เจ้าของลูกค้า" ณ ตอนนี้ เพราะคนเลื่อนขั้นอาจเป็นผู้จัดการ
 * - งานค้าง (ลูกค้าที่ดูแล ค้างติดต่อ นัดเลยกำหนด) เป็นสถานะปัจจุบัน ไม่ขึ้นกับเดือน
 */
import type { TenantDb } from "./tenant-db";
import { bkkDate, isClosed, isStale } from "./sales";

export type PersonStat = {
  email: string; role: string;
  open: number; stale: number; overdue: number;
  newLeads: number; contacts: number; visits: number; bookings: number; transfers: number; lost: number;
};

/** ช่วงเวลาของเดือนตามเวลาไทย เป็น ISO (UTC) สำหรับกรอง created_at */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 7 * 3600_000).toISOString();
  const end = new Date(Date.UTC(y, m, 1) - 7 * 3600_000).toISOString();
  return { start, end };
}

async function all(db: TenantDb, table: "leads" | "lead_activity", opts: { since?: string; before?: string } = {}) {
  const out: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 2000) {
    const page = await db.list(table, { ...opts, limit: 2000, offset: off });
    out.push(...page);
    if (page.length < 2000) return out;
  }
}

export async function teamReport(db: TenantDb, month: string, members: { email: string; role: string }[], now = new Date()) {
  const { start, end } = monthRange(month);
  const [leads, acts] = await Promise.all([all(db, "leads"), all(db, "lead_activity", { since: start, before: end })]);
  const today = bkkDate(now);
  const ownerOf = new Map(leads.map((l) => [String(l.id), String(l.owner_email)]));
  const people = new Map<string, PersonStat>();
  const person = (email: string) => {
    const e = email || "(ยังไม่มีผู้ดูแล)";
    let p = people.get(e);
    if (!p) {
      p = { email: e, role: members.find((m) => m.email === e)?.role ?? "", open: 0, stale: 0, overdue: 0, newLeads: 0, contacts: 0, visits: 0, bookings: 0, transfers: 0, lost: 0 };
      people.set(e, p);
    }
    return p;
  };
  for (const m of members) if (m.role === "sales" || m.role === "manager" || m.role === "owner") person(m.email);

  for (const l of leads) {
    const p = person(String(l.owner_email));
    if (!isClosed(String(l.stage))) {
      p.open++;
      if (isStale(l, now)) p.stale++;
      if (l.next_follow_at && String(l.next_follow_at) < today) p.overdue++;
    }
    const c = String(l.created_at);
    if (c >= start && c < end) p.newLeads++;
  }
  // นับการเลื่อนขั้นครั้งแรกในเดือน ต่อลูกค้า ต่อขั้น (กดเลื่อนกลับไปมาไม่นับซ้ำ)
  const seen = new Set<string>();
  for (const a of acts) {
    if (a.kind === "contact") { person(String(a.actor)).contacts++; continue; }
    if (a.kind !== "stage" && a.kind !== "created") continue;
    const to = String(a.to_stage);
    const key = `${a.lead_id}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = person(ownerOf.get(String(a.lead_id)) ?? "");
    if (to === "visited") p.visits++;
    else if (to === "booked") p.bookings++;
    else if (to === "transferred") p.transfers++;
    else if (to === "lost") p.lost++;
  }
  const rows = [...people.values()].sort((a, b) => b.bookings - a.bookings || b.visits - a.visits || b.contacts - a.contacts || a.email.localeCompare(b.email));
  const total = rows.reduce((t, r) => {
    for (const k of ["open", "stale", "overdue", "newLeads", "contacts", "visits", "bookings", "transfers", "lost"] as const) t[k] += r[k];
    return t;
  }, { open: 0, stale: 0, overdue: 0, newLeads: 0, contacts: 0, visits: 0, bookings: 0, transfers: 0, lost: 0 });
  return { month, rows, total };
}
