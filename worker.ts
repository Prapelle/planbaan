// จุดเริ่มของ Worker: ใช้ fetch ของ OpenNext ตามเดิม และเพิ่มงานตามเวลา (cron) สำหรับสำรองข้อมูล
// @ts-expect-error: ไฟล์นี้สร้างตอน `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";
import { runBackup } from "./src/lib/backup";

type Env = Record<string, unknown> & { BACKUPS: unknown; BACKUP_RETENTION_DAYS?: string };

export default {
  fetch: handler.fetch,
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      runBackup(env as never, { retentionDays: Number(env.BACKUP_RETENTION_DAYS ?? 30) }).then(
        (r) => console.log("backup ok", JSON.stringify(r)),
        (e) => console.error("backup failed", e),
      ),
    );
  },
};
