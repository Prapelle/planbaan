// จุดเริ่มของ Worker: ใช้ fetch ของ OpenNext ตามเดิม และเพิ่มงานตามเวลา (cron) สำหรับสำรองข้อมูล
// @ts-expect-error: ไฟล์นี้สร้างตอน `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";
import { runBackup } from "./src/lib/backup";
import { runArchive } from "./src/lib/archive";
import { runOpsArchive } from "./src/lib/ops-archive";

type Env = Record<string, unknown> & { BACKUPS: unknown; BACKUP_RETENTION_DAYS?: string; ARCHIVE_DAYS?: string };

export default {
  fetch: handler.fetch,
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    // สำรองก่อน แล้วค่อยย้ายประวัติเก่า (ข้อมูลที่ย้ายจึงมีอยู่ในชุดสำรองของวันนั้นด้วย) ถ้าสำรองไม่สำเร็จจะไม่ย้าย
    ctx.waitUntil(
      runBackup(env as never, { retentionDays: Number(env.BACKUP_RETENTION_DAYS ?? 30) })
        .then((r) => { console.log("backup ok", JSON.stringify(r)); return runArchive(env as never, { days: Number(env.ARCHIVE_DAYS ?? 365) }); })
        .then((a) => { console.log("archive ok", JSON.stringify(a)); return runOpsArchive(env as never); })
        .then((o) => console.log("ops archive ok", JSON.stringify(o)), (e) => console.error("backup/archive failed", e)),
    );
  },
};
