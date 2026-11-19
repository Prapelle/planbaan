import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedRedirect } from "@/lib/host";

/**
 * Google Login (ระยะ 0)
 * - ล็อกอินที่โดเมนหลักที่เดียว (Google ไม่รองรับ redirect URI แบบ wildcard subdomain)
 * - คุกกี้ session ตั้งที่ .<BASE_DOMAIN> จึงใช้ได้ทุก subdomain ของโครงการ
 * - ใครก็ล็อกอินได้ถ้าอีเมล Google ยืนยันแล้ว แต่เข้าโครงการได้เฉพาะที่เป็นสมาชิก (ตรวจที่ src/lib/access.ts)
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const base = (process.env.BASE_DOMAIN ?? "").trim().toLowerCase();
  return {
    providers: [Google],
    // ล็อกอินครั้งเดียวอยู่ได้ 30 วัน · สิทธิ์เข้าโครงการยังตรวจจากฐานข้อมูลทุกครั้ง เอาผู้ใช้ออกแล้วเข้าไม่ได้ทันที
    session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
    pages: { signIn: "/login", error: "/login" },
    trustHost: true,
    cookies: base
      ? { sessionToken: { name: "__Secure-authjs.session-token", options: { domain: `.${base}`, path: "/", httpOnly: true, sameSite: "lax", secure: true } } }
      : undefined,
    callbacks: {
      signIn({ account, profile }) {
        return account?.provider === "google" && !!profile?.email && profile.email_verified === true;
      },
      jwt({ token, profile }) {
        if (profile?.email) token.email = profile.email.toLowerCase();
        return token;
      },
      session({ session, token }) {
        if (token.email) session.user.email = String(token.email);
        return session;
      },
      redirect({ url, baseUrl }) {
        return isAllowedRedirect(url, base, baseUrl) ? new URL(url, baseUrl).toString() : baseUrl;
      },
    },
  };
});
