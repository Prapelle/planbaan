import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Notice, ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { setConstruction } from "@/lib/control";
import { back, baht, errMsg, fv } from "@/lib/form";
import { canManageBuild } from "@/lib/roles";
import * as C from "@/lib/construction";
import * as S from "@/lib/sales";

export const dynamic = "force-dynamic";
const BUILD_PRICE = C.BUILD_PRICE();

async function guardManage(target = "/build") {
  const ctx = await requireProject({ action: "edit", target });
  if (!ctx.project.construction_enabled) back("/build", { error: "ยังไม่ได้เปิดส่วนก่อสร้าง" });
  if (!(canManageBuild(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly)) back(target, { error: "ไม่มีสิทธิ์ตั้งค่างานก่อสร้าง" });
  return ctx;
}

async function createAction(f: FormData) {
  "use server";
  const ctx = await guardManage("/build");
  let id = "";
  try {
    const stages = fv(f, "stages").split("\n").map((s) => s.trim()).filter(Boolean);
    const b = await C.createBuild(ctx.db, {
      title: fv(f, "title"), plotCode: fv(f, "plot"), leadId: fv(f, "lead"), customerName: fv(f, "customer"),
      startDate: fv(f, "start"), dueDate: fv(f, "due"), price: fv(f, "price"), stages,
    }, ctx.email);
    id = String(b.id);
    // รับสร้างบ้าน: เริ่มงานก่อสร้าง → ลูกค้าเลื่อนไปขั้น "ก่อสร้าง"
    const lead = fv(f, "lead");
    if (ctx.project.kind === "builder" && lead) {
      const l = await ctx.db.get("leads", lead);
      if (l && S.stageIdx(String(l.stage)) < S.stageIdx("loan")) await S.moveLead(ctx.db, lead, "loan", ctx.email, { requirePlot: false });
    }
  } catch (e) { back("/build", { error: errMsg(e) }); }
  revalidatePath("/build");
  redirect(`/build/${id}?msg=${encodeURIComponent("สร้างงานก่อสร้างแล้ว ตั้งงวดเงินและกำหนดเสร็จแต่ละงวดได้ด้านล่าง")}`);
}

async function staleAction(f: FormData) {
  "use server";
  const ctx = await guardManage("/build");
  try { await setConstruction(controlDb(ctx.env), ctx.project.id, { staleDays: Number(fv(f, "days")) }); } catch (e) { back("/build", { error: errMsg(e) }); }
  revalidatePath("/build");
  back("/build", { msg: "บันทึกแล้ว" });
}

const thDay = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "-");
const input = "min-h-11 rounded-md border border-slate-300 px-3";

