"use client";
import { useMemo, useState, useTransition } from "react";

export type Field = { key: string; label: string; required?: boolean; guess: string[]; example: string };
type Report = { added: number; updated: number; skipped: { row: number; reason: string }[]; notes: { row: number; reason: string }[]; error?: string };

/** อ่าน CSV (คั่นด้วย , หรือแท็บ รองรับเครื่องหมายคำพูด) */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const first = s.split("\n", 1)[0];
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? "" : String(v)).trim();
const norm = (s: string) => s.toLowerCase().replace(/[\s_.\-()]/g, "");

export function ImportWizard({ fields, action, sampleName }: {
  fields: Field[]; action: (json: string) => Promise<Report>; sampleName: string;
}) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Record<string, number>>({});
  const [err, setErr] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [pending, start] = useTransition();

  async function onFile(f: File | undefined) {
    setErr(""); setReport(null); setTable(null);
    if (!f) return;
    try {
      let rows: string[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        rows = (await readSheet(f)).map((r) => r.map(str));
      } else if (/\.(csv|txt|tsv)$/i.test(f.name)) rows = parseCsv(await f.text()).map((r) => r.map(str));
      else { setErr("รองรับไฟล์ .xlsx หรือ .csv (ไฟล์ .xls แบบเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx ก่อน)"); return; }
      rows = rows.filter((r) => r.some((c) => c !== ""));
      if (rows.length < 2) { setErr("ไฟล์ต้องมีแถวหัวตารางและข้อมูลอย่างน้อย 1 แถว"); return; }
      const head = rows[0].map(norm);
      const guess: Record<string, number> = {};
      for (const fd of fields) {
        const i = head.findIndex((h) => h && fd.guess.some((g) => h === norm(g) || h.includes(norm(g))));
        if (i >= 0 && !Object.values(guess).includes(i)) guess[fd.key] = i;
      }
      setFileName(f.name); setTable(rows); setMap(guess);
    } catch { setErr("อ่านไฟล์ไม่ได้ ตรวจว่าเป็นไฟล์ Excel หรือ CSV ที่เปิดได้ตามปกติ"); }
  }

  const header = table?.[0] ?? [];
  const body = useMemo(() => (table ?? []).slice(1), [table]);
  const mapped = useMemo(() => body.map((r) => Object.fromEntries(fields.filter((f) => map[f.key] !== undefined).map((f) => [f.key, r[map[f.key]] ?? ""]))), [body, map, fields]);
  const missing = fields.filter((f) => f.required && map[f.key] === undefined);

  function submit() {
    start(async () => {
      try { setReport(await action(JSON.stringify(mapped))); } catch { setReport({ added: 0, updated: 0, skipped: [], notes: [], error: "ส่งข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" }); }
    });
  }
  const sample = "﻿" + [fields.map((f) => f.label).join(","), fields.map((f) => f.example).join(",")].join("\r\n");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <label className="flex flex-col gap-1 font-semibold">1. เลือกไฟล์ Excel (.xlsx) หรือ CSV
          <input type="file" accept=".xlsx,.csv,.txt,.tsv" onChange={(e) => onFile(e.target.files?.[0])} className="min-h-11 rounded-md border border-slate-300 p-2 font-normal" />
        </label>
        <p className="text-xs text-slate-600">ใช้ชีตแรกของไฟล์ แถวแรกต้องเป็นหัวตาราง · <a download={`${sampleName}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(sample)}`} className="font-medium text-brand-700 underline">ดาวน์โหลดไฟล์ตัวอย่าง</a></p>
        {err && <p role="alert" className="rounded-md bg-red-50 p-2 text-red-700">{err}</p>}
      </div>

      {table && !report && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">2. จับคู่คอลัมน์ · {fileName} มี {body.length.toLocaleString("th-TH")} แถว</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">{f.label}{f.required && <span className="text-red-700"> *</span>}
                <select value={map[f.key] ?? ""} onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === "") delete n[f.key]; else n[f.key] = Number(e.target.value); return n; })}
                  className={`min-h-11 rounded-md border px-2 ${map[f.key] === undefined && f.required ? "border-red-400" : "border-slate-300"}`}>
                  <option value="">ไม่ใช้</option>
                  {header.map((h, i) => <option key={i} value={i}>{h || `คอลัมน์ ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <h2 className="mt-2 font-semibold">3. ตรวจตัวอย่าง 5 แถวแรก</h2>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[560px] text-xs">
              <thead><tr className="bg-slate-50 text-left">{fields.filter((f) => map[f.key] !== undefined).map((f) => <th key={f.key} className="p-2 font-semibold">{f.label}</th>)}</tr></thead>
              <tbody>{mapped.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-slate-100">{fields.filter((f) => map[f.key] !== undefined).map((f) => <td key={f.key} className="p-2">{r[f.key]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {missing.length > 0 && <p className="text-red-700">เลือกคอลัมน์ของ {missing.map((f) => f.label).join(", ")} ก่อน</p>}
          <button onClick={submit} disabled={pending || missing.length > 0 || body.length === 0}
            className="min-h-12 rounded-md bg-brand-600 px-4 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {pending ? "กำลังนำเข้า…" : `นำเข้า ${body.length.toLocaleString("th-TH")} แถว`}
          </button>
        </div>
      )}

      {report && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          {report.error ? <p className="font-semibold text-red-700">{report.error}</p> : (
            <p className="text-base font-semibold text-emerald-800">นำเข้าแล้ว {report.added} รายการ{report.updated ? ` · อัปเดต ${report.updated} รายการ` : ""}{report.skipped.length ? ` · ข้าม ${report.skipped.length} แถว` : ""}</p>
          )}
          {report.notes.length > 0 && (
            <details open><summary className="cursor-pointer font-semibold text-amber-800">นำเข้าแต่มีการปรับ {report.notes.length} แถว</summary>
              <ul className="mt-1 list-disc pl-5">{report.notes.slice(0, 100).map((n, i) => <li key={i}>แถว {n.row}: {n.reason}</li>)}</ul></details>
          )}
          {report.skipped.length > 0 && (
            <details open><summary className="cursor-pointer font-semibold text-red-700">แถวที่ข้าม {report.skipped.length} แถว</summary>
              <ul className="mt-1 list-disc pl-5">{report.skipped.slice(0, 100).map((n, i) => <li key={i}>แถว {n.row}: {n.reason}</li>)}</ul></details>
          )}
          <button onClick={() => { setReport(null); setTable(null); }} className="min-h-11 self-start rounded-md border border-slate-300 px-4 font-semibold">นำเข้าไฟล์อื่น</button>
        </div>
      )}
    </div>
  );
}
