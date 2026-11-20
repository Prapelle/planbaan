/**
 * การแจ้งเตือนในเว็บ: คำนวณสดจากข้อมูลตอนเปิด (ไม่เก็บตารางแยก จึงไม่มีรายการค้างที่หมดความหมายแล้ว)
 * แต่ละบทบาทเห็นเฉพาะเรื่องของตัวเอง:
 * - ทุกคนที่ดูแลลูกค้า: นัดวันนี้/เลยนัด, ลูกค้าค้างติดตาม (เฉพาะลูกค้าที่ตัวเองดูแล)
 * - เจ้าของ/ผู้จัดการ: ส่วนลดรออนุมัติ, ธนาคารไม่ขยับ, แก้หนี้ใกล้ครบกำหนด, บ้านช้า/ไม่อัปเดต, เจ้าของบ้านตอบงานเพิ่ม-ลด
 * - โฟร์แมน: บ้านที่ตัวเองรับผิดชอบ (หรือยังไม่กำหนดผู้รับผิดชอบ) ที่ช้า/ไม่อัปเดต และงวดที่ครบกำหนดใน 3 วัน (ไม่มีข้อมูลลูกค้า)
 * - เจ้าของ: สิทธิ์ใช้งานใกล้หมด
 */
import type { TenantDb } from "./tenant-db";
import * as S from "./sales";
import * as L from "./loans";
import * as C from "./construction";
import * as P from "./promotions";
import type { AccessRole } from "./roles";
import type { Entitlement } from "./entitlement";

export type Tone = "red" | "amber" | "blue";
export type Notice = { key: string; group: string; tone: Tone; title: string; sub: string; href: string };

type Row = Record<string, unknown> & { id: string };
const thDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });

