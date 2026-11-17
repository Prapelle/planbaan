import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ProjectShell } from "@/components/ProjectShell";
import { requireProject } from "@/lib/context";
import { controlDb } from "@/lib/d1";
import { listMembers, removeMember, upsertMember } from "@/lib/control";
import { PROJECT_ROLES, ROLE_LABEL, canManageMembers } from "@/lib/roles";

export const dynamic = "force-dynamic";

async function guard() {
  const ctx = await requireProject({ action: "members" });
  if (!canManageMembers(ctx.role)) redirect("/");
  return ctx;
}

async function addAction(form: FormData) {
  "use server";
  const ctx = await guard();
  try {
    await upsertMember(controlDb(ctx.env), ctx.project.id, String(form.get("email") ?? ""), String(form.get("role") ?? ""));
    await ctx.usage("member_added");
  } catch (e) { redirect(`/members?error=${encodeURIComponent((e as Error).message)}`); }
  revalidatePath("/members");
  redirect("/members");
}

async function removeAction(form: FormData) {
  "use server";
  const ctx = await guard();
  try {
    await removeMember(controlDb(ctx.env), ctx.project.id, String(form.get("email") ?? ""));
    await ctx.usage("member_removed");
  } catch (e) { redirect(`/members?error=${encodeURIComponent((e as Error).message)}`); }
  revalidatePath("/members");
  redirect("/members");
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await guard();
  const { error } = await searchParams;
  const members = await listMembers(controlDb(ctx.env), ctx.project.id);
  return (
    <ProjectShell ctx={ctx} active="/members">
      <h1 className="mb-1 text-2xl font-bold">ผู้ใช้ในโครงการ</h1>
      <p className="mb-4 text-sm text-slate-600">เพิ่มด้วยอีเมล Google ของแต่ละคน ไม่จำกัดจำนวนผู้ใช้</p>
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form action={addAction} className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">อีเมล
          <input name="email" type="email" required className="min-h-11 rounded-md border border-slate-300 px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">บทบาท
          <select name="role" defaultValue="sales" className="min-h-11 rounded-md border border-slate-300 px-3">
            {PROJECT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <button className="min-h-11 rounded-md bg-brand-600 px-4 font-semibold text-white">เพิ่ม / เปลี่ยนบทบาท</button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="text-left text-slate-600"><th className="p-3 font-medium">อีเมล</th><th className="p-3 font-medium">บทบาท</th><th className="p-3" /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.email} className="border-t border-slate-200">
                <td className="p-3">{m.email}</td>
                <td className="p-3">{ROLE_LABEL[m.role]}</td>
                <td className="p-3 text-right">
                  <form action={removeAction}>
                    <input type="hidden" name="email" value={m.email} />
                    <button className="min-h-10 rounded-md border border-slate-300 px-3 text-sm">นำออก</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ProjectShell>
  );
}
