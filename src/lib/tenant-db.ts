/**
 * ชั้นข้อมูลของโครงการ (tenant) — ทางเดียวที่โค้ดอ่าน/เขียนตารางข้อมูลโครงการ
 *
 * กติกา (ห้ามละเมิด เพราะลูกค้าแต่ละโครงการเป็นคู่แข่งกัน):
 * 1. ทุกคำสั่งมี `project_id = ?` เสมอ ผูกกับโครงการตอนสร้าง tenantDb() เปลี่ยนภายหลังไม่ได้
 * 2. ใช้ได้เฉพาะตารางและคอลัมน์ที่ประกาศใน TENANT_TABLES (กัน SQL injection และกันอ่านตารางระบบ)
 * 3. ห้ามเขียน SQL ถึงตารางเหล่านี้ที่ไฟล์อื่น — tests/guard.test.mts ตรวจให้
 * เพิ่มตารางใหม่: เพิ่มใน migrations/ แล้วประกาศคอลัมน์ที่นี่
 */
import { type D1Like, nowIso } from "./d1";

export const TENANT_TABLES = {
  plots: ["code", "zone", "house_type", "price", "house_status", "sale_status"],
  leads: ["name", "phone", "channel", "stage", "plot_code", "owner_email", "last_contact_at", "note", "next_follow_at"],
  lead_activity: ["lead_id", "kind", "from_stage", "to_stage", "note", "actor"],
} as const;

/**
 * จำนวนแถวของแต่ละโครงการ (สำหรับ back office วัดขนาดข้อมูล) — คืนแค่ตัวเลข ไม่มีเนื้อหา
 * อ่านข้ามโครงการโดยตั้งใจ จึงอยู่ในไฟล์นี้ที่เดียว
 */
export async function rowCountsByProject(db: D1Like): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of Object.keys(TENANT_TABLES)) {
    const r = await db.prepare(`SELECT project_id, COUNT(*) AS n FROM "${t}" GROUP BY project_id`).all<{ project_id: string; n: number }>();
    for (const x of r.results) out[x.project_id] = (out[x.project_id] ?? 0) + Number(x.n);
  }
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

export type ListOpts = { where?: Record<string, string | number>; orderBy?: string; desc?: boolean; limit?: number; offset?: number };

export function tenantDb(db: D1Like, projectId: string) {
  if (!projectId) throw new Error("ต้องระบุ projectId");
  const pid = projectId;

  return {
    projectId: pid,

    async list(table: TenantTable, opts: ListOpts = {}): Promise<Row[]> {
      const t = checkTable(table);
      const where = opts.where ?? {};
      checkCols(t, Object.keys(where));
      const conds = ["project_id = ?", ...Object.keys(where).map((c) => `"${c}" = ?`)];
      const order = opts.orderBy ?? "created_at";
      if (!ORDERABLE.has(order) && !(TENANT_TABLES[t] as readonly string[]).includes(order)) throw new Error(`เรียงตาม ${order} ไม่ได้`);
      const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 500)), 2000);
      const offset = Math.max(0, Math.floor(opts.offset ?? 0));
      const sql = `SELECT ${colList(t)} FROM "${t}" WHERE ${conds.join(" AND ")} ORDER BY "${order}" ${opts.desc ? "DESC" : "ASC"} LIMIT ${limit} OFFSET ${offset}`;
      const r = await db.prepare(sql).bind(pid, ...Object.values(where)).all<Row>();
      return r.results;
    },

    async count(table: TenantTable, where: Record<string, string | number> = {}): Promise<number> {
      const t = checkTable(table);
      checkCols(t, Object.keys(where));
      const conds = ["project_id = ?", ...Object.keys(where).map((c) => `"${c}" = ?`)];
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE ${conds.join(" AND ")}`).bind(pid, ...Object.values(where)).first<{ n: number }>();
      return Number(r?.n ?? 0);
    },

    async get(table: TenantTable, id: string): Promise<Row | null> {
      const t = checkTable(table);
      return db.prepare(`SELECT ${colList(t)} FROM "${t}" WHERE id = ? AND project_id = ?`).bind(id, pid).first<Row>();
    },

    async insert(table: TenantTable, data: Record<string, unknown>): Promise<Row> {
      const t = checkTable(table);
      const keys = Object.keys(data);
      checkCols(t, keys); // project_id / id ส่งมาไม่ได้: ถูกปฏิเสธที่นี่
      const now = nowIso();
      const row = { id: crypto.randomUUID(), project_id: pid, created_at: now, updated_at: now, ...data } as Row;
      const cols = ["id", "project_id", "created_at", "updated_at", ...keys];
      await db
        .prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .bind(...cols.map((c) => row[c]))
        .run();
      return row;
    },

    async update(table: TenantTable, id: string, patch: Record<string, unknown>): Promise<boolean> {
      const t = checkTable(table);
      const keys = Object.keys(patch);
      if (!keys.length) return false;
      checkCols(t, keys);
      const sets = [...keys.map((c) => `"${c}" = ?`), `"updated_at" = ?`];
      const r = await db
        .prepare(`UPDATE "${t}" SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`)
        .bind(...keys.map((k) => patch[k]), nowIso(), id, pid)
        .run();
      return r.meta.changes > 0;
    },

    async remove(table: TenantTable, id: string): Promise<boolean> {
      const t = checkTable(table);
      const r = await db.prepare(`DELETE FROM "${t}" WHERE id = ? AND project_id = ?`).bind(id, pid).run();
      return r.meta.changes > 0;
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
