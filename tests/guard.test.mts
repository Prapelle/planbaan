// กันการเขียน SQL ถึงตารางข้อมูลโครงการนอก tenant-db.ts (ทางลัดที่อาจลืมกรอง project_id)
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { TENANT_TABLES } from "../src/lib/tenant-db";
import { test } from "./helpers/fake-cf.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const ALLOWED = new Set(["src/lib/tenant-db.ts", "src/lib/backup.ts"]); // backup อ่านทุกตารางทั้งฐานข้อมูลโดยตั้งใจ

function* files(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mts)$/.test(f)) yield p;
  }
}

await test("ไม่มี SQL ถึงตารางโครงการนอก tenant-db.ts", async () => {
  const tables = Object.keys(TENANT_TABLES).join("|");
  const re = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE)\\s+"?(${tables})"?\\b`, "i");
  const bad: string[] = [];
  for (const f of files(join(ROOT, "src"))) {
    const rel = relative(ROOT, f);
    if (ALLOWED.has(rel)) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (re.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(bad, [], "พบ SQL ถึงตารางโครงการนอก tenant-db.ts:\n" + bad.join("\n"));
});

await test("ทุกตารางโครงการใน migrations มี project_id", async () => {
  const sql = readdirSync(join(ROOT, "migrations")).map((f) => readFileSync(join(ROOT, "migrations", f), "utf8")).join("\n");
  for (const t of Object.keys(TENANT_TABLES)) {
    const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    assert.ok(m, `ไม่พบ CREATE TABLE ${t}`);
    assert.match(m![1], /project_id\s+TEXT NOT NULL/, `${t} ต้องมี project_id TEXT NOT NULL`);
    assert.match(sql, new RegExp(`ON ${t}\\(project_id`), `${t} ต้องมี index ที่ขึ้นต้นด้วย project_id`);
  }
});

console.log("guard: ผ่าน");
