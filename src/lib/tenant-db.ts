/**
 * ชั้นข้อมูลของโครงการ (tenant) — ทางเดียวที่โค้ดอ่าน/เขียนตารางข้อมูลโครงการ
 *
 * กติกา (ห้ามละเมิด เพราะลูกค้าแต่ละโครงการเป็นคู่แข่งกัน):
 * 1. ทุกคำสั่งมี `project_id = ?` เสมอ ผูกกับโครงการตอนสร้าง tenantDb() เปลี่ยนภายหลังไม่ได้
 * 2. ใช้ได้เฉพาะตารางและคอลัมน์ที่ประกาศใน TENANT_TABLES (กัน SQL injection และกันอ่านตารางระบบ)
 * 3. ห้ามเขียน SQL ถึงตารางเหล่านี้ที่ไฟล์อื่น — tests/guard.test.mts ตรวจให้
 * เพิ่มตารางใหม่: เพิ่มใน migrations/ แล้วประกาศคอลัมน์ที่นี่
 */
import { type D1Like, type D1Stmt, nowIso } from "./d1";

export const TENANT_TABLES = {
  plots: ["code", "zone", "house_type", "price", "house_status", "sale_status", "map_x", "map_y", "land_cost", "area_sqw"],
  leads: ["name", "phone", "channel", "stage", "plot_code", "owner_email", "last_contact_at", "note", "next_follow_at",
    "loan_docs", "debt_reason", "debt_plan", "debt_retry_at", "debt_since", "max_stage", "sale_price", "discount_approved", "discount_approved_by", "discount_approved_at", "lost_reason", "lost_note"],
  lead_activity: ["lead_id", "kind", "from_stage", "to_stage", "note", "actor"],
  loan_apps: ["lead_id", "bank", "status", "amount", "officer", "note"],
  marketing_spend: ["day", "month", "channel", "campaign", "amount", "source"],
  marketing_budget: ["month", "channel", "amount"],
  builds: ["title", "plot_code", "lead_id", "customer_name", "start_date", "due_date", "contract_price", "status", "show_delay", "last_update_at", "done_at", "note", "owner_email"],
  build_stages: ["build_id", "seq", "name", "planned_end", "done_at", "pay_amount", "paid_at", "draw_amount", "draw_status"],
  build_photos: ["build_id", "stage_id", "r2_key", "caption", "published", "taken_by"],
  build_changes: ["build_id", "title", "amount", "status", "decided_at", "decided_by", "decided_note", "created_by"],
  build_log: ["build_id", "kind", "note", "actor"],
  build_costs: ["build_id", "category", "stage_id", "item", "amount", "cost_date", "entered_by", "batch_id"],
  cost_budgets: ["house_type", "category", "amount"],
  cost_settings: ["key", "value"],
  promotions: ["name", "kind", "default_value", "valid_until", "active"],
  lead_promos: ["lead_id", "promo_id", "name", "kind", "value", "created_by"],
  project_settings: ["key", "value"],
  events: ["title", "event_date", "event_month", "event_time", "note", "lead_id", "created_by"],
} as const;

/**
 * จำนวนแถวของแต่ละโครงการ (สำหรับ back office วัดขนาดข้อมูล) — คืนแค่ตัวเลข ไม่มีเนื้อหา
 * อ่านข้ามโครงการโดยตั้งใจ จึงอยู่ในไฟล์นี้ที่เดียว
 */
export async function rowCountsByProject(db: D1Like): Promise<Record<string, number>> {
  // ทุกตารางในรอบเดียวด้วย D1 batch (เดิมทีละตาราง ~30 รอบ ทำให้หลังบ้านช้า · UNION ALL ยาวเกินที่ D1 รับ)
  const res = await db.batch(Object.keys(TENANT_TABLES).map((t) => db.prepare(`SELECT project_id, COUNT(*) AS n FROM "${t}" GROUP BY project_id`)));
  const out: Record<string, number> = {};
  for (const r of res) for (const x of (r.results ?? []) as { project_id: string; n: number }[]) out[x.project_id] = (out[x.project_id] ?? 0) + Number(x.n);
  return out;
}

export type TenantTable = keyof typeof TENANT_TABLES;
type Row = Record<string, unknown> & { id: string; project_id: string; created_at: string; updated_at: string };
const SYSTEM_COLS = ["id", "project_id", "created_at", "updated_at"] as const;
const ORDERABLE = new Set<string>([...SYSTEM_COLS]);

