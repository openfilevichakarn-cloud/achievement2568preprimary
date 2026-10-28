/* engine.js — แกนคำนวณผลการประเมินความสามารถผู้เรียนปฐมวัย (ไม่แตะ DOM ทดสอบด้วย node ได้)
 * กติกาเดียวกับไฟล์ Excel ต้นแบบ:
 *   สรุปรายด้านต่อภาคเรียน = ฐานนิยมของระดับ (1-3) ของทุกสภาพที่พึงประสงค์ในด้านนั้น ถ้าฐานนิยมเสมอกันให้ใช้ค่าสูงสุด
 *   ถ้าไม่มีค่าที่ซ้ำกันเลย ใช้ค่าสูงสุด · ช่องว่างไม่นับ · ยังไม่มีข้อมูลเลย = 0
 *   สรุปภาพรวม = ฐานนิยมของผลภาคเรียนที่ 1 และ 2 (เท่ากันใช้ค่านั้น ไม่เท่ากันใช้ค่าสูงกว่า) */
(function (root) {
  'use strict';
  if (!root.PPCurr && typeof require !== 'undefined') require('./curriculum.js');
  const C = root.PPCurr;
  const MAX_STUDENTS = 40;

  function modeMax(vals) {
    const v = vals.filter((x) => x >= 1 && x <= 3);
    if (!v.length) return 0;
    const cnt = {};
    for (const x of v) cnt[x] = (cnt[x] || 0) + 1;
    const top = Math.max(...Object.values(cnt));
    if (top < 2) return Math.max(...v);
    return Math.max(...Object.keys(cnt).filter((k) => cnt[k] === top).map(Number));
  }
  const overall = (a, b) => (a === b ? a : Math.max(a, b));

  const emptyData = () => ({ v: 1, info: { area: '', teacher: '', deputy: '', director: '', academic: '', year: 2568 }, students: [], scores: {}, hi: {} });

  function normalize(d) {
    const o = Object.assign(emptyData(), d || {});
    o.info = Object.assign(emptyData().info, o.info || {});
    o.students = Array.isArray(o.students) ? o.students.slice(0, MAX_STUDENTS) : [];
    o.scores = o.scores && typeof o.scores === 'object' ? o.scores : {};
    o.hi = o.hi && typeof o.hi === 'object' ? o.hi : {};
    return o;
  }

  function getScore(d, sid, ind, term) {
    const r = d.scores[sid]; const a = r && r[ind];
    return (a && a[term]) || 0;
  }
  function setScore(d, sid, ind, term, val) {
    const r = (d.scores[sid] = d.scores[sid] || {});
    const a = (r[ind] = r[ind] || [0, 0]);
    a[term] = val || 0;
    if (!a[0] && !a[1]) { delete r[ind]; if (!Object.keys(r).length) delete d.scores[sid]; }
  }

  /** ผลรายด้านของนักเรียน 1 คน: [{id, t1, t2, all}] */
  function studentSummary(d, sid) {
    return C.DOMAINS.map((dom) => {
      const t = [0, 1].map((k) => modeMax(dom.inds.map((i) => getScore(d, sid, i.id, k))));
      return { id: dom.id, t1: t[0], t2: t[1], all: overall(t[0], t[1]) };
    });
  }

  /** ความคืบหน้า: จำนวนช่องที่กรอกแล้ว / ทั้งหมด (ต่อด้านและภาคเรียน) */
  function progress(d) {
    const n = d.students.length;
    return C.DOMAINS.map((dom) => {
      const total = n * dom.inds.length; const done = [0, 0];
      for (const s of d.students) for (const i of dom.inds) for (const k of [0, 1]) if (getScore(d, s.id, i.id, k)) done[k]++;
      return { id: dom.id, total, done };
    });
  }

  /** จำนวนนักเรียนในแต่ละระดับ (ภาพรวม) ต่อด้าน: {domId: {0:n,1:n,2:n,3:n}} */
  function distribution(d, which) {
    const out = {};
    for (const dom of C.DOMAINS) out[dom.id] = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const s of d.students) for (const r of studentSummary(d, s.id)) out[r.id][which === 't1' ? r.t1 : which === 't2' ? r.t2 : r.all]++;
    return out;
  }

  /** แปลงข้อความหลายบรรทัดเป็นรายชื่อ (ตัดเลขลำดับหน้าบรรทัด/แท็บ/เครื่องหมาย) */
  function parseNames(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*\d+\s*[.)\t:-]?\s*/, '').replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  root.PPEngine = { modeMax, overall, emptyData, normalize, getScore, setScore, studentSummary, progress, distribution, parseNames, uid, MAX_STUDENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PPEngine;
})(typeof window !== 'undefined' ? window : globalThis);
