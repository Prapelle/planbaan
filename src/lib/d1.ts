/**
 * ชนิดข้อมูลขั้นต่ำของ Cloudflare D1 ที่โค้ดใช้ (ให้เทสต์ใส่ SQLite จำลองแทนได้)
 * และตัวช่วยดึง binding จาก env ของ Worker
 */
export type D1Meta = { last_row_id: number; changes: number };
export type D1Stmt = {
  bind(...v: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: D1Meta }>;
};
export type D1Like = { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<{ meta: D1Meta }[]> };

export type R2ObjectLike = { key: string; uploaded?: Date };
export type R2Like = {
  put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: unknown): Promise<unknown>;
  list(opts?: { prefix?: string; cursor?: string; delimiter?: string }): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string; delimitedPrefixes?: string[] }>;
  delete(keys: string | string[]): Promise<void>;
};

export type WorkerEnv = Record<string, unknown> & { DB: D1Like; BACKUPS?: R2Like };

/** ชื่อ binding ของฐานข้อมูลต้องเป็น DB หรือ DB_<ตัวเลข/ตัวอักษร> เท่านั้น */
export const SHARD_OK = /^DB(_[A-Z0-9]{1,16})?$/;

let testEnv: WorkerEnv | undefined;
/** ใช้ในเทสต์เท่านั้น */
export function setEnvForTest(env: WorkerEnv | undefined) { testEnv = env; }

export async function getEnv(): Promise<WorkerEnv> {
  if (testEnv) return testEnv;
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  return getCloudflareContext().env as unknown as WorkerEnv;
}

/** ฐานข้อมูลระบบ (projects, memberships ฯลฯ) อยู่ที่ DB เสมอ */
export function controlDb(env: WorkerEnv): D1Like {
  if (!env.DB) throw new Error("ไม่พบ D1 binding ชื่อ DB");
  return env.DB;
}

/** ฐานข้อมูลที่เก็บข้อมูลของโครงการ ตาม projects.shard */
export function shardDb(env: WorkerEnv, shard: string): D1Like {
  if (!SHARD_OK.test(shard)) throw new Error(`ชื่อ shard ไม่ถูกต้อง: ${shard}`);
  const db = env[shard] as D1Like | undefined;
  if (!db) throw new Error(`ไม่พบ D1 binding ชื่อ ${shard} — เพิ่มใน wrangler.jsonc ก่อนย้ายโครงการ`);
  return db;
}

export const nowIso = () => new Date().toISOString();
