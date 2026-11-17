import type { Metadata } from "next";
import { LegalPage, legal } from "@/components/LegalPage";

export const metadata: Metadata = { title: "นโยบายความเป็นส่วนตัว · PlanBaan" };
export const dynamic = "force-dynamic";

/** หน้าสาธารณะ ไม่ต้องล็อกอิน (Google ใช้ตรวจตอน publish OAuth) — เนื้อหาต้องตรงกับการทำงานจริงของระบบ */
export default function PrivacyPage() {
  const { operator, contact } = legal();
  const mail = contact ? <a href={`mailto:${contact}`} className="underline">{contact}</a> : "ผ่านพนักงานที่ดูแลโครงการของคุณ";
  return (
    <LegalPage title="นโยบายความเป็นส่วนตัว">
      <p>PlanBaan (แผนบ้าน) เป็นระบบติดตามการตลาด การขาย สินเชื่อ และการก่อสร้างสำหรับเจ้าของโครงการบ้านและบริษัทรับสร้างบ้าน ให้บริการโดย {operator} (&quot;เรา&quot;) นโยบายนี้อธิบายว่าเราเก็บและใช้ข้อมูลส่วนบุคคลอย่างไร ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562</p>

      <h2>1. ข้อมูลจากบัญชี Google ของผู้ใช้ระบบ</h2>
      <p>ผู้ใช้ระบบ (พนักงานของโครงการ) เข้าสู่ระบบด้วยบัญชี Google เราได้รับเฉพาะ <b>ชื่อ อีเมล และรูปโปรไฟล์</b> และใช้เพื่อยืนยันตัวตนและตรวจว่าอีเมลนั้นมีสิทธิ์ในโครงการใดเท่านั้น</p>
      <ul>
        <li>เราไม่ขอสิทธิ์เข้าถึง Gmail, Google Drive, ปฏิทิน, รายชื่อติดต่อ หรือข้อมูลอื่นในบัญชี Google</li>
        <li>เราไม่ขาย ไม่ให้เช่า และไม่ส่งต่อข้อมูลจากบัญชี Google ให้บุคคลอื่น และไม่ใช้เพื่อโฆษณา</li>
        <li>การใช้ข้อมูลที่ได้รับจาก Google API เป็นไปตาม Google API Services User Data Policy รวมถึงข้อกำหนด Limited Use</li>
      </ul>

      <h2>2. ข้อมูลที่เราเก็บ</h2>
      <table>
        <thead><tr><th>ข้อมูล</th><th>ใช้เพื่อ</th><th>เก็บนาน</th></tr></thead>
        <tbody>
          <tr><td>อีเมลและบทบาทของผู้ใช้ในโครงการ</td><td>ล็อกอินและกำหนดสิทธิ์</td><td>ตลอดที่เป็นผู้ใช้ จนเจ้าของโครงการนำออก</td></tr>
          <tr><td>บันทึกการใช้งาน เช่น วันที่เปิดหน้า จำนวนรายการที่เพิ่ม (ผู้ใช้เก็บเป็นค่า hash ย้อนกลับเป็นอีเมลไม่ได้ และไม่มีเนื้อหาข้อมูลลูกค้า)</td><td>ปรับปรุงบริการและดูแลลูกค้า</td><td>24 เดือน</td></tr>
          <tr><td>บันทึกการเข้าถึงของทีมช่วยเหลือ</td><td>ให้เจ้าของโครงการตรวจสอบได้</td><td>24 เดือน</td></tr>
          <tr><td>คุกกี้เข้าสู่ระบบ</td><td>จำการเข้าสู่ระบบ (ไม่ใช้คุกกี้โฆษณาหรือติดตาม)</td><td>จนออกจากระบบหรือหมดอายุ</td></tr>
        </tbody>
      </table>

      <h2>3. ข้อมูลที่โครงการบันทึกในระบบ</h2>
      <p>ข้อมูลผู้สนใจซื้อ ลูกค้า แปลง สถานะสินเชื่อ ค่าโฆษณา งานก่อสร้าง และรูปหน้างาน เป็นข้อมูลที่เจ้าของโครงการและพนักงานบันทึกเอง <b>เจ้าของโครงการเป็นผู้ควบคุมข้อมูลส่วนบุคคล</b> และเราเป็นผู้ประมวลผลข้อมูลส่วนบุคคลตามคำสั่งของเจ้าของโครงการ หากคุณเป็นผู้สนใจซื้อหรือเจ้าของบ้านและต้องการใช้สิทธิ์เกี่ยวกับข้อมูลของคุณ โปรดติดต่อโครงการหรือบริษัทที่คุณติดต่อด้วยโดยตรง</p>
      <ul>
        <li>เราใช้ข้อมูลนี้เพื่อแสดงผลและคำนวณในระบบของโครงการนั้นเท่านั้น ไม่ใช้เพื่อการตลาดของเรา และไม่ส่งต่อให้โครงการอื่น</li>
        <li>ข้อมูลแต่ละโครงการแยกจากกันในทุกคำสั่งของระบบ และมีการทดสอบอัตโนมัติว่าข้อมูลไม่รั่วข้ามโครงการ</li>
        <li>ทีมของเราไม่เข้าดูข้อมูลโครงการ เว้นแต่เจ้าของโครงการเปิดสิทธิ์ให้ชั่วคราว (24–72 ชั่วโมง) ทุกการเข้าถึงถูกบันทึกให้เจ้าของโครงการเห็น</li>
        <li>ระบบไม่เก็บไฟล์เอกสารประกอบสินเชื่อ เก็บเพียงสถานะว่าเอกสารครบหรือไม่</li>
        <li>หน้าติดตามของเจ้าของบ้านเปิดผ่านลิงก์ส่วนตัวที่เดายาก แสดงเฉพาะบ้านหลังนั้นและรูปที่บริษัทเลือกเผยแพร่ บริษัทยกเลิกลิงก์ได้ทุกเมื่อ การยืนยันงานเพิ่ม-ลดผ่านลิงก์บันทึกชื่อที่พิมพ์และเวลาไว้เป็นหลักฐาน</li>
      </ul>

      <h2>4. ผู้ให้บริการภายนอก</h2>
      <ul>
        <li><b>Cloudflare, Inc.</b> — เก็บข้อมูล ไฟล์รูป และประมวลผลระบบ ข้อมูลอาจถูกเก็บหรือประมวลผลในศูนย์ข้อมูลนอกประเทศไทย ภายใต้มาตรการคุ้มครองของผู้ให้บริการ</li>
        <li><b>Google LLC</b> — ให้บริการเข้าสู่ระบบด้วยบัญชี Google</li>
      </ul>

      <h2>5. การรักษาความปลอดภัยและการสำรองข้อมูล</h2>
      <ul>
        <li>เชื่อมต่อผ่าน HTTPS ทั้งหมด</li>
        <li>สำรองข้อมูลทุกวัน ไฟล์สำรองเก็บ 30 วันแล้วลบอัตโนมัติ</li>
        <li>ประวัติการติดต่อลูกค้าที่เก่ากว่า 1 ปีถูกย้ายไปเก็บถาวร เจ้าของโครงการดาวน์โหลดได้</li>
        <li>หากเกิดเหตุละเมิดข้อมูล เราจะแจ้งเจ้าของโครงการภายใน 72 ชั่วโมงนับจากทราบเหตุ</li>
      </ul>

      <h2>6. การเลิกใช้และการลบข้อมูล</h2>
      <p>เจ้าของโครงการส่งออกข้อมูลทั้งโครงการได้ทุกเมื่อ เมื่อเลิกใช้บริการ เราเก็บข้อมูลไว้ 90 วันเพื่อให้ส่งออก แล้วลบ ข้อมูลในไฟล์สำรองหมดอายุตามรอบภายใน 30 วันหลังจากนั้น ผู้ใช้ที่ต้องการให้ลบบัญชีของตน ติดต่อเจ้าของโครงการหรือเราได้</p>

      <h2>7. สิทธิ์ของเจ้าของข้อมูล</h2>
      <p>คุณมีสิทธิ์ขอเข้าถึง ขอสำเนา แก้ไข ลบ ระงับ หรือคัดค้านการประมวลผลข้อมูลส่วนบุคคลของคุณ และร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล ติดต่อเรา: {mail}</p>

      <h2>8. การเปลี่ยนแปลงนโยบาย</h2>
      <p>หากมีการเปลี่ยนแปลงที่สำคัญ เราจะแจ้งเจ้าของโครงการล่วงหน้าและปรับวันที่ด้านบนของหน้านี้</p>

      <h2 lang="en">Summary in English</h2>
      <div lang="en" className="flex flex-col gap-2 text-sm">
        <p>PlanBaan is a sales, marketing and construction tracking service for housing project owners and home builders in Thailand, operated by {operator}.</p>
        <p><b>Google user data:</b> when staff sign in with Google we receive only their name, email address and profile picture, and use them solely to authenticate the user and check which projects that email may access. We do not request access to Gmail, Drive, Calendar, Contacts or any other Google data. We do not sell, rent, or transfer Google user data to third parties, and we do not use it for advertising. Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
        <p>Data entered by a project (prospects, customers, plots, loans, ad spend, construction records and site photos) belongs to that project, which is the data controller; we process it only to provide the service. Data is stored with Cloudflare. Daily backups are kept for 30 days. On termination, data is kept for 90 days for export and then deleted. Contact: {contact || "via your project administrator"}.</p>
      </div>
    </LegalPage>
  );
}