function checkTable(t: string): TenantTable {
  if (!Object.prototype.hasOwnProperty.call(TENANT_TABLES, t)) throw new Error(`ไม่รู้จักตาราง: ${t}`);
  return t as TenantTable;
}
function checkCols(t: TenantTable, cols: string[]) {
  const ok = TENANT_TABLES[t] as readonly string[];
  for (const c of cols) if (!ok.includes(c)) throw new Error(`คอลัมน์ ${c} ไม่อยู่ในตาราง ${t} หรือแก้ไขไม่ได้`);
}
const colList = (t: TenantTable) => [...SYSTEM_COLS, ...TENANT_TABLES[t]].map((c) => `"${c}"`).join(", ");

export type CountSpec = { table: TenantTable; where?: Record<string, string | number>; lt?: Record<string, string | number>; notIn?: Record<string, (string | number)[]> };
export type BatchOp =
  | { kind: "insert"; table: TenantTable; data: Record<string, unknown>; id?: string }
  | { kind: "update"; table: TenantTable; id: string; patch: Record<string, unknown> };

/** since/before: กรองช่วง created_at (ISO) */
/** columns: อ่านเฉพาะคอลัมน์ที่ระบุ (เช่น back office อ่านแค่วันที่ ไม่แตะชื่อลูกค้า) */
export type ListOpts = { where?: Record<string, string | number>; orderBy?: string; desc?: boolean; limit?: number; offset?: number; since?: string; before?: string; columns?: string[] };

