import { NextResponse, type NextRequest } from "next/server";
import { requireProject } from "@/lib/context";
import { canExport, canSeeCosts } from "@/lib/roles";
import { TENANT_TABLES, type TenantTable } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";

/** ช่องที่ขึ้นต้นด้วย = + - @ ใส่ ' นำหน้า กันสูตรทำงานเองตอนเปิดใน Excel */
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table") ?? "";
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const ctx = await requireProject({ action: "export", target: table || format });
  if (!canExport(ctx.role)) return new NextResponse("Forbidden", { status: 403 });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${ctx.project.slug}-${table || "all"}-${stamp}`;
  await ctx.usage("export", { table: table || "all" });

  // ต้นทุนและกำไรเป็นข้อมูลลับของเจ้าของ: ผู้จัดการส่งออกได้แต่ไม่ได้ข้อมูลส่วนนี้
  const costsOk = canSeeCosts(ctx.role);
  const COST_TABLES = ["build_costs", "cost_budgets", "cost_settings"];
  const COST_COLS = ["land_cost"];
  if (format === "json") {
    const data = await ctx.db.exportAll() as Record<string, Record<string, unknown>[]>;
    if (!costsOk) {
      for (const t of COST_TABLES) delete data[t];
      data.plots = (data.plots ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !COST_COLS.includes(k))));
    }
    return new NextResponse(JSON.stringify({ project: { slug: ctx.project.slug, name: ctx.project.name }, exported_at: new Date().toISOString(), data }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.json"`, "Cache-Control": "no-store" },
    });
  }
  if (!Object.prototype.hasOwnProperty.call(TENANT_TABLES, table)) return new NextResponse("ไม่รู้จักตาราง", { status: 400 });
  if (!costsOk && COST_TABLES.includes(table)) return new NextResponse("Forbidden", { status: 403 });
  const t = table as TenantTable;
  const cols = ["id", ...TENANT_TABLES[t], "created_at", "updated_at"].filter((c) => costsOk || !COST_COLS.includes(c));
  const rows: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 2000) {
    const page = await ctx.db.list(t, { limit: 2000, offset: off });
    rows.push(...page);
    if (page.length < 2000) break;
  }
  const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" },
  });
}
