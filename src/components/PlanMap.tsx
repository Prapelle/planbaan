"use client";
import { useRef, useState } from "react";
import Link from "next/link";

type Pt = { code: string; x: number | null; y: number | null; status: string; label: string };

/**
 * รูปผัง + จุดแปลง
 * โหมดดู: กดจุดเพื่อเปิดรายละเอียดแปลง
 * โหมดวางจุด (คนที่แก้ผังได้): เลือกแปลง แล้วแตะบนรูป → ส่งฟอร์มบันทึกตำแหน่ง แล้วเลือกแปลงถัดไปที่ยังไม่ได้วางให้เอง
 * ยังไม่มีแปลง/ไม่มีเลขที่ต้องการ: พิมพ์เลขแปลงใหม่ ระบบสร้างแปลงพร้อมวางจุด แล้วเลื่อนเลขถัดไปให้ (A01 → A02)
 */
const nextCode = (c: string) => {
  const m = /^(.*?)(\d+)$/.exec(c.trim().toUpperCase());
  return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, "0") : "";
};
export function PlanMap({ src, plots, colors, canEdit, placeAction, selected, imgVersion, startPlacing, initialNew }: {
  src: string; plots: Pt[]; colors: Record<string, string>; canEdit: boolean;
  placeAction?: (f: FormData) => void | Promise<void>; selected?: string; imgVersion: string;
  startPlacing?: boolean; initialNew?: string;
}) {
  const unplaced = plots.filter((p) => p.x === null);
  const [placing, setPlacing] = useState(!!startPlacing && canEdit);
  const [code, setCode] = useState(unplaced[0]?.code ?? plots[0]?.code ?? "");
  const [newCode, setNewCode] = useState(initialNew ?? (plots.length ? "" : "A01"));
  const target = newCode.trim().toUpperCase() || code;
  const form = useRef<HTMLFormElement>(null);
  const xIn = useRef<HTMLInputElement>(null);
  const yIn = useRef<HTMLInputElement>(null);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placing || !target || !form.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    xIn.current!.value = (((e.clientX - r.left) / r.width) * 100).toFixed(2);
    yIn.current!.value = (((e.clientY - r.top) / r.height) * 100).toFixed(2);
    form.current.requestSubmit();
    if (newCode.trim()) {
      // สร้างแปลงใหม่ต่อเนื่อง: เลื่อนเลขให้ ข้ามเลขที่มีอยู่แล้ว
      let n = nextCode(newCode);
      while (n && plots.some((p) => p.code === n)) n = nextCode(n);
      setNewCode(n);
    } else {
      const next = unplaced.find((p) => p.code !== code);
      if (next) setCode(next.code);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && placeAction && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <button type="button" onClick={() => setPlacing(!placing)} aria-pressed={placing}
            className={`min-h-11 rounded-md px-4 font-semibold ${placing ? "bg-brand-600 text-white" : "border border-slate-400 bg-white"}`}>
            {placing ? "กำลังวางจุด (กดเพื่อหยุด)" : "วางจุดแปลงบนรูป"}
          </button>
          {placing && plots.length > 0 && (
            <label className="flex flex-col gap-1">แปลงที่มีอยู่
              <select value={code} disabled={!!newCode.trim()} onChange={(e) => setCode(e.target.value)} className="min-h-11 rounded-md border border-slate-300 px-3 disabled:opacity-50">
                {plots.map((p) => <option key={p.code} value={p.code}>{p.code}{p.x === null ? " (ยังไม่วาง)" : ""}</option>)}
              </select>
            </label>
          )}
          {placing && (
            <label className="flex flex-col gap-1">{plots.length ? "หรือพิมพ์เลขแปลงใหม่" : "เลขแปลง"}
              <input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} maxLength={12} placeholder="เช่น A01" autoCapitalize="characters"
                className="min-h-11 w-32 rounded-md border border-slate-300 px-3 font-semibold uppercase" />
            </label>
          )}
          {placing && <span className="text-slate-600">แตะตำแหน่งของแปลง <b>{target || "…"}</b> บนรูป{newCode.trim() && !plots.some((p) => p.code === target) ? " (สร้างแปลงใหม่)" : ""}{plots.length ? ` · ยังไม่วาง ${unplaced.length} แปลง` : ""}</span>}
          {placing && plots.length === 0 && (
            <p role="note" className="w-full rounded-md bg-amber-50 px-3 py-2 text-amber-900">
              ยังไม่มีแปลงในระบบ พิมพ์เลขแปลงแล้วแตะบนรูป ระบบจะสร้างแปลงให้และเลื่อนเลขถัดไปให้เอง (A01 → A02) ถ้าจะสร้างหลายแปลงพร้อมกัน ใช้แท็บ &quot;แบบตาราง&quot;
            </p>
          )}
          <form ref={form} action={placeAction} className="hidden">
            <input type="hidden" name="code" value={code} readOnly />
            <input type="hidden" name="new_code" value={newCode.trim()} readOnly />
            <input ref={xIn} type="hidden" name="x" /><input ref={yIn} type="hidden" name="y" />
          </form>
        </div>
      )}
      <div className={`relative w-full select-none overflow-hidden rounded-md border border-slate-200 ${placing ? "cursor-crosshair" : ""}`} onClick={onClick}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${src}?v=${imgVersion}`} alt="รูปผังโครงการ" className="block h-auto w-full" draggable={false} />
        {plots.filter((p) => p.x !== null).map((p) => {
          const style = { left: `${p.x}%`, top: `${p.y}%` };
          const cls = `absolute flex min-h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border px-1 text-[11px] font-bold shadow ${colors[p.status] ?? ""} ${selected === p.code ? "ring-4 ring-brand-500" : ""}`;
          return placing
            ? <span key={p.code} style={style} className={`${cls} pointer-events-none opacity-80`}>{p.code}</span>
            : <Link key={p.code} href={`/plots?view=map&plot=${p.code}`} style={style} aria-label={`แปลง ${p.code} ${p.label}`} className={cls} onClick={(e) => e.stopPropagation()}>{p.code}</Link>;
        })}
      </div>
    </div>
  );
}