export default async function BuildPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string; lead?: string; show?: string }> }) {
  const ctx = await requireProject({ action: "view", target: "/build" });
  await ctx.usage("page_view", { page: "build" });
  const sp = await searchParams;
  const builder = ctx.project.kind === "builder";
  const title = builder ? "งานก่อสร้าง" : "ก่อสร้าง";

  if (!ctx.project.construction_enabled) {
    return (
      <ProjectShell ctx={ctx} active="/build">
        <h1 className="mb-3 text-2xl font-bold">{title}</h1>
        <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-lg font-semibold">ส่วนก่อสร้างเป็นส่วนเสียเงิน</h2>
          <ul className="mb-3 list-disc pl-5 text-sm text-slate-700">
            <li>งวดงานต่อหลัง โฟร์แมนติ๊กงวดและถ่ายรูปจากมือถือ</li>
            <li>แผนเทียบจริง เตือนหลังที่ช้าหรือไม่มีคนอัปเดต</li>
            <li>งวดเงินที่เก็บจากลูกค้า งานเพิ่ม-ลดพร้อมบันทึกการยืนยันของลูกค้า</li>
            <li>หน้าติดตามของเจ้าของบ้านผ่านลิงก์ส่วนตัว ไม่ต้องล็อกอิน</li>
            <li>สถานะบ้านในผังแปลงอัปเดตเองตามงวดงาน</li>
          </ul>
          <p className="text-sm">ราคา {baht(BUILD_PRICE)} บาทต่อหลังที่กำลังก่อสร้างต่อเดือน (หลังที่ส่งมอบแล้วไม่คิดเงิน) · ติดต่อทีม PlanBaan เพื่อเปิดใช้</p>
        </div>
      </ProjectShell>
    );
  }

  const canManage = canManageBuild(ctx.role, ctx.access.supportCanEdit) && !ctx.readonly;
  const foreman = ctx.role === "foreman";
  const staleDays = Number(ctx.project.build_stale_days ?? 7);
  const [board, plots, leads] = await Promise.all([
    C.buildBoard(ctx.db, staleDays),
    canManage && !builder ? ctx.db.list("plots", { limit: 2000 }) : Promise.resolve([]),
    canManage && builder ? ctx.db.list("leads", { limit: 2000 }) : Promise.resolve([]),
  ]);
  const busy = new Set(board.all.filter((b) => b.build.status !== "done").flatMap((b) => [String(b.build.plot_code), String(b.build.lead_id)]));
  const freePlots = plots.filter((p) => !busy.has(String(p.code))).sort(S.byCode);
  const freeLeads = leads.filter((l) => !busy.has(String(l.id)) && ["booked", "loan"].includes(String(l.stage)));
  const showDone = sp.show === "done";
  const list = board.all.filter((b) => (showDone ? b.build.status === "done" : b.build.status !== "done"));
  const k = board.counts;
  const cards = [
    { label: "กำลังสร้าง", value: String(k.active), note: k.paused ? `หยุดชั่วคราว ${k.paused}` : "" },
    { label: "ช้ากว่าแผน", value: String(k.late), warn: k.late > 0 },
    { label: `ไม่อัปเดตเกิน ${staleDays} วัน`, value: String(k.stale), warn: k.stale > 0 },
    ...(foreman ? [] : [{ label: "งวดเงินรอเก็บ (บาท)", value: baht(k.payDue), warn: k.payDue > 0 }, { label: "งานเพิ่ม-ลดรอยืนยัน", value: String(k.pending) }]),
  ];

  return (
    <ProjectShell ctx={ctx} active="/build">
      <h1 className="mb-1 text-2xl font-bold">{title}</h1>
      <p className="mb-4 text-sm text-slate-600">เรียงหลังที่ต้องดูก่อนไว้บนสุด: ช้ากว่าแผน หรือไม่มีใครอัปเดตเกิน {staleDays} วัน</p>
      <Notice error={sp.error} msg={sp.msg} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-600">{c.label}</div>
            <div className={`text-2xl font-bold ${c.warn ? "text-red-700" : ""}`}>{c.value}</div>
            {c.note && <div className="text-xs text-slate-600">{c.note}</div>}
          </div>
        ))}
      </div>

      <div role="tablist" className="mb-3 flex gap-2 text-sm">
        <Link role="tab" aria-selected={!showDone} href="/build" className={`flex min-h-11 items-center rounded-md px-4 font-semibold ${!showDone ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>ยังไม่ส่งมอบ ({k.active + k.paused})</Link>
        <Link role="tab" aria-selected={showDone} href="/build?show=done" className={`flex min-h-11 items-center rounded-md px-4 font-semibold ${showDone ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>ส่งมอบแล้ว ({k.done})</Link>
      </div>

      <ul className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.length === 0 && <li className="rounded-lg bg-white p-4 text-slate-700">{showDone ? "ยังไม่มีหลังที่ส่งมอบ" : canManage ? "ยังไม่มีงานก่อสร้าง เพิ่มจากกล่องด้านล่าง" : "ยังไม่มีงานก่อสร้าง"}</li>}
        {list.map((s) => {
          const b = s.build;
          return (
            <li key={b.id}>
              <Link href={`/build/${b.id}`} className={`flex h-full flex-col gap-2 rounded-lg border bg-white p-4 hover:border-brand-500 ${s.stale || s.lateDays || s.overdueDays ? "border-red-300" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-semibold">{String(b.title)}</div>
                    <div className="text-xs text-slate-600">{[b.plot_code && `แปลง ${b.plot_code}`, !foreman && b.customer_name].filter(Boolean).join(" · ") || " "}</div></div>
                  <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{C.BUILD_STATUS_LABEL[String(b.status)]}</span>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm"><span>{s.current ? `งวด ${s.current.seq}: ${s.current.name}` : "ครบทุกงวด"}</span><b>{s.pct}%</b></div>
                  <div className="h-2.5 rounded bg-slate-100" aria-hidden="true"><div className="h-2.5 rounded bg-brand-600" style={{ width: `${s.pct}%` }} /></div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className="text-slate-600">ส่งมอบ {thDay(String(b.due_date))}</span>
                  {s.lateDays > 0 && <span className="font-semibold text-red-700">ช้ากว่าแผน {s.lateDays} วัน</span>}
                  {s.overdueDays > 0 && <span className="font-semibold text-red-700">เลยกำหนดส่งมอบ {s.overdueDays} วัน</span>}
                  {b.status !== "done" && <span className={s.stale ? "font-semibold text-red-700" : "text-slate-600"}>อัปเดต{s.idleDays === 0 ? "วันนี้" : ` ${s.idleDays} วันก่อน`}</span>}
                  {!foreman && s.payDue > 0 && <span className="font-semibold text-amber-800">รอเก็บ {baht(s.payDue)} บาท</span>}
                  {!foreman && s.changesPending > 0 && <span className="text-slate-700">งานเพิ่ม-ลดรอยืนยัน {s.changesPending}</span>}
                  {!foreman && s.drawPending > 0 && <span className="text-slate-700">รอเบิกกู้ {s.drawPending} งวด</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {canManage && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <form action={createAction} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 lg:col-span-2">
            <h2 className="font-semibold sm:col-span-2">เพิ่มงานก่อสร้าง</h2>
            {builder ? (
              <label className="flex flex-col gap-1">ลูกค้า (ขั้นเซ็นสัญญา)
                <select name="lead" defaultValue={sp.lead ?? ""} className={input}>
                  <option value="">ไม่ผูกลูกค้า</option>
                  {freeLeads.map((l) => <option key={l.id} value={l.id}>{String(l.name)}</option>)}
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1">แปลง
                <select name="plot" className={input}>
                  <option value="">ไม่ผูกแปลง</option>
                  {freePlots.map((p) => <option key={p.id} value={String(p.code)}>{String(p.code)}{p.house_type ? ` · ${p.house_type}` : ""}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">ชื่องาน (ว่างได้ ระบบตั้งให้)<input name="title" maxLength={120} className={input} /></label>
            <label className="flex flex-col gap-1">ชื่อเจ้าของบ้าน<input name="customer" maxLength={120} className={input} /></label>
            <label className="flex flex-col gap-1">ราคาตามสัญญา (บาท)<input name="price" inputMode="decimal" className={input} /></label>
            <label className="flex flex-col gap-1">วันเริ่ม<input type="date" name="start" required defaultValue={S.bkkDate()} className={input} /></label>
            <label className="flex flex-col gap-1">กำหนดส่งมอบตามสัญญา<input type="date" name="due" required className={input} /></label>
            <label className="flex flex-col gap-1 sm:col-span-2">งวดงาน (บรรทัดละงวด ระบบกระจายกำหนดเสร็จให้เท่า ๆ กัน แก้ทีหลังได้)
              <textarea name="stages" rows={5} defaultValue={C.DEFAULT_STAGES.join("\n")} className="rounded-md border border-slate-300 p-3" />
            </label>
            <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white sm:col-span-2">เพิ่มงาน</button>
          </form>
          <form action={staleAction} className="flex flex-col gap-3 self-start rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h2 className="font-semibold">เตือนหลังที่ไม่อัปเดต</h2>
            <label className="flex flex-col gap-1">เตือนเมื่อไม่มีอัปเดตเกิน (วัน)<input type="number" name="days" min={1} max={60} defaultValue={staleDays} className={input} /></label>
            <button className="min-h-11 rounded-md border border-slate-400 px-4 font-semibold">บันทึก</button>
            <p className="text-xs text-slate-600">นับจากการติ๊กงวด ถ่ายรูป หรือบันทึกหน้างานครั้งล่าสุด · คิดเงิน {baht(BUILD_PRICE)} บาทต่อหลังที่กำลังก่อสร้างต่อเดือน</p>
          </form>
        </div>
      )}
    </ProjectShell>
  );
}
