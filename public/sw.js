// Service worker ของ PlanBaan: ไม่เก็บข้อมูลลูกค้าไว้ในเครื่อง (ข้อมูลเปลี่ยนตลอดและเป็นข้อมูลส่วนบุคคล)
// ทำแค่ให้ติดตั้งเป็นแอปได้ และแสดงหน้าออฟไลน์เมื่อไม่มีสัญญาณ
const OFFLINE = "/offline.html";
const CACHE = "planbaan-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // ไฟล์อื่นให้เบราว์เซอร์จัดการตามปกติ
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
