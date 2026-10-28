/* app.js — หน้าโปรแกรมหลัก: เข้าสู่ระบบ · ข้อมูลพื้นฐาน · รายชื่อ · กรอกผลประเมิน 8 ด้าน · รายงานรายบุคคล · สรุปห้อง · พิมพ์ */
(function () {
  'use strict';
  const { DOMAINS, GRADES } = window.PPCurr;
  const E = window.PPEngine, R = window.PPReport, esc = R.esc;
  const CFG = window.PP_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const be = window.PPBackend.create(CFG);
  const S = {
    code: '', school: null, grade: 1, room: 1, data: E.emptyData(), version: 0,
    dirty: false, saving: false, timer: null, view: 'home', sid: null,
  };

  // ---------- ตัวช่วย UI ----------
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3800);
  }
  function modal(title, body, buttons) {
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions">${
        buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
      m.hidden = false;
      const done = (v) => { m.hidden = true; m.innerHTML = ''; m.onclick = null; resolve(v); };
      m.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) done({ i: +b.dataset.i, el: m }); else if (e.target === m) done(null); };
      const first = $('input,textarea,select', m); if (first) first.focus();
    });
  }
  const confirmBox = async (title, text, ok, danger) => {
    const r = await modal(title, `<p>${text}</p>`, [{ label: 'ยกเลิก' }, { label: ok || 'ตกลง', cls: danger ? 'danger' : 'primary' }]);
    return !!(r && r.i === 1);
  };
  const loading = (on, msg) => { $('#loading').hidden = !on; if (msg) $('#loading-msg').textContent = msg; };
  const gradeName = (g) => GRADES[g] || ('ชั้น ' + g);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // ---------- เข้าสู่ระบบ ----------
  async function login(code, silent) {
    const btn = $('#login-go'); btn.disabled = true; $('#login-err').textContent = '';
    try {
      const res = await be.login(code);
      S.code = code; S.school = res;
      const allowed = (res.grades || []).filter((g) => GRADES[g]);
      if (!allowed.length) throw new Error('รหัสนี้ยังไม่มีสิทธิ์ใช้งานชั้นใด');
      const last = +store.get('pre_grade') || 0;
      S.grade = allowed.includes(last) ? last : allowed[0];
      S.room = pickRoom(S.grade);
      if ($('#login-remember').checked) store.set('pre_code', code); else store.del('pre_code');
      $('#login').hidden = true; $('#app').hidden = false;
      $('#school-name').textContent = res.school_name;
      document.title = res.school_name + ' — แจ้งผลการประเมินปฐมวัย 2568';
      buildSwitches();
      await openRoom();
    } catch (e) {
      $('#login').hidden = false; $('#app').hidden = true; loading(false);
      if (!silent) $('#login-err').textContent = e.message || 'เข้าสู่ระบบไม่สำเร็จ';
      if (silent) store.del('pre_code');
    } finally { btn.disabled = false; }
  }
  const roomsOf = (g) => { const set = new Set(((S.school && S.school.rooms) || []).filter((x) => x.grade === g).map((x) => x.room)); return Array.from(set).sort((a, b) => a - b); };
  const pickRoom = (g) => { const r = roomsOf(g); const last = +store.get('pre_room_' + g) || 0; return r.includes(last) ? last : (r[0] || 1); };

  function buildSwitches() {
    const allowed = (S.school.grades || []).filter((g) => GRADES[g]);
    $('#grade-switch').innerHTML = allowed.map((g) => `<option value="${g}" ${g === S.grade ? 'selected' : ''}>${esc(gradeName(g))}</option>`).join('');
    const rooms = roomsOf(S.grade); if (!rooms.includes(S.room)) rooms.push(S.room);
    rooms.sort((a, b) => a - b);
    $('#room-switch').innerHTML = rooms.map((r) => `<option value="${r}" ${r === S.room ? 'selected' : ''}>ห้อง ${r}</option>`).join('') + (rooms.length < 10 ? '<option value="new">＋ เพิ่มห้อง</option>' : '');
  }

  async function openRoom() {
    loading(true, 'กำลังโหลดข้อมูล...');
    try {
      const res = await be.load(S.code, S.grade, S.room);
      S.data = E.normalize(res.data); S.version = res.version || 0; S.dirty = false;
      if (!res.data) { S.data.info.year = CFG.YEAR || 2568; }
      S.sid = S.data.students[0] ? S.data.students[0].id : null;
      store.set('pre_grade', S.grade); store.set('pre_room_' + S.grade, S.room);
      setStat('ok', res.data ? 'โหลดข้อมูลแล้ว' : 'ห้องใหม่');
      render();
    } catch (e) { toast(e.message, 'warn'); setStat('err', 'โหลดไม่สำเร็จ'); }
    finally { loading(false); }
  }

  // ---------- บันทึก ----------
  function setStat(cls, txt) { const el = $('#savestat'); el.className = 'savestat ' + cls; el.textContent = txt; }
  function markDirty() {
    S.dirty = true; setStat('dirty', 'มีการแก้ไข...');
    clearTimeout(S.timer); S.timer = setTimeout(() => save(), 1500);
  }
  async function save(o) {
    o = o || {};   // now: บันทึกแม้ไม่มีการแก้ไข · overwrite: บันทึกทับข้อมูลบนเซิร์ฟเวอร์ · keepalive: ใช้ตอนปิดหน้า
    clearTimeout(S.timer);
    if (S.saving) { S.timer = setTimeout(() => save(o), 600); return false; }
    if (!S.dirty && !o.now) return true;
    S.saving = true; setStat('saving', 'กำลังบันทึก...');
    const snapshot = S.dirty; S.dirty = false;
    try {
      const r = await be.save(S.code, S.grade, S.room, S.data, S.version, !!o.overwrite, { keepalive: !!o.keepalive });
      if (r.conflict) {
        S.dirty = snapshot; S.saving = false;
        setStat('err', 'ข้อมูลถูกแก้จากที่อื่น');
        const pick = await modal('ข้อมูลถูกแก้ไขจากอุปกรณ์อื่น',
          '<p>ห้องนี้มีการบันทึกใหม่กว่าที่คุณเปิดอยู่ (อาจเปิดไว้หลายเครื่อง) เลือกว่าจะทำอย่างไร</p>',
          [{ label: 'ใช้ข้อมูลล่าสุดจากเซิร์ฟเวอร์ (ทิ้งการแก้ไขของฉัน)' }, { label: 'บันทึกทับด้วยข้อมูลของฉัน', cls: 'danger' }]);
        if (pick && pick.i === 1) return save({ now: true, overwrite: true });
        if (pick && pick.i === 0) { S.dirty = false; await openRoom(); }
        return false;
      }
      S.version = r.version;
      if (!S.school.rooms.some((x) => x.grade === S.grade && x.room === S.room)) { S.school.rooms.push({ grade: S.grade, room: S.room }); }
      if (!S.dirty) setStat('ok', 'บันทึกแล้ว ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
      else S.timer = setTimeout(() => save(), 800);
      return true;
    } catch (e) {
      S.dirty = true; setStat('err', e.offline ? 'ออฟไลน์ — จะลองบันทึกใหม่' : 'บันทึกไม่สำเร็จ: ' + e.message);
      S.timer = setTimeout(() => save(), 15000);
      return false;
    } finally { S.saving = false; }
  }

  // ---------- เมนู ----------
  const VIEWS = [
    { id: 'home', label: '🏠 หน้าหลัก' },
    { h: 'ข้อมูลตั้งต้น' },
    { id: 'info', label: '🏫 ข้อมูลพื้นฐาน' },
    { id: 'students', label: '👦 รายชื่อนักเรียน' },
    { h: 'ประเมินความสามารถผู้เรียน' },
    ...DOMAINS.map((d, i) => ({ id: 'd:' + d.id, label: `${i + 1}. ${d.name}`, dom: d.id })),
    { h: 'รายงาน' },
    { id: 'report', label: '📄 รายงานรายบุคคล' },
    { id: 'summary', label: '📊 สรุปผลทั้งห้อง' },
  ];
  function renderNav() {
    const prog = Object.fromEntries(E.progress(S.data).map((p) => [p.id, p]));
    $('#nav').innerHTML = VIEWS.map((v) => {
      if (v.h) return `<h4>${esc(v.h)}</h4>`;
      let p = '';
      if (v.dom) { const g = prog[v.dom]; const n = pct(g.done[0] + g.done[1], g.total * 2); p = g.total ? `<span class="pct ${n === 100 ? 'full' : ''}">${n}%</span>` : ''; }
      return `<button class="navitem ${S.view === v.id ? 'on' : ''}" data-view="${v.id}">${esc(v.label)}${p}</button>`;
    }).join('');
  }
  function go(view) { S.view = view; document.body.classList.remove('navopen'); render(); $('#view').scrollTop = 0; }

  function render() {
    renderNav();
    const v = S.view;
    const host = $('#view');
    if (v === 'home') host.innerHTML = viewHome();
    else if (v === 'info') { host.innerHTML = viewInfo(); }
    else if (v === 'students') host.innerHTML = viewStudents();
    else if (v === 'report') { host.innerHTML = viewReport(); }
    else if (v === 'summary') host.innerHTML = viewSummary();
    else if (v.startsWith('d:')) { host.innerHTML = viewEval(v.slice(2)); fixStickyHeads(); }
  }

  // ---------- หน้าหลัก ----------
  function viewHome() {
    const d = S.data, n = d.students.length;
    const prog = E.progress(d);
    const cards = DOMAINS.map((dm, i) => {
      const p = prog[i]; const a = pct(p.done[0], p.total), b = pct(p.done[1], p.total);
      return `<button class="dcard" data-view="d:${dm.id}"><b>${i + 1}. ${esc(dm.name)}</b><small>${dm.inds.length} สภาพที่พึงประสงค์</small>
        <div class="bar" title="ภาคเรียนที่ 1"><i style="width:${a}%"></i></div><small>ภาคเรียนที่ 1: ${a}%</small>
        <div class="bar" title="ภาคเรียนที่ 2"><i style="width:${b}%"></i></div><small>ภาคเรียนที่ 2: ${b}%</small></button>`;
    }).join('');
    return `<div class="page"><h2>${esc(S.school.school_name)} · ${esc(gradeName(S.grade))}/${S.room}</h2>
    <div class="card"><h3>ขั้นตอนใช้งาน</h3><ol class="steps">
      <li><span>กรอก <a href="#" data-view="info">ข้อมูลพื้นฐาน</a> (ครูประจำชั้น ผู้บริหาร) ${d.info.teacher ? '✅' : ''}</span></li>
      <li><span>เพิ่ม <a href="#" data-view="students">รายชื่อนักเรียน</a> (ไม่เกิน ${E.MAX_STUDENTS} คน) ${n ? '✅ ' + n + ' คน' : ''}</span></li>
      <li><span>ประเมินความสามารถ 8 ด้าน (พิมพ์ระดับ 1–3 ในช่อง) ระบบสรุปผลรายด้านให้อัตโนมัติ</span></li>
      <li><span>ดู/พิมพ์ <a href="#" data-view="report">รายงานรายบุคคล</a> และ <a href="#" data-view="summary">สรุปผลทั้งห้อง</a></span></li></ol>
      <p class="hint">ข้อมูลบันทึกอัตโนมัติ · ระดับคุณภาพ <span class="legend"><span class="pill l3">3 ดี</span><span class="pill l2">2 พอใช้</span><span class="pill l1">1 ควรส่งเสริม</span></span></p></div>
    <div class="cards">${cards}</div></div>`;
  }

  // ---------- ข้อมูลพื้นฐาน ----------
  function viewInfo() {
    const i = S.data.info;
    const f = (k, label, ph) => `<label class="fld"><span>${label}</span><input type="text" data-info="${k}" value="${esc(i[k])}" placeholder="${esc(ph || '')}"></label>`;
    return `<div class="page"><h2>ข้อมูลพื้นฐาน</h2>
    <div class="card"><div class="grid2">
      <label class="fld"><span>โรงเรียน <span class="hint">(ล็อกตามรหัสสิทธิ์)</span></span><input type="text" value="${esc(S.school.school_name)}" disabled></label>
      ${f('area', 'สังกัด', 'สำนักงานเขตพื้นที่การศึกษา...')}
      <label class="fld"><span>ชั้น / ห้อง</span><input type="text" value="${esc(gradeName(S.grade))} ห้อง ${S.room}" disabled></label>
      ${f('year', 'ปีการศึกษา', '2568')}
      ${f('teacher', 'ครูประจำชั้น', 'นางสาว...')}
      ${f('academic', 'หัวหน้างานวิชาการ', '')}
      ${f('deputy', 'รองผู้อำนวยการโรงเรียน', 'ถ้าไม่มีให้เว้นว่าง')}
      ${f('director', 'ผู้อำนวยการโรงเรียน', '')}
    </div></div>
    <div class="card"><h3>ตราโรงเรียน (แสดงบนรายงาน ใช้ร่วมทุกชั้นทุกห้อง)</h3>
      <div class="row">${S.school.logo ? `<img class="logo-prev" src="${esc(S.school.logo)}" alt="ตราโรงเรียน">` : '<span class="hint">ยังไม่ได้ตั้งตรา</span>'}
      <button class="btn" id="logo-pick">เลือกรูปตรา</button>${S.school.logo ? '<button class="btn danger" id="logo-del">ลบตรา</button>' : ''}</div></div>
    <div class="card"><h3>จัดการห้องเรียน</h3><p class="hint">ลบห้อง ${esc(gradeName(S.grade))}/${S.room} พร้อมรายชื่อและผลประเมินทั้งหมดของห้องนี้ (กู้คืนไม่ได้)</p>
      <button class="btn danger" id="room-del">ลบห้องนี้</button></div></div>`;
  }

  // ---------- รายชื่อ ----------
  function viewStudents() {
    const st = S.data.students;
    const rows = st.map((s, i) => `<tr data-sid="${esc(s.id)}"><td class="c">${i + 1}</td><td><input type="text" data-name="${esc(s.id)}" value="${esc(s.name)}" maxlength="80"></td>
      <td class="c"><button class="btn sm" data-mv="up" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑</button> <button class="btn sm" data-mv="down" ${i === st.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓</button> <button class="btn sm danger" data-del-stu="${esc(s.id)}" aria-label="ลบ">ลบ</button></td></tr>`).join('');
    return `<div class="page"><h2>รายชื่อนักเรียน <span class="hint">(${st.length}/${E.MAX_STUDENTS} คน)</span></h2>
    <div class="card"><h3>เพิ่มรายชื่อ</h3><p class="hint">พิมพ์หรือวางรายชื่อ 1 บรรทัด = 1 คน (คัดลอกจาก Excel ได้ ระบบตัดเลขลำดับหน้าชื่อให้) เลขที่เรียงตามลำดับในรายการ</p>
      <textarea id="stu-paste" rows="5" placeholder="เด็กชายสมชาย ใจดี&#10;เด็กหญิงสมหญิง รักเรียน"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="stu-add">เพิ่มรายชื่อ</button><button class="btn danger" id="stu-clear" ${st.length ? '' : 'disabled'}>ล้างรายชื่อทั้งหมด</button></div></div>
    ${st.length ? `<div class="tw stulist"><table class="t"><thead><tr><th class="c" style="width:56px">เลขที่</th><th>ชื่อ - นามสกุล</th><th class="c" style="width:170px">จัดการ</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="hint">ยังไม่มีรายชื่อ</p>'}</div>`;
  }

  // ---------- กรอกผลประเมิน ----------
  function viewEval(domId) {
    const dm = DOMAINS.find((x) => x.id === domId); const d = S.data;
    if (!d.students.length) return `<div class="page"><h2>${esc(dm.name)}</h2><div class="card">ยังไม่มีรายชื่อนักเรียน — <a href="#" data-view="students">ไปเพิ่มรายชื่อ</a></div></div>`;
    const h1 = dm.inds.map((i) => `<th class="ind" colspan="2" title="${esc(i.t)}">${esc(i.id + ' ' + i.t)}</th>`).join('');
    const h2 = dm.inds.map((i) => `<th>1<br><button class="bulk" data-bulk="${i.id}:0" title="เติม 3 ในช่องที่ยังว่างของคอลัมน์นี้">เติม 3</button></th><th>2<br><button class="bulk" data-bulk="${i.id}:1" title="เติม 3 ในช่องที่ยังว่างของคอลัมน์นี้">เติม 3</button></th>`).join('');
    const body = d.students.map((s, ri) => {
      const cells = dm.inds.map((i, ci) => [0, 1].map((k) => { const v = E.getScore(d, s.id, i.id, k); return `<td class="${v ? 'lv' + v : ''}"><input class="sc" inputmode="numeric" maxlength="1" autocomplete="off" data-sid="${esc(s.id)}" data-ind="${i.id}" data-t="${k}" data-r="${ri}" data-c="${ci * 2 + k}" value="${v || ''}" aria-label="${esc(s.name + ' ' + i.id + ' ภาคเรียนที่ ' + (k + 1))}"></td>`; }).join('')).join('');
      return `<tr data-row="${esc(s.id)}"><td class="no">${ri + 1}</td><td class="nm" title="${esc(s.name)}">${esc(s.name)}</td>${cells}${sumCells(dm, s.id)}</tr>`;
    }).join('');
    return `<div class="page" style="max-width:none"><div class="row sp"><h2>${DOMAINS.indexOf(dm) + 1}. ${esc(dm.aspect)}</h2>
      <span class="legend"><span class="pill l3">3 ดี</span><span class="pill l2">2 พอใช้</span><span class="pill l1">1 ควรส่งเสริม</span></span></div>
      <p class="hint">พิมพ์ 1, 2 หรือ 3 ในช่อง (ลูกศร/Enter เลื่อนช่อง · Backspace ลบ) · สรุปรายด้านและภาพรวมคำนวณให้อัตโนมัติ (ฐานนิยม ถ้าเสมอใช้ค่าสูงสุด)</p>
      <div class="evalwrap"><table class="ev" data-dom="${dm.id}"><thead>
        <tr><th class="no" rowspan="2">ที่</th><th class="nm" rowspan="2">ชื่อ - นามสกุล</th>${h1}<th colspan="3">สรุปผลด้านนี้</th></tr>
        <tr>${h2}<th>ภาค 1</th><th>ภาค 2</th><th>ภาพรวม</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }
  function sumCells(dm, sid) {
    const r = E.studentSummary(S.data, sid).find((x) => x.id === dm.id);
    const c = (v, x) => `<td class="sum ${x || ''} ${v ? 'lv' + v : ''}">${v || ''}</td>`;
    return c(r.t1) + c(r.t2) + c(r.all, 'all');
  }
  function fixStickyHeads() {
    const t = $('table.ev'); if (!t) return;
    const r1 = t.tHead.rows[0]; t.style.setProperty('--h1', r1.getBoundingClientRect().height + 'px');
  }
  function onScoreInput(inp) {
    let v = inp.value.replace(/[^1-3]/g, '').slice(-1);
    inp.value = v;
    const n = +v || 0;
    E.setScore(S.data, inp.dataset.sid, inp.dataset.ind, +inp.dataset.t, n);
    inp.parentElement.className = n ? 'lv' + n : '';
    refreshRow(inp.closest('tr'));
    markDirty(); scheduleNav();
    if (n) focusCell(+inp.dataset.r, +inp.dataset.c + 1, +inp.dataset.r);
  }
  function refreshRow(tr) {
    const dm = DOMAINS.find((x) => x.id === tr.closest('table').dataset.dom);
    const tds = $$('td.sum', tr); const r = E.studentSummary(S.data, tr.dataset.row).find((x) => x.id === dm.id);
    [r.t1, r.t2, r.all].forEach((v, i) => { tds[i].textContent = v || ''; tds[i].className = 'sum ' + (i === 2 ? 'all ' : '') + (v ? 'lv' + v : ''); });
  }
  let navTimer = null;
  function scheduleNav() { clearTimeout(navTimer); navTimer = setTimeout(renderNav, 400); }
  function focusCell(r, c, fallbackRow) {
    let el = $(`input.sc[data-r="${r}"][data-c="${c}"]`);
    if (!el && fallbackRow != null && c >= 0) return;   // สุดแถว: อยู่ที่เดิม
    if (el) { el.focus(); el.select(); }
  }
  function onScoreKey(e) {
    const inp = e.target, r = +inp.dataset.r, c = +inp.dataset.c;
    const map = { ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], Enter: [r + 1, c] };
    if (map[e.key]) { e.preventDefault(); focusCell(map[e.key][0], map[e.key][1]); }
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { e.preventDefault(); inp.value = ''; onScoreInput(inp); }
  }

  // ---------- รายงานรายบุคคล ----------
  function ctxNow() {
    return { data: S.data, grade: S.grade, room: S.room, schoolName: S.school.school_name, logo: S.school.logo, year: CFG.YEAR || 2568 };
  }
  function viewReport() {
    const d = S.data;
    if (!d.students.length) return '<div class="page"><h2>รายงานรายบุคคล</h2><div class="card">ยังไม่มีรายชื่อนักเรียน — <a href="#" data-view="students">ไปเพิ่มรายชื่อ</a></div></div>';
    if (!d.students.some((s) => s.id === S.sid)) S.sid = d.students[0].id;
    const opts = d.students.map((s, i) => `<option value="${esc(s.id)}" ${s.id === S.sid ? 'selected' : ''}>${i + 1}. ${esc(s.name)}</option>`).join('');
    return `<div class="page" style="max-width:none"><h2>รายงานรายบุคคล</h2>
      <div class="card"><div class="row pickrow"><button class="btn" id="rp-prev">◀</button><select id="rp-pick">${opts}</select><button class="btn" id="rp-next">▶</button>
      <span class="grow"></span><button class="btn primary" id="rp-print-one">🖨 พิมพ์คนนี้</button><button class="btn" id="rp-print-all">🖨 พิมพ์ทั้งห้อง (${d.students.length} คน)</button></div>
      <p class="hint" style="margin:.5rem 0 0">กรอก "จุดเด่นความสามารถ" ของแต่ละด้านในช่องขวาของรายงานได้เลย (บันทึกอัตโนมัติ)</p></div>
      <div class="docscroll"><div class="reportbox" id="rp-box">${R.student(ctxNow(), S.sid, { editable: true })}</div></div></div>`;
  }
  function rerenderReport() { const b = $('#rp-box'); if (b) b.innerHTML = R.student(ctxNow(), S.sid, { editable: true }); }
  function stepStudent(delta) {
    const ids = S.data.students.map((s) => s.id); const i = Math.max(0, Math.min(ids.length - 1, ids.indexOf(S.sid) + delta));
    S.sid = ids[i]; $('#rp-pick').value = S.sid; rerenderReport();
  }

  // ---------- สรุปห้อง ----------
  function viewSummary() {
    const d = S.data;
    if (!d.students.length) return '<div class="page"><h2>สรุปผลทั้งห้อง</h2><div class="card">ยังไม่มีรายชื่อนักเรียน — <a href="#" data-view="students">ไปเพิ่มรายชื่อ</a></div></div>';
    const dist = E.distribution(d, 'all');
    const drows = DOMAINS.map((dm, i) => {
      const x = dist[dm.id], tot = d.students.length;
      const seg = (k) => `<i class="d${k}" style="width:${pct(x[k], tot)}%" title="ระดับ ${k}: ${x[k]} คน"></i>`;
      return `<tr><td>${i + 1}. ${esc(dm.name)}</td><td><div class="dist">${seg(3)}${seg(2)}${seg(1)}${seg(0)}</div></td><td class="c">${x[3]}</td><td class="c">${x[2]}</td><td class="c">${x[1]}</td><td class="c">${x[0]}</td></tr>`;
    }).join('');
    return `<div class="page" style="max-width:none"><div class="row sp"><h2>สรุปผลทั้งห้อง</h2><div class="row"><button class="btn" id="sum-csv">ดาวน์โหลด CSV</button><button class="btn primary" id="sum-print">🖨 พิมพ์สรุปผล</button></div></div>
      <div class="card"><h3>จำนวนนักเรียนแยกตามระดับ (สรุปภาพรวม 2 ภาคเรียน)</h3>
      <div class="tw"><table class="t"><thead><tr><th>ด้าน</th><th>สัดส่วน</th><th class="c">3 ดี</th><th class="c">2 พอใช้</th><th class="c">1 ควรส่งเสริม</th><th class="c">ยังไม่ประเมิน</th></tr></thead><tbody>${drows}</tbody></table></div></div>
      <div class="docscroll"><div class="reportbox" style="width:max-content;min-width:100%">${R.classSummary(ctxNow())}</div></div></div>`;
  }
  function downloadCSV() {
    const d = S.data, q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const head = ['เลขที่', 'ชื่อ - นามสกุล'].concat(DOMAINS.flatMap((dm) => [dm.name + ' ภาค1', dm.name + ' ภาค2', dm.name + ' รวม']));
    const lines = [head.map(q).join(',')];
    d.students.forEach((s, i) => { lines.push([i + 1, q(s.name)].concat(E.studentSummary(d, s.id).flatMap((r) => [r.t1 || '', r.t2 || '', r.all || ''])).join(',')); });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `สรุปผล_${gradeName(S.grade)}_${S.room}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- พิมพ์ ----------
  function preview(title, pagesHtml, land) {
    $('#print-root').innerHTML = pagesHtml.map((h) => `<section class="pp-page ${land ? 'land' : ''}">${h}</section>`).join('');
    $('#pv-title').textContent = title; document.body.classList.add('previewing'); window.scrollTo(0, 0);
  }
  function closePreview() { document.body.classList.remove('previewing'); $('#print-root').innerHTML = ''; }

  // ---------- ตรารร. ----------
  function pickLogo(file) {
    if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = async () => {
      const max = 300, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const data = c.toDataURL('image/png');
      try { await be.setLogo(S.code, data); S.school.logo = data; toast('บันทึกตราโรงเรียนแล้ว', 'ok'); render(); } catch (e) { toast(e.message, 'warn'); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('อ่านไฟล์รูปไม่ได้', 'warn'); };
    img.src = url;
  }

  // ---------- เหตุการณ์ ----------
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const nav = t.closest('[data-view]'); if (nav) { e.preventDefault(); go(nav.dataset.view); return; }
    if (t.closest('#menu-btn')) { document.body.classList.toggle('navopen'); return; }
    if (t.closest('#save-now')) { const ok = await save({ now: true }); if (ok) toast('บันทึกแล้ว', 'ok'); return; }
    if (t.closest('#logout')) { if (S.dirty) await save({ now: true }); store.del('pre_code'); location.reload(); return; }
    if (t.closest('#pv-back')) { closePreview(); return; }
    if (t.closest('#pv-print')) { window.print(); return; }
    // ข้อมูลพื้นฐาน
    if (t.closest('#logo-pick')) { $('#logo-file').click(); return; }
    if (t.closest('#logo-del')) { try { await be.setLogo(S.code, null); S.school.logo = null; render(); } catch (er) { toast(er.message, 'warn'); } return; }
    if (t.closest('#room-del')) {
      if (!(await confirmBox('ลบห้องนี้?', `ลบ ${esc(gradeName(S.grade))}/${S.room} พร้อมข้อมูลทั้งหมด กู้คืนไม่ได้`, 'ลบห้อง', true))) return;
      try {
        await be.deleteRoom(S.code, S.grade, S.room);
        S.school.rooms = S.school.rooms.filter((x) => !(x.grade === S.grade && x.room === S.room));
        S.dirty = false; S.room = pickRoom(S.grade); buildSwitches(); await openRoom(); toast('ลบห้องแล้ว', 'ok');
      } catch (er) { toast(er.message, 'warn'); }
      return;
    }
    // รายชื่อ
    if (t.closest('#stu-add')) {
      const names = E.parseNames($('#stu-paste').value); if (!names.length) return;
      const room = E.MAX_STUDENTS - S.data.students.length;
      if (names.length > room) toast(`เพิ่มได้อีก ${room} คน (สูงสุด ${E.MAX_STUDENTS}) ตัดส่วนเกินออก`, 'warn');
      names.slice(0, Math.max(0, room)).forEach((n) => S.data.students.push({ id: E.uid(), name: n }));
      markDirty(); render(); return;
    }
    if (t.closest('#stu-clear')) {
      if (!(await confirmBox('ล้างรายชื่อทั้งหมด?', 'จะลบนักเรียนและผลประเมินของทุกคนในห้องนี้', 'ล้างทั้งหมด', true))) return;
      S.data.students = []; S.data.scores = {}; S.data.hi = {}; markDirty(); render(); return;
    }
    const del = t.closest('[data-del-stu]');
    if (del) {
      const id = del.dataset.delStu, s = S.data.students.find((x) => x.id === id);
      if (!(await confirmBox('ลบนักเรียน?', `ลบ "${esc(s ? s.name : '')}" และผลประเมินของคนนี้`, 'ลบ', true))) return;
      S.data.students = S.data.students.filter((x) => x.id !== id); delete S.data.scores[id]; delete S.data.hi[id]; markDirty(); render(); return;
    }
    const mv = t.closest('[data-mv]');
    if (mv) {
      const id = mv.closest('tr').dataset.sid, a = S.data.students, i = a.findIndex((x) => x.id === id), j = i + (mv.dataset.mv === 'up' ? -1 : 1);
      if (j >= 0 && j < a.length) { [a[i], a[j]] = [a[j], a[i]]; markDirty(); render(); }
      return;
    }
    // กรอกคะแนน
    const bulk = t.closest('[data-bulk]');
    if (bulk) {
      const [ind, k] = bulk.dataset.bulk.split(':'); let n = 0;
      for (const s of S.data.students) if (!E.getScore(S.data, s.id, ind, +k)) { E.setScore(S.data, s.id, ind, +k, 3); n++; }
      if (n) { markDirty(); render(); toast(`เติมระดับ 3 ให้ ${n} คน`, 'ok'); }
      return;
    }
    // รายงาน
    if (t.closest('#rp-prev')) return stepStudent(-1);
    if (t.closest('#rp-next')) return stepStudent(1);
    if (t.closest('#rp-print-one')) { const s = S.data.students.find((x) => x.id === S.sid); preview('รายงานรายบุคคล — ' + s.name, [R.student(ctxNow(), S.sid)]); return; }
    if (t.closest('#rp-print-all')) { preview(`รายงานรายบุคคลทั้งห้อง (${S.data.students.length} คน)`, S.data.students.map((s) => R.student(ctxNow(), s.id))); return; }
    if (t.closest('#sum-print')) { preview('สรุปผลทั้งห้อง', [R.classSummary(ctxNow())], true); return; }
    if (t.closest('#sum-csv')) { downloadCSV(); return; }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('sc')) return onScoreInput(t);
    if (t.dataset.info) { S.data.info[t.dataset.info] = t.value; markDirty(); return; }
    if (t.dataset.name) { const s = S.data.students.find((x) => x.id === t.dataset.name); if (s) { s.name = t.value; markDirty(); } return; }
    if (t.dataset.hi) {
      const [dom, k] = t.dataset.hi.split(':'); const sid = t.dataset.sid;
      const row = (S.data.hi[sid] = S.data.hi[sid] || {}); const a = (row[dom] = row[dom] || ['', '']); a[+k] = t.value;
      if (!a[0] && !a[1]) delete row[dom]; if (!Object.keys(row).length) delete S.data.hi[sid];
      markDirty();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.target.classList && e.target.classList.contains('sc')) onScoreKey(e); });
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'rp-pick') { S.sid = t.value; rerenderReport(); return; }
    if (t.id === 'logo-file') { pickLogo(t.files[0]); t.value = ''; return; }
    if (t.id === 'grade-switch' || t.id === 'room-switch') {
      if (S.dirty) await save({ now: true });
      if (t.id === 'grade-switch') { S.grade = +t.value; S.room = pickRoom(S.grade); }
      else if (t.value === 'new') {
        const used = new Set(roomsOf(S.grade).concat([S.room])); let n = 1; while (used.has(n) && n < 10) n++;
        S.room = n; buildSwitches(); await openRoom(); S.dirty = true; await save({ now: true }); return;
      } else S.room = +t.value;
      buildSwitches(); await openRoom();
    }
  });

  $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); login($('#login-code').value.trim()); });
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { save({ now: true, keepalive: true }); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.dirty && S.code) save({ now: true, keepalive: true }); });

  // ---------- เริ่มต้น ----------
  (function init() {
    if (be.demo) $('#demo-note').hidden = false;
    const saved = store.get('pre_code');
    if (saved) { $('#login-code').value = saved; $('#login-remember').checked = true; login(saved, true); }
    // รองรับ ?code=XXXX (ลิงก์จากผู้ดูแล) — ไม่เก็บในเครื่องถ้าไม่ได้ติ๊ก "จำรหัส"
    const q = new URLSearchParams(location.search).get('code');
    if (q && !saved) { $('#login-code').value = q; }
  })();

  window.PPApp = { S, render };   // สำหรับดีบัก/ทดสอบ
})();
