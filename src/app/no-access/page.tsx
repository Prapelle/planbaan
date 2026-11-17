import Link from "next/link";
import { signOut } from "@/auth";

const MSG: Record<string, string> = {
  no_access: "อีเมลนี้ไม่ได้เป็นสมาชิกของโครงการนี้ ติดต่อเจ้าของโครงการให้เพิ่มคุณ",
  project_closed: "โครงการนี้ปิดการใช้งานแล้ว",
  not_staff: "หน้านี้สำหรับทีม PlanBaan เท่านั้น",
};

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">เข้าไม่ได้</h1>
      <p className="text-slate-700">{MSG[reason ?? ""] ?? MSG.no_access}</p>
      <div className="flex gap-2">
        <Link href="/" className="flex min-h-11 items-center rounded-md border border-slate-300 px-4 font-medium">กลับหน้าหลัก</Link>
        <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
          <button className="min-h-11 rounded-md border border-slate-300 px-4 font-medium">ใช้อีเมลอื่น</button>
        </form>
      </div>
    </main>
  );
}
