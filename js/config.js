/* ตั้งค่าการเชื่อมต่อ Supabase (โปรเจกต์ achievement2568preprimary)
 * anon key ออกแบบมาให้เปิดเผยในเว็บได้ ความปลอดภัยอยู่ที่ RLS + ฟังก์ชันใน sql/schema.sql
 * ถ้าเว้นว่าง เว็บจะทำงานใน "โหมดทดลอง" (เก็บข้อมูลในเบราว์เซอร์เครื่องนี้ ใช้รหัส DEMO) */
window.PP_CONFIG = {
  SUPABASE_URL: 'https://cplaivlsdcehncwxnrnw.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbGFpdmxzZGNlaG5jd3hucm53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTc4OTEsImV4cCI6MjEwODczMzg5MX0.CZjrDtYfX-tDieeT1SkhHvacISUiYASstRkVCeup7bc',
  GRADES_READY: [1, 2, 3],   // ชั้นที่เปิดใช้ (อนุบาล 1-3)
  YEAR: 2568,
  // ---- หน้าสมัครใช้งาน (register.html) ----
  SALES: {
    FACEBOOK: 'https://www.facebook.com/filevichakan/',
    MESSENGER: 'https://www.facebook.com/messages/t/filevichakan/',
    LINE_ID: '',
    PHONE: '',
    PACKAGES: [],   // ตัวอย่าง: { name: 'รายชั้น', price: 'xxx บาท', unit: '/ ชั้น / ปีการศึกษา', items: ['ใช้ได้ทุกห้องในชั้นนั้น'], hot: false }
  },
};
