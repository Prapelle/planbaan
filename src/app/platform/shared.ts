import { controlDb, type D1Like, type WorkerEnv } from "@/lib/d1";
import { usageSummary } from "@/lib/usage";
import { rowCountsByProject } from "@/lib/tenant-db";
import { shardBindings } from "@/lib/backup";
import { STATE_LABEL, entitlementOf, type EntState } from "@/lib/entitlement";

/** ข้อมูลระดับบัญชีของทุกโครงการ + สิทธิ์ใช้งาน + ขนาดข้อมูล (จำนวนแถว ไม่อ่านเนื้อหา) */
export async function projectsOverview(env: WorkerEnv) {
  const rows = await usageSummary(controlDb(env));
  const sizes: Record<string, number> = {};
  for (const b of shardBindings(env)) for (const [k, v] of Object.entries(await rowCountsByProject(env[b] as D1Like))) sizes[k] = (sizes[k] ?? 0) + v;
  const list = rows.map((r) => ({ ...r, ent: entitlementOf(r), rows: sizes[r.id] ?? 0 }));
  const counts: Record<string, number> = { total: list.length, active7: list.filter((r) => r.users_7d > 0).length };
  for (const s of Object.keys(STATE_LABEL)) counts[s] = list.filter((r) => r.ent.state === s).length;
  counts.idle = counts.total - counts.active7;
  return { list, counts, totalRows: Object.values(sizes).reduce((a, n) => a + n, 0) };
}

export const ago = (iso: string | null) => {
  if (!iso) return "ยังไม่เคยใช้";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
  return d <= 0 ? "วันนี้" : `${d} วันก่อน`;
};
export const STATE_CLS: Record<EntState, string> = {
  active: "bg-emerald-100 text-emerald-900", expiring: "bg-amber-100 text-amber-900", grace: "bg-red-100 text-red-800", readonly: "bg-red-700 text-white",
};
export const opsInput = "min-h-11 rounded-lg border border-ops-line bg-white px-3 focus-visible:outline-ops-btn";
export const opsBtn = "min-h-11 rounded-lg bg-ops-btn px-4 font-semibold text-white hover:bg-ops-btn-hover";
export const opsBtnLine = "min-h-11 rounded-lg border border-ops-600 bg-white px-4 font-semibold text-ops-900 hover:bg-ops-bg";
export const opsCard = "rounded-xl border border-ops-line bg-white";
