// ปฏิทิน
import assert from "node:assert/strict";
import { makeD1, test, rejects } from "./helpers/fake-cf.mjs";
import { createProject } from "../src/lib/control";
import { tenantDb } from "../src/lib/tenant-db";
import * as S from "../src/lib/sales";
import * as C from "../src/lib/construction";
import * as Cal from "../src/lib/calendar";

const raw = makeD1();
const p = await createProject(raw as never, { slug: "suanson", name: "สวนสน", ownerEmail: "o@x.com" });
const q = await createProject(raw as never, { slug: "rommai", name: "ร่มไม้", ownerEmail: "b@x.com" });
const db = tenantDb(raw as never, p.id);
const other = tenantDb(raw as never, q.id);
const M = "2026-12";

await test("รวมวันที่จากระบบ: นัดติดตาม ยื่นกู้ใหม่ งวดงาน ส่งมอบ และนัดที่เพิ่มเอง เรียงตามวันและเวลา", async () => {
  await S.createPlotsBulk(db, { zone: "A", count: 2 });
  const a = await S.createLead(db, { name: "คุณวิชัย", nextFollowAt: `${M}-05`, ownerEmail: "s1@x.com" }, "s1@x.com");
  const lost = await S.createLead(db, { name: "ไม่ซื้อแล้ว", nextFollowAt: `${M}-05` }, "s1@x.com");
  await S.moveLead(db, lost.id, "lost", "s1@x.com", { lostReason: "unreachable" });
  const loanLead = await S.createLead(db, { name: "คุณมาลี", plotCode: "A01", ownerEmail: "s2@x.com" }, "s2@x.com");
  await S.moveLead(db, loanLead.id, "loan", "s2@x.com");
  await db.update("leads", loanLead.id, { debt_retry_at: `${M}-20` });
  await C.createBuild(db, { plotCode: "A02", startDate: "2026-09-01", dueDate: `${M}-28`, stages: ["ฐานราก", "หลังคา"] }, "o@x.com");
  await Cal.addEvent(db, { title: "พาดูบ้านตัวอย่าง", date: `${M}-05`, time: "14:00", leadId: a.id }, "s1@x.com");
  await Cal.addEvent(db, { title: "ประชุมทีม", date: `${M}-05`, time: "09:30" }, "o@x.com");
  const items = await Cal.monthItems(db, M, { construction: true });
  assert.deepEqual(items.map((i) => `${i.date.slice(8)} ${i.kind} ${i.title}`), [
    "05 event ประชุมทีม", "05 event พาดูบ้านตัวอย่าง", "05 follow คุณวิชัย",
    "20 loan คุณมาลี", "28 due แปลง A02", "28 stage แปลง A02: หลังคา",
  ]);
  assert.match(items[1].sub, /คุณวิชัย/);
  // ไม่เปิดส่วนก่อสร้าง = ไม่มีงวดงานและส่งมอบ
  assert.equal((await Cal.monthItems(db, M, { construction: false })).some((i) => i.kind === "stage" || i.kind === "due"), false);
});

await test("เฉพาะของฉัน: ลูกค้าที่ดูแลและนัดที่สร้างเอง (งานก่อสร้างยังแสดง)", async () => {
  const mine = await Cal.monthItems(db, M, { construction: true, mine: "s1@x.com" });
  assert.deepEqual(mine.map((i) => i.title), ["พาดูบ้านตัวอย่าง", "คุณวิชัย", "แปลง A02", "แปลง A02: หลังคา"]);
});

await test("ตรวจข้อมูลนัดหมาย และสิทธิ์ลบ", async () => {
  await rejects(Cal.addEvent(db, { title: "", date: `${M}-01` }, "a"), /หัวข้อ/);
  await rejects(Cal.addEvent(db, { title: "x", date: "2026-02-31x" }, "a"), /วันที่/);
  await rejects(Cal.addEvent(db, { title: "x", date: `${M}-01`, time: "25:00" }, "a"), /เวลา/);
  await rejects(Cal.addEvent(db, { title: "x", date: `${M}-01`, leadId: "nope" }, "a"), /ลูกค้า/);
  const ev = await Cal.addEvent(db, { title: "ของ s1", date: `${M}-10` }, "s1@x.com");
  await rejects(Cal.removeEvent(db, String(ev.id), "s2@x.com", false), /เฉพาะนัดหมายที่คุณสร้าง/);
  await Cal.removeEvent(db, String(ev.id), "o@x.com", true);
  assert.equal(await db.get("events", String(ev.id)), null);
});

await test("ตารางเดือนเริ่มวันอาทิตย์ และนัดไม่รั่วข้ามโครงการ", async () => {
  const g = Cal.monthGrid("2026-11"); // 1 พ.ย. 2569 เป็นวันอาทิตย์
  assert.equal(g[0], "2026-11-01");
  assert.equal(g.length % 7, 0);
  assert.equal(Cal.monthGrid("2026-12")[2], "2026-12-01"); // วันอังคาร
  assert.equal((await Cal.monthItems(other, M, { construction: true })).length, 0);
});
