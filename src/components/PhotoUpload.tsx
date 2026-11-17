"use client";
import { useRef, useState, useTransition } from "react";
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

export function PhotoUpload({ action, buildId, stages, defaultStage }: {
  action: (f: FormData) => Promise<{ error?: string }>; buildId: string; stages: { id: string; name: string }[]; defaultStage?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState("");
  const cap = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLSelectElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, 10);
    start(async () => {
      for (let i = 0; i < list.length; i++) {
        setStatus(`กำลังส่งรูป ${i + 1}/${list.length}`);
        const fd = new FormData();
        fd.set("build", buildId);
        fd.set("stage", stage.current?.value ?? "");
        fd.set("caption", cap.current?.value ?? "");
        fd.set("file", await shrink(list[i]), "photo.jpg");
        let r: { error?: string } = {};
        try { r = (await action(fd)) ?? {}; } catch { r = { error: "ส่งรูปไม่สำเร็จ ตรวจสัญญาณเน็ตแล้วลองใหม่" }; }
        if (r.error) { setStatus(`รูปที่ ${i + 1}: ${r.error}`); router.refresh(); return; }
      }
      setStatus(`ส่งรูปแล้ว ${list.length} รูป`);
      router.refresh();
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
      <p className="text-xs text-slate-600">รูปที่ถ่ายยังไม่แสดงให้เจ้าของบ้านเห็นจนกว่าผู้จัดการกดเผยแพร่</p>
    </div>
  );
}
