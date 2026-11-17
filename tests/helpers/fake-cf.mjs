// Cloudflare D1 / R2 จำลองสำหรับเทสต์
// - D1: SQLite ในหน่วยความจำ (node:sqlite) + รัน migrations/*.sql จริง
// - R2: Map ในหน่วยความจำ
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = new URL("../../migrations/", import.meta.url).pathname;

export function makeD1({ migrate = true } = {}) {
  const raw = new DatabaseSync(":memory:");
  if (migrate) for (const f of readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort()) raw.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  const runSync = (sql, params) => { const r = raw.prepare(sql).run(...params); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; };
  const stmt = (sql, params = []) => ({
    sql, params,
    bind: (...v) => stmt(sql, v),
    all: async () => ({ results: raw.prepare(sql).all(...params).map((r) => ({ ...r })) }),
    first: async () => { const r = raw.prepare(sql).get(...params); return r ? { ...r } : null; },
    run: async () => runSync(sql, params),
    _sync: () => runSync(sql, params),
  });
  const log = [];
  return {
    raw, log,
    prepare: (sql) => { log.push(sql); return stmt(sql); },
    batch: async (stmts) => {
      raw.exec("BEGIN");
      try { const out = stmts.map((s) => s._sync()); raw.exec("COMMIT"); return out; }
      catch (e) { raw.exec("ROLLBACK"); throw e; }
    },
  };
}

export function makeR2() {
  const store = new Map();
  return {
    store,
    put: async (key, value) => { store.set(key, typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)); },
    list: async ({ prefix = "" } = {}) => ({ objects: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }),
    delete: async (keys) => { for (const k of [].concat(keys)) store.delete(k); },
  };
}

export const test = async (name, fn) => {
  try { await fn(); console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name); throw e; }
};

export const rejects = async (p, re) => {
  try { await p; } catch (e) { if (!re.test(String(e.message))) throw new Error(`ข้อความผิดพลาดไม่ตรง: ${e.message}`); return; }
  throw new Error("ควรผิดพลาดแต่ไม่ผิดพลาด: " + re);
};
