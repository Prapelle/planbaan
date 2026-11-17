/**
 * หาโครงการจากชื่อโดเมน
 * - <slug>.<BASE_DOMAIN> → โครงการ slug
 * - <BASE_DOMAIN> หรือ www.<BASE_DOMAIN> → หน้าหลัก (ไม่มีโครงการ)
 * - ระหว่างยังไม่มีโดเมน (workers.dev / localhost) และเปิด ALLOW_PROJECT_SWITCH → ใช้ค่าจาก ?project= หรือคุกกี้
 */
export const SLUG_OK = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const RESERVED = new Set(["www", "app", "api", "admin", "platform", "auth", "login", "mail", "static", "assets"]);

export function isValidSlug(s: string) { return SLUG_OK.test(s) && !RESERVED.has(s); }

export type HostResult = { kind: "project"; slug: string } | { kind: "root" } | { kind: "dev" } | { kind: "unknown" };

export function resolveHost(hostRaw: string, baseDomain: string): HostResult {
  const host = hostRaw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const base = baseDomain.trim().toLowerCase().replace(/^\.+|\.$/g, "");
  if (base) {
    if (host === base || host === `www.${base}`) return { kind: "root" };
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1));
      if (!sub.includes(".") && isValidSlug(sub)) return { kind: "project", slug: sub };
      return { kind: "unknown" };
    }
  }
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".workers.dev")) return { kind: "dev" };
  return { kind: "unknown" };
}

/** URL ที่อนุญาตให้ redirect หลังล็อกอิน: โดเมนหลักและ subdomain ของมันเท่านั้น */
export function isAllowedRedirect(url: string, baseDomain: string, currentOrigin: string): boolean {
  try {
    const u = new URL(url, currentOrigin);
    if (u.origin === currentOrigin) return true;
    const base = baseDomain.trim().toLowerCase();
    if (!base || u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === base || h.endsWith(`.${base}`);
  } catch { return false; }
}
