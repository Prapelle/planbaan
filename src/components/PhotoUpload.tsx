"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * ถ่าย/เลือกรูปหน้างานบนมือถือ: ย่อรูปในเครื่องก่อนส่ง (ด้านยาวสุด 1600px JPEG) ให้อัปโหลดเร็วบนเน็ตมือถือ
 * ย่อไม่ได้ (เบราว์เซอร์เก่า) ส่งไฟล์เดิม
 */
const MAX = 1600;

async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

// ── คิวรูปที่ส่งไม่ผ่าน (เน็ตหลุดหน้างาน): เก็บใน IndexedDB ของเครื่อง ส่งใหม่เองเมื่อมีสัญญาณ ──
type Queued = { id?: number; build: string; stage: string; caption: string; blob: Blob; at: number };
const DB = "planbaan-photos", STORE = "queue";
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((ok, fail) => { const r = fn(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
}
const enqueue = (q: Queued) => tx("readwrite", (s) => s.add(q));
const queued = () => tx<Queued[]>("readonly", (s) => s.getAll() as IDBRequest<Queued[]>).catch(() => [] as Queued[]);
const dequeue = (id: number) => tx("readwrite", (s) => s.delete(id));
/** ส่งไม่ถึงเซิร์ฟเวอร์ (ไม่ใช่เซิร์ฟเวอร์ตอบว่าผิด) */
class Offline extends Error {}
let flushing = false; // ทั้งหน้ามีคิวเดียว

export function PhotoUpload({ action, buildId, stages, defaultStage }: {
  action: (f: FormData) => Promise<{ error?: string }>; buildId: string; stages: { id: string; name: string }[]; defaultStage?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState("");
  const cap = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLSelectElement>(null);
  const [waiting, setWaiting] = useState(0);

  const send = useCallback(async (q: Queued): Promise<{ error?: string }> => {
    const fd = new FormData();
    fd.set("build", q.build); fd.set("stage", q.stage); fd.set("caption", q.caption);
    fd.set("file", q.blob, "photo.jpg");
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Offline();
    try { return (await action(fd)) ?? {}; } catch { throw new Offline(); }
  }, [action]);

  /** ส่งรูปที่ค้างในเครื่อง (ทุกหลัง) ทีละรูป หยุดเมื่อเน็ตยังไม่มา · ล็อกไว้ไม่ให้ส่งซ้อนกันจนรูปซ้ำ */
  const flush = useCallback(async () => {
    if (flushing) return;
    flushing = true;
    let sent = 0;
    try {
      for (const q of await queued()) {
        try {
          const r = await send(q);
          await dequeue(q.id!); // เซิร์ฟเวอร์ตอบแล้ว (สำเร็จหรือรูปใช้ไม่ได้) ไม่ต้องเก็บต่อ
          if (!r.error) sent++;
        } catch { break; }
      }
      setWaiting((await queued()).length);
    } finally { flushing = false; }
    if (sent) { setStatus(`ส่งรูปที่ค้างไว้แล้ว ${sent} รูป`); router.refresh(); }
  }, [send, router]);

  // ส่งค้างตอนเปิดหน้าครั้งแรก และทุกครั้งที่เน็ตกลับมา (ผูกครั้งเดียว ใช้ flush ล่าสุดผ่าน ref)
  const latest = useRef(flush);
  latest.current = flush;
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    latest.current();
    const on = () => { latest.current(); };
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, 10);
    start(async () => {
      let sent = 0, kept = 0;
      for (let i = 0; i < list.length; i++) {
        setStatus(`กำลังส่งรูป ${i + 1}/${list.length}`);
        const q: Queued = { build: buildId, stage: stage.current?.value ?? "", caption: cap.current?.value ?? "", blob: await shrink(list[i]), at: Date.now() };
        try {
          const r = await send(q);
          if (r.error) { setStatus(`รูปที่ ${i + 1}: ${r.error}`); router.refresh(); return; }
          sent++;
        } catch {
          // เน็ตหลุด: เก็บไว้ในเครื่อง ส่งเองเมื่อมีสัญญาณ (ไม่ต้องถ่ายใหม่)
          try { await enqueue(q); kept++; } catch { setStatus("ส่งรูปไม่สำเร็จ และเก็บรูปในเครื่องไม่ได้ ลองใหม่เมื่อมีสัญญาณ"); return; }
        }
      }
      setWaiting((await queued()).length);
      setStatus(kept ? `ส่งแล้ว ${sent} รูป · เก็บไว้ในเครื่อง ${kept} รูป จะส่งเองเมื่อมีสัญญาณ` : `ส่งรูปแล้ว ${sent} รูป`);
      // รีเฟรชเฉพาะเมื่อส่งได้จริง: ตอนออฟไลน์ Next จะโหลดหน้าใหม่ทั้งหน้า แล้วเจอหน้าออฟไลน์ของเบราว์เซอร์
      if (sent) router.refresh();
      if (cap.current) cap.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">งวด
          <select ref={stage} defaultValue={defaultStage} className="min-h-11 rounded-md border border-slate-300 px-3">
            <option value="">ไม่ระบุ</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">คำอธิบาย (ถ้ามี)<input ref={cap} maxLength={200} placeholder="เช่น เทพื้นชั้นล่าง" className="min-h-11 rounded-md border border-slate-300 px-3" /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center rounded-md bg-slate-900 px-4 font-semibold text-white ${pending ? "opacity-60" : ""}`}>
          ถ่ายรูป
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={pending} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </label>
        <label className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center rounded-md border border-slate-400 bg-white px-4 font-semibold ${pending ? "opacity-60" : ""}`}>
          เลือกจากเครื่อง (ได้ถึง 10 รูป)
          <input type="file" accept="image/*" multiple className="sr-only" disabled={pending} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      <p aria-live="polite" className="text-slate-700">{status}</p>
      {waiting > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900">
          <span>รอส่ง {waiting} รูป (เก็บไว้ในเครื่องนี้ ส่งเองเมื่อมีสัญญาณ อย่าล้างข้อมูลเบราว์เซอร์)</span>
          <button type="button" onClick={() => start(flush)} disabled={pending} className="min-h-10 rounded-md border border-amber-700 px-3 font-semibold">ส่งตอนนี้</button>
        </div>
      )}
      <p className="text-xs text-slate-600">รูปที่ถ่ายยังไม่แสดงให้เจ้าของบ้านเห็นจนกว่าผู้จัดการกดเผยแพร่</p>
    </div>
  );
}
