import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAllowedRedirect } from "@/lib/host";
import { auth, signIn } from "@/auth";
import { cfg, where } from "@/lib/context";
import { LegalLinks } from "@/components/LegalPage";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const { error, callbackUrl } = await searchParams;
  const w = await where();
  const base = cfg().baseDomain;
  // ล็อกอินที่โดเมนหลักเท่านั้น: จาก subdomain ส่งไปโดเมนหลักแล้วพากลับมา
  if (w.kind === "project" && base) {
    redirect(`https://${base}/login?callbackUrl=${encodeURIComponent(`https://${w.slug}.${base}/`)}`);
  }
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
  const next = callbackUrl && isAllowedRedirect(callbackUrl, base, origin) ? callbackUrl : "/";
  const session = await auth();
  if (session?.user?.email) redirect(next);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <div className="text-sm font-semibold tracking-wide text-slate-500">PlanBaan</div>
        <h1 className="text-2xl font-bold">แผนบ้าน</h1>
        <p className="text-sm text-slate-600">เข้าสู่ระบบด้วยบัญชี Google</p>
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
      <form action={async () => { "use server"; await signIn("google", { redirectTo: next }); }}>
        <button className="flex min-h-12 w-full items-center justify-center rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">เข้าสู่ระบบด้วย Google</button>
      </form>
      <p className="text-xs text-slate-600">ระบบใช้เฉพาะชื่อ อีเมล และรูปโปรไฟล์จากบัญชี Google เพื่อเข้าสู่ระบบ</p>
      <LegalLinks />
    </main>
  );
}