export function tenantDb(db: D1Like, projectId: string) {
  if (!projectId) throw new Error("ต้องระบุ projectId");
  const pid = projectId;

  function buildInsert(table: TenantTable, data: Record<string, unknown>, presetId?: string): { stmt: D1Stmt; row: Row } {
    const t = checkTable(table);
    const keys = Object.keys(data);
    checkCols(t, keys); // project_id / id ส่งมาไม่ได้: ถูกปฏิเสธที่นี่
    const now = nowIso();
    const row = { id: presetId ?? crypto.randomUUID(), project_id: pid, created_at: now, updated_at: now, ...data } as Row;
    const cols = ["id", "project_id", "created_at", "updated_at", ...keys];
    const stmt = db
      .prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      .bind(...cols.map((c) => row[c]));
    return { stmt, row };
  }

  function buildUpdate(table: TenantTable, id: string, patch: Record<string, unknown>): D1Stmt | null {
    const t = checkTable(table);
    const keys = Object.keys(patch);
    if (!keys.length) return null;
    checkCols(t, keys);
    const sets = [...keys.map((c) => `"${c}" = ?`), `"updated_at" = ?`];
    return db.prepare(`UPDATE "${t}" SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`).bind(...keys.map((k) => patch[k]), nowIso(), id, pid);
  }

  return {
    projectId: pid,

    async list(table: TenantTable, opts: ListOpts = {}): Promise<Row[]> {
      const t = checkTable(table);
      const where = opts.where ?? {};
      checkCols(t, Object.keys(where));
      const conds = ["project_id = ?", ...Object.keys(where).map((c) => `"${c}" = ?`)];
      const args: unknown[] = [pid, ...Object.values(where)];
      if (opts.since) { conds.push(`created_at >= ?`); args.push(opts.since); }
      if (opts.before) { conds.push(`created_at < ?`); args.push(opts.before); }
      const order = opts.orderBy ?? "created_at";
      if (!ORDERABLE.has(order) && !(TENANT_TABLES[t] as readonly string[]).includes(order)) throw new Error(`เรียงตาม ${order} ไม่ได้`);
      const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 500)), 2000);
      const offset = Math.max(0, Math.floor(opts.offset ?? 0));
      if (opts.columns) checkCols(t, opts.columns);
      const cols = opts.columns ? [...SYSTEM_COLS, ...opts.columns].map((c) => `"${c}"`).join(", ") : colList(t);
      const sql = `SELECT ${cols} FROM "${t}" WHERE ${conds.join(" AND ")} ORDER BY "${order}" ${opts.desc ? "DESC" : "ASC"} LIMIT ${limit} OFFSET ${offset}`;
      const r = await db.prepare(sql).bind(...args).all<Row>();
      return r.results;
    },

    async count(table: TenantTable, where: Record<string, string | number> = {}): Promise<number> {
      const t = checkTable(table);
      checkCols(t, Object.keys(where));
      const conds = ["project_id = ?", ...Object.keys(where).map((c) => `"${c}" = ?`)];
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE ${conds.join(" AND ")}`).bind(pid, ...Object.values(where)).first<{ n: number }>();
      return Number(r?.n ?? 0);
    },

    /**
     * นับหลายเงื่อนไขในคำสั่งเดียว (หนึ่งรอบไปกลับฐานข้อมูล) ใช้กับตัวเลขเตือนบนเมนู
     * where = เท่ากับ, lt = น้อยกว่า, notIn = ไม่อยู่ในรายการ — ทุกเงื่อนไขอยู่ในโครงการนี้เท่านั้น
     */
    async countMany(specs: CountSpec[]): Promise<number[]> {
      if (!specs.length) return [];
      const parts: string[] = [], args: unknown[] = [];
      for (const sp of specs) {
        const t = checkTable(sp.table);
        const where = sp.where ?? {}, lt = sp.lt ?? {}, notIn = sp.notIn ?? {};
        checkCols(t, [...Object.keys(where), ...Object.keys(lt), ...Object.keys(notIn)]);
        const conds = ["project_id = ?"]; args.push(pid);
        for (const [c, v] of Object.entries(where)) { conds.push(`"${c}" = ?`); args.push(v); }
        for (const [c, v] of Object.entries(lt)) { conds.push(`"${c}" < ?`); args.push(v); }
        for (const [c, vs] of Object.entries(notIn)) { if (vs.length) { conds.push(`"${c}" NOT IN (${vs.map(() => "?").join(",")})`); args.push(...vs); } }
        parts.push(`(SELECT COUNT(*) FROM "${t}" WHERE ${conds.join(" AND ")}) AS c${parts.length}`);
      }
      const r = await db.prepare(`SELECT ${parts.join(", ")}`).bind(...args).first<Record<string, number>>();
      return specs.map((_, i) => Number(r?.[`c${i}`] ?? 0));
    },

    async get(table: TenantTable, id: string): Promise<Row | null> {
      const t = checkTable(table);
      return db.prepare(`SELECT ${colList(t)} FROM "${t}" WHERE id = ? AND project_id = ?`).bind(id, pid).first<Row>();
    },

    async insert(table: TenantTable, data: Record<string, unknown>): Promise<Row> {
      const { stmt, row } = buildInsert(table, data);
      await stmt.run();
      return row;
    },

    async update(table: TenantTable, id: string, patch: Record<string, unknown>): Promise<boolean> {
      const stmt = buildUpdate(table, id, patch);
      if (!stmt) return false;
      const r = await stmt.run();
      return r.meta.changes > 0;
    },

    /**
     * เขียนหลายรายการในรอบเดียว (D1 batch: ทำทั้งชุดหรือไม่ทำเลย) — ลดเวลารอเมื่อฐานข้อมูลอยู่ไกล
     * ชุดใหญ่กว่า 50 รายการถูกแบ่งเป็นหลายชุด (แต่ละชุดยังทำทั้งชุดหรือไม่ทำเลย)
     */
    async batch(ops: BatchOp[]): Promise<Row[]> {
      const stmts: D1Stmt[] = [];
      const rows: Row[] = [];
      for (const op of ops) {
        if (op.kind === "insert") { const b = buildInsert(op.table, op.data, op.id); stmts.push(b.stmt); rows.push(b.row); }
        else { const st = buildUpdate(op.table, op.id, op.patch); if (st) stmts.push(st); }
      }
      for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
      return rows;
    },

    async remove(table: TenantTable, id: string): Promise<boolean> {
      const t = checkTable(table);
      const r = await db.prepare(`DELETE FROM "${t}" WHERE id = ? AND project_id = ?`).bind(id, pid).run();
      return r.meta.changes > 0;
    },

    /** ลบหลายแถวในรอบเดียว (ใช้ตอนย้ายประวัติเก่าไปเก็บถาวร) */
    async removeMany(table: TenantTable, ids: string[]): Promise<void> {
      const t = checkTable(table);
      const stmts = ids.map((id) => db.prepare(`DELETE FROM "${t}" WHERE id = ? AND project_id = ?`).bind(id, pid));
      for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    },

    /** ส่งออกข้อมูลทั้งโครงการ (ลูกค้าส่งออกได้เสมอ) */
    async exportAll(): Promise<Record<TenantTable, Row[]>> {
      const out = {} as Record<TenantTable, Row[]>;
      for (const t of Object.keys(TENANT_TABLES) as TenantTable[]) {
        const rows: Row[] = [];
        for (let off = 0; ; off += 2000) {
          const page = await this.list(t, { limit: 2000, offset: off });
          rows.push(...page);
          if (page.length < 2000) break;
        }
        out[t] = rows;
      }
      return out;
    },
  };
}

export type TenantDb = ReturnType<typeof tenantDb>;
