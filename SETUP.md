# ติดตั้ง PlanBaan บน Cloudflare (ครั้งแรก)

ทำผ่านหน้าเว็บ Cloudflare และ Google ทั้งหมด ไม่ต้องติดตั้งโปรแกรมในเครื่อง

## 1. สร้างฐานข้อมูลและที่เก็บไฟล์

1. Cloudflare Dashboard → **Storage & Databases → D1** → Create database ชื่อ `planbaan-db`
2. คัดลอก **Database ID** ไปแทน `REPLACE_WITH_D1_ID` ใน `wrangler.jsonc` แล้ว commit
3. **R2** → Create bucket ชื่อ `planbaan-backups`

## 2. สร้างตาราง

เลือกทางใดทางหนึ่ง:

- **อัตโนมัติ:** คำสั่ง `npm run deploy` รัน `wrangler d1 migrations apply` ก่อน deploy ทุกครั้ง ถ้า token ของ Workers Builds มีสิทธิ์ D1 จะสร้างตารางเอง
- **ทำเอง:** D1 → `planbaan-db` → **Console** → วางเนื้อหาไฟล์ `migrations/0001_init.sql` แล้วกด Execute

## 3. สร้าง Google OAuth Client

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID** (Web application)
2. Authorized redirect URI:
   - ระหว่างใช้ workers.dev: `https://planbaan.<บัญชี>.workers.dev/api/auth/callback/google`
   - เมื่อมีโดเมนแล้ว: `https://<โดเมนหลัก>/api/auth/callback/google` (ใส่เฉพาะโดเมนหลัก ไม่ต้องใส่ subdomain ของโครงการ เพราะล็อกอินที่โดเมนหลักที่เดียว)
3. แอป OAuth ต้องอยู่สถานะ **In production** เพื่อให้ลูกค้าภายนอกล็อกอินได้

## 4. เชื่อม GitHub กับ Cloudflare

1. Workers & Pages → Create → **Import a repository** → เลือก `planbaan`
2. Build command: เว้นว่าง · Deploy command: `npm run deploy` (คำสั่งนี้สร้างตาราง build และ deploy ในตัว)
3. Settings → **Variables and Secrets** เพิ่มค่าลับ:

| ชื่อ | ค่า |
|---|---|
| `AUTH_SECRET` | ข้อความสุ่มยาว 32 ตัวขึ้นไป |
| `AUTH_GOOGLE_ID` | Client ID จากข้อ 3 |
| `AUTH_GOOGLE_SECRET` | Client secret จากข้อ 3 |
| `USAGE_SALT` | ข้อความสุ่มอีกชุด (ใช้ hash ผู้ใช้ในสถิติ ห้ามเปลี่ยนภายหลัง) |
| `INITIAL_ADMIN_EMAIL` | อีเมลของคุณ เพื่อเข้า `/platform` ครั้งแรก |

## 5. ใช้งานครั้งแรก

1. เปิด `https://planbaan.<บัญชี>.workers.dev/platform` แล้วล็อกอินด้วยอีเมลจาก `INITIAL_ADMIN_EMAIL`
2. สร้างโครงการทดลอง ใส่อีเมลเจ้าของโครงการ
3. ระหว่างยังไม่มีโดเมน กดชื่อโครงการในหน้า `/platform` หรือหน้าแรก เพื่อเข้าโครงการ (ระบบจำโครงการที่เลือกด้วยคุกกี้)

## 6. เมื่อซื้อโดเมนแล้ว

1. เพิ่มโดเมนใน Cloudflare แล้วตั้ง **Custom Domains** ของ Worker เป็น `<โดเมน>` และ route `*.<โดเมน>/*`
2. ใน `wrangler.jsonc` ตั้ง `BASE_DOMAIN` เป็นโดเมน และ `ALLOW_PROJECT_SWITCH` เป็น `"false"`
3. แก้ redirect URI ของ Google ตามข้อ 3
4. ทีม PlanBaan เพิ่มได้ในตาราง `platform_staff` (role `admin` หรือ `support`) ผ่าน D1 Console
