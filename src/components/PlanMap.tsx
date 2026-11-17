"use client";
import { useRef, useState } from "react";
import Link from "next/link";

type Pt = { code: string; x: number | null; y: number | null; status: string; label: string };

/**
 * รูปผัง + จุดแปลง
 * โหมดดู: กดจุดเพื่อเปิดรายละเอียดแปลง
 * โหมดวางจุด (คนที่แก้ผังได้): เลือกแปลง แล้วแตะบนรูป → ส่งฟอร์มบันทึกตำแหน่ง แล้วเลือกแปลงถัดไปที่ยังไม่ได้วางให้เอง
 */
export function PlanMap({ src, plots, colors, canEdit, placeAction, selected, imgVersion }: {
  src: string; plots: Pt[]; colors: Record<string, string>; canEdit: boolean;
  placeAction?: (f: FormData) => void | Promise<void>; selected?: string; imgVersion: string;
}) {
  const unplaced = plots.filter((p) => p.x === null);
  const [placing, setPlacing] = useState(false);
  const [code, setCode] = useState(unplaced[0]?.code ?? plots[0]?.code ?? "");
  const form = useRef<HTMLFormElement>(null);
  const xIn = useRef<HTMLInputElement>(null);
  const yIn = useRef<HTMLInputElement>(null);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placing || !code || !form.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    xIn.current!.value = (((e.clientX - r.left) / r.width) * 100).toFixed(2);
    yIn.current!.value = (((e.clientY - r.top) / r.height) * 100).toFixed(2);
    form.current.requestSubmit();
    const next = unplaced.find((p) => p.code !== code);
    if (next) setCode(next.code);
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && placeAction && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <button type="button" onClick={() => setPlacing(!placing)} aria-pressed={placing}
            className={`min-h-11 rounded-md px-4 font-semibold ${placing ? "bg-brand-600 text-white" : "border border-slate-400 bg-white"}`}>
            {placing ? "กำลังวางจุด (กดเพื่อหยุด)" : "วางจุดแปลงบนรูป"}
          </button>
          {placing && (
            <label className="flex flex-col gap-1">แปลงที่จะวาง
              <select value={code} onChange={(e) => setCode(e.target.value)} className="min-h-11 rounded-md border border-slate-300 px-3">
                {plots.map((p) => <option key={p.code} value={p.code}>{p.code}{p.x === null ? " (ยังไม่วาง)" : ""}</option>)}
              </select>
            </label>
          )}
          {placing && <span className="text-slate-600">แตะตำแหน่งของแปลง {code} บนรูป · ยังไม่วาง {unplaced.length} แปลง</span>}
          <form ref={form} action={placeAction} className="hidden">
            <input type="hidden" name="code" value={code} readOnly />
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