export async function notifications(db: TenantDb, me: {
  role: AccessRole; email: string; kind: string; construction: boolean; staleDays: number; ent?: Entitlement; now?: Date;
}): Promise<Notice[]> {
  const now = me.now ?? new Date();
  const today = S.bkkDate(now);
  const in3 = S.bkkDate(new Date(now.getTime() + 3 * 86400_000));
  const boss = me.role === "owner" || me.role === "manager" || me.role === "support";
  const foreman = me.role === "foreman";
  const sells = boss || me.role === "sales";
  const developer = me.kind !== "builder";
  const out: Notice[] = [];

  const [leads, promos, plots, threshold, apps, board] = await Promise.all([
    foreman ? Promise.resolve([] as Row[]) : db.list("leads", { limit: 2000 }),
    boss && developer ? db.list("lead_promos", { limit: 2000 }) : Promise.resolve([] as Row[]),
    boss && developer ? db.list("plots", { limit: 2000, columns: ["code", "price"] }) : Promise.resolve([] as Row[]),
    boss && developer ? P.approvePct(db) : Promise.resolve(0),
    boss && developer ? db.list("loan_apps", { limit: 2000 }) : Promise.resolve([] as Row[]),
    me.construction && (boss || foreman) ? C.buildBoard(db, me.staleDays, now) : Promise.resolve(null),
  ]);
  const L_ = S.stageLabels(me.kind);

  // ── ลูกค้าของฉัน ──
  if (sells) {
    for (const l of leads) {
      if (l.owner_email !== me.email || S.isClosed(String(l.stage))) continue;
      const f = String(l.next_follow_at ?? "");
      if (f && f <= today) out.push({ key: `follow-${l.id}`, group: "ลูกค้าของฉัน", tone: f < today ? "red" : "blue", title: `${f < today ? "เลยนัด" : "นัดวันนี้"}: ${l.name}`, sub: f < today ? `นัดไว้ ${thDay(f)}` : `${L_[l.stage as S.Stage]}`, href: `/leads/${l.id}` });
      else if (S.isStale(l, now, me.kind)) out.push({ key: `stale-${l.id}`, group: "ลูกค้าของฉัน", tone: "amber", title: `ไม่ได้ติดต่อ ${S.daysSince(String(l.last_contact_at), now)} วัน: ${l.name}`, sub: L_[l.stage as S.Stage], href: `/leads/${l.id}` });
    }
  }

  // ── รออนุมัติ ──
  if (boss && developer) {
    const price = new Map(plots.map((p) => [String(p.code), Number(p.price)]));
    for (const l of leads) {
      if (!l.plot_code || S.isClosed(String(l.stage))) continue;
      const afterBooking = S.stageIdx(String(l.stage)) >= S.stageIdx("booked");
      const mine = promos.filter((x) => x.lead_id === l.id);
      if (!mine.length && !(Number(l.sale_price) > 0)) continue;
      const s = P.summarize(l, price.get(String(l.plot_code)) ?? 0, mine, threshold);
      // ก่อนจอง: ฝ่ายขายเลื่อนไปจองไม่ได้จนกว่าจะอนุมัติ · หลังจอง: ไม่บังคับ แต่แจ้งให้ผู้จัดการรู้ว่ามีส่วนลดเพิ่ม
      if (s.needsApproval) out.push({ key: `approve-${l.id}`, group: "รออนุมัติ", tone: afterBooking ? "amber" : "red", title: `${afterBooking ? "ส่วนลดเพิ่มหลังจอง" : "ส่วนลดรออนุมัติ"} ${s.pct.toFixed(1)}%: ${l.name}`, sub: `แปลง ${l.plot_code} · ลด ${s.totalDiscount.toLocaleString("th-TH")} บาท`, href: `/leads/${l.id}#price` });
    }
    // ── สินเชื่อ ──
    for (const l of leads) {
      if (l.stage !== "booked" && l.stage !== "loan") continue;
      const sum = L.summarize(l, apps.filter((a) => a.lead_id === l.id), now);
      if (sum.holdWarning) out.push({ key: `hold-${l.id}`, group: "สินเชื่อ", tone: "red", title: `ถือแปลงแก้หนี้ ${sum.heldDays}/${L.HOLD_DAYS} วัน: ${l.name}`, sub: "ใกล้ครบกำหนด ตัดสินใจว่าจะถือแปลงต่อหรือปล่อย", href: `/loans?lead=${l.id}` });
      else if (sum.staleApps > 0) out.push({ key: `bank-${l.id}`, group: "สินเชื่อ", tone: "amber", title: `ธนาคารไม่ขยับเกิน ${L.STALE_BANK_DAYS} วัน: ${l.name}`, sub: `${sum.staleApps} ธนาคาร`, href: `/loans?lead=${l.id}` });
    }
  }

  // ── ก่อสร้าง ──
  if (board) {
    for (const s of board.all) {
      const b = s.build;
      if (b.status !== "active") continue;
      if (foreman && b.owner_email && b.owner_email !== me.email) continue; // ยังไม่กำหนดผู้รับผิดชอบ: โฟร์แมนทุกคนเห็น
      const href = `/build/${b.id}`;
      if (s.lateDays > 0 || s.overdueDays > 0) out.push({ key: `late-${b.id}`, group: "ก่อสร้าง", tone: "red", title: `${s.overdueDays > 0 ? `เลยกำหนดส่งมอบ ${s.overdueDays} วัน` : `ช้ากว่าแผน ${s.lateDays} วัน`}: ${b.title}`, sub: s.current ? `งวด ${s.current.seq}: ${s.current.name}` : "", href });
      else if (s.stale) out.push({ key: `idle-${b.id}`, group: "ก่อสร้าง", tone: "amber", title: `ไม่มีอัปเดต ${s.idleDays} วัน: ${b.title}`, sub: "ติ๊กงวด ถ่ายรูป หรือบันทึกหน้างาน", href });
      else if (foreman && s.current && String(s.current.planned_end) <= in3) out.push({ key: `due-${b.id}`, group: "ก่อสร้าง", tone: "blue", title: `งวดครบกำหนด ${thDay(String(s.current.planned_end))}: ${b.title}`, sub: String(s.current.name), href });
    }
    if (boss) {
      const week = new Date(now.getTime() - 7 * 86400_000).toISOString();
      const decided = await db.list("build_changes", { limit: 200, orderBy: "updated_at", desc: true });
      const title = new Map(board.all.map((s) => [s.build.id, String(s.build.title)]));
      for (const c of decided) {
        if (String(c.updated_at) < week) break;
        if (!String(c.decided_by ?? "").startsWith("owner_link:") || (c.status !== "confirmed" && c.status !== "rejected")) continue;
        out.push({ key: `change-${c.id}`, group: "ก่อสร้าง", tone: "blue", title: `เจ้าของบ้าน${c.status === "confirmed" ? "ยืนยัน" : "ไม่รับ"}งานเพิ่ม-ลด: ${c.title}`, sub: title.get(String(c.build_id)) ?? "", href: `/build/${c.build_id}` });
      }
    }
  }

  // ── สิทธิ์ใช้งาน ──
  if (me.role === "owner" && me.ent && (me.ent.state === "expiring" || me.ent.state === "grace")) {
    out.push({ key: "ent", group: "สิทธิ์ใช้งาน", tone: me.ent.state === "grace" ? "red" : "amber", title: me.ent.state === "grace" ? "สิทธิ์ใช้งานหมดแล้ว อยู่ในช่วงผ่อนผัน" : `สิทธิ์ใช้งานเหลือ ${me.ent.daysLeft} วัน`, sub: "ติดต่อทีม PlanBaan เพื่อต่อสิทธิ์", href: "/guide#plan" });
  }

  const rank: Record<Tone, number> = { red: 0, amber: 1, blue: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
