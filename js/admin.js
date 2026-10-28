/* admin.js — หน้าผู้ดูแล: ออกรหัส / รายชื่อโรงเรียน / รีเซ็ตรหัส / คำขอสมัคร (เรียก RPC admin_* ด้วยรหัสผ่านผู้ดูแล) */
(function () {
  'use strict';
  const CFG = window.PP_CONFIG || {};
  const GR = { 1: 'อนุบาล 1', 2: 'อนุบาล 2', 3: 'อนุบาล 3' };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => (t ? new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
  let pass = '', schools = [], regs = [], lf = 'all', rf = 'new';

  async function rpc(fn, body) {
    if (!CFG.SUPABASE_URL) throw new Error('ยังไม่ได้ตั้งค่า Supabase ใน js/config.js');
    let res;
    try {
      res = await fetch(`${CFG.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
    } catch (e) { throw new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้'); }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && (json.message || json.hint)) || 'คำขอล้มเหลว (' + res.status + ')');
    if (json && json.ok === false) throw new Error(json.error || 'ไม่สำเร็จ');
    return json;
  }
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3800);
  }
  function modal(title, body, buttons) {
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = `<div class="modal-card"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
      m.hidden = false;
      const done = (v) => { m.hidden = true; m.innerHTML = ''; m.onclick = null; resolve(v); };
      m.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) done({ i: +b.dataset.i, el: m }); else if (e.target === m) done(null); };
    });
  }
  const gradeChecks = (id, sel) => [1, 2, 3].map((g) => `<label><input type="checkbox" name="${id}" value="${g}" ${(sel || [1, 2, 3]).includes(g) ? 'checked' : ''}> ${GR[g]}</label>`).join('');
  const checked = (root, name) => Array.from(root.querySelectorAll(`input[name="${name}"]:checked`)).map((x) => +x.value);

  async function login(p, silent) {
    try {
      await rpc('admin_login', { p_pass: p });
      pass = p; sessionStorage.setItem('pre_admin', p);
      $('#a-login').hidden = true; $('#a-app').hidden = false;
      $('#i-grades').innerHTML = gradeChecks('ig');
      await Promise.all([loadSchools(), loadRegs()]);
    } catch (e) { sessionStorage.removeItem('pre_admin'); $('#a-login').hidden = false; $('#a-app').hidden = true; if (!silent) $('#a-err').textContent = e.message; }
  }
  async function loadSchools() { try { schools = (await rpc('admin_list', { p_pass: pass })).schools; renderSchools(); } catch (e) { toast(e.message, 'warn'); } }
  async function loadRegs() { try { regs = (await rpc('admin_registrations', { p_pass: pass })).items; renderRegs(); } catch (e) { toast(e.message, 'warn'); } }

  function renderSchools() {
    const q = $('#l-q').value.trim().toLowerCase();
    const list = schools.filter((s) => (lf === 'all' || (lf === 'on') === s.active) && (!q || (s.name + ' ' + (s.note || '')).toLowerCase().includes(q)));
    $('#l-count').textContent = `(${list.length}/${schools.length})`;
    $('#l-body').innerHTML = list.map((s) => {
      const last = (s.saves || []).map((x) => x.updated_at).sort().pop();
      const rooms = (s.saves || []).length;
      return `<tr data-id="${s.id}"><td><b>${esc(s.name)}</b></td><td>${(s.grades || []).map((g) => GR[g] || g).join(', ')}</td>
        <td><span class="tag ${s.active ? 'ok' : 'off'}">${s.active ? 'ใช้งาน' : 'ระงับ'}</span></td><td>${fmt(last)}${rooms ? ` <span class="hint">(${rooms} ห้อง)</span>` : ''}</td>
        <td>${esc(s.note || '')}</td><td>${fmt(s.created_at)}</td>
        <td><div class="cell-actions"><button class="btn sm" data-a="reset">รีเซ็ตรหัส</button><button class="btn sm" data-a="edit">แก้ไข</button>
        <button class="btn sm" data-a="toggle">${s.active ? 'ระงับ' : 'เปิดใช้'}</button><button class="btn sm danger" data-a="del">ลบ</button></div></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="hint">ไม่มีรายการ</td></tr>';
  }
  function renderRegs() {
    const list = regs.filter((r) => rf === 'all' || r.status === 'new');
    $('#r-count').textContent = `(${list.length}/${regs.length})`;
    const st = { new: ['new', 'ใหม่'], done: ['ok', 'ออกรหัสแล้ว'], cancel: ['off', 'ยกเลิก'] };
    $('#r-body').innerHTML = list.map((r) => `<tr data-id="${r.id}"><td>${fmt(r.created_at)}<br><span class="hint">#${esc(r.ref)}</span></td>
      <td><b>${esc(r.school)}</b><br><span class="hint">${esc(r.area || '')}</span><br><span class="hint">${esc(r.note || '')}</span></td>
      <td>${esc(r.contact)} ${esc(r.position || '')}<br>${esc(r.phone)}<br><span class="hint">${esc(r.line_id ? 'LINE ' + r.line_id : '')} ${esc(r.email || '')}</span></td>
      <td>${(r.grades || []).map((g) => GR[g] || g).join(', ')}${r.rooms ? `<br><span class="hint">${r.rooms} ห้อง</span>` : ''}</td>
      <td><span class="tag ${st[r.status][0]}">${st[r.status][1]}</span></td>
      <td><div class="cell-actions"><button class="btn sm primary" data-a="use">ออกรหัส</button><button class="btn sm" data-a="done">เสร็จแล้ว</button><button class="btn sm" data-a="cancel">ยกเลิก</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="hint">ไม่มีคำขอ</td></tr>';
  }

  async function showCodes(items) {
    const body = items.map((i) => `<p style="margin:.6rem 0 0"><b>${esc(i.name)}</b></p><div class="codebox">${esc(i.code)}</div>`).join('') +
      '<p class="hint">รหัสแสดงครั้งนี้ครั้งเดียว (ระบบเก็บเฉพาะค่าแฮช) — คัดลอกส่งให้โรงเรียนก่อนปิดหน้าต่าง หากหายให้ใช้ "รีเซ็ตรหัส"</p>';
    const r = await modal('ออกรหัสสำเร็จ', body, [{ label: 'คัดลอกทั้งหมด' }, { label: 'ปิด', cls: 'primary' }]);
    if (r && r.i === 0) { try { await navigator.clipboard.writeText(items.map((i) => `${i.name}\t${i.code}`).join('\n')); toast('คัดลอกแล้ว', 'ok'); } catch (e) { toast('คัดลอกไม่ได้ ให้เลือกข้อความเอง', 'warn'); } }
  }

  $('#a-login-form').addEventListener('submit', (e) => { e.preventDefault(); $('#a-err').textContent = ''; login($('#a-pass').value); });
  $('#a-logout').addEventListener('click', () => { sessionStorage.removeItem('pre_admin'); location.reload(); });
  $('#l-refresh').addEventListener('click', () => { loadSchools(); loadRegs(); });
  $('#l-q').addEventListener('input', renderSchools);
  $('#l-filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; lf = b.dataset.f; [...$('#l-filter').children].forEach((x) => x.classList.toggle('on', x === b)); renderSchools(); });
  $('#r-filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; rf = b.dataset.f; [...$('#r-filter').children].forEach((x) => x.classList.toggle('on', x === b)); renderRegs(); });

  $('#i-go').addEventListener('click', async () => {
    const names = $('#i-names').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const grades = checked($('#i-grades'), 'ig');
    if (!names.length) return toast('กรอกชื่อโรงเรียนก่อน', 'warn');
    if (!grades.length) return toast('เลือกชั้นอย่างน้อย 1 ชั้น', 'warn');
    try {
      const r = await rpc('admin_issue', { p_pass: pass, p_names: names, p_grades: grades, p_note: $('#i-note').value });
      $('#i-names').value = ''; $('#i-note').value = ''; await loadSchools(); await showCodes(r.issued);
    } catch (e) { toast(e.message, 'warn'); }
  });

  $('#l-body').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const id = b.closest('tr').dataset.id, s = schools.find((x) => x.id === id);
    try {
      if (b.dataset.a === 'reset') {
        const ok = await modal('รีเซ็ตรหัส?', `<p>ออกรหัสใหม่ให้ <b>${esc(s.name)}</b> — รหัสเดิมใช้ไม่ได้ทันที ข้อมูลยังอยู่ครบ</p>`, [{ label: 'ยกเลิก' }, { label: 'ออกรหัสใหม่', cls: 'primary' }]);
        if (ok && ok.i === 1) { const r = await rpc('admin_reset', { p_pass: pass, p_id: id }); await showCodes([{ name: s.name, code: r.code }]); }
      } else if (b.dataset.a === 'toggle') {
        await rpc('admin_update', { p_pass: pass, p_id: id, p_active: !s.active }); await loadSchools();
      } else if (b.dataset.a === 'edit') {
        const r = await modal('แก้ไขโรงเรียน', `<label class="fld"><span>ชื่อโรงเรียน</span><input id="e-name" type="text" value="${esc(s.name)}"></label>
          <div class="fld" style="margin-top:8px"><span>ชั้นที่ใช้ได้</span><div class="gchk" id="e-g">${gradeChecks('eg', s.grades)}</div></div>
          <label class="fld" style="margin-top:8px"><span>หมายเหตุ</span><input id="e-note" type="text" value="${esc(s.note || '')}"></label>`, [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'primary' }]);
        if (r && r.i === 1) {
          const g = checked(r.el, 'eg'); if (!g.length) return toast('เลือกชั้นอย่างน้อย 1 ชั้น', 'warn');
          await rpc('admin_update', { p_pass: pass, p_id: id, p_name: r.el.querySelector('#e-name').value, p_grades: g, p_note: r.el.querySelector('#e-note').value }); await loadSchools(); toast('บันทึกแล้ว', 'ok');
        }
      } else if (b.dataset.a === 'del') {
        const r = await modal('ลบโรงเรียนถาวร?', `<p>ลบ <b>${esc(s.name)}</b> พร้อมรายชื่อและผลประเมินทั้งหมด <b>กู้คืนไม่ได้</b></p><p class="hint">ถ้าแค่ต้องการหยุดใช้งาน ให้กด "ระงับ" แทน</p>`, [{ label: 'ยกเลิก' }, { label: 'ลบถาวร', cls: 'danger' }]);
        if (r && r.i === 1) { await rpc('admin_delete', { p_pass: pass, p_id: id }); await loadSchools(); toast('ลบแล้ว', 'ok'); }
      }
    } catch (er) { toast(er.message, 'warn'); }
  });

  $('#r-body').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const id = b.closest('tr').dataset.id, r = regs.find((x) => x.id === id);
    try {
      if (b.dataset.a === 'use') {
        $('#i-names').value = r.school; $('#i-note').value = `คำขอ #${r.ref} ${r.contact} ${r.phone}`;
        document.querySelectorAll('input[name="ig"]').forEach((c) => { c.checked = (r.grades || []).includes(+c.value); });
        $('#issue-card').scrollIntoView({ behavior: 'smooth' }); toast('กรอกฟอร์มออกรหัสให้แล้ว ตรวจสอบแล้วกด "ออกรหัส" แล้วกด "เสร็จแล้ว" ที่คำขอ');
      } else { await rpc('admin_registration_set', { p_pass: pass, p_id: id, p_status: b.dataset.a }); await loadRegs(); }
    } catch (er) { toast(er.message, 'warn'); }
  });

  const saved = sessionStorage.getItem('pre_admin'); if (saved) login(saved, true);
})();
