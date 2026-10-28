/* register.js — หน้าสมัครใช้งาน: ส่งคำขอเข้า Supabase (RPC register_school) */
(function () {
  'use strict';
  const CFG = window.PP_CONFIG || {}, S = CFG.SALES || {};
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  if ((S.PACKAGES || []).length) {
    $('#pkg').hidden = false;
    $('#pkg-list').innerHTML = S.PACKAGES.map((p) => `<div class="pkg ${p.hot ? 'hot' : ''}"><b>${esc(p.name)}</b><div class="price">${esc(p.price)} <small>${esc(p.unit || '')}</small></div><ul>${(p.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
  }
  const links = [];
  if (S.MESSENGER) links.push(`<a class="btn primary" href="${esc(S.MESSENGER)}" target="_blank" rel="noopener">แชทเพจ</a>`);
  if (S.FACEBOOK) links.push(`<a class="btn" href="${esc(S.FACEBOOK)}" target="_blank" rel="noopener">Facebook</a>`);
  if (S.LINE_ID) links.push(`<span class="btn">LINE ${esc(S.LINE_ID)}</span>`);
  if (S.PHONE) links.push(`<a class="btn" href="tel:${esc(S.PHONE)}">โทร ${esc(S.PHONE)}</a>`);
  $('#contacts').innerHTML = links.join('') || '<span class="hint">ส่งแบบฟอร์มด้านบน ผู้ดูแลจะติดต่อกลับ</span>';

  $('#rg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f), err = $('#rg-err'); err.textContent = '';
    const grades = Array.from(f.querySelectorAll('input[name="g"]:checked')).map((x) => +x.value);
    if (!grades.length) { err.textContent = 'กรุณาเลือกชั้นอย่างน้อย 1 ชั้น'; return; }
    if (!CFG.SUPABASE_URL) { err.textContent = 'ระบบยังไม่ได้เชื่อมต่อฐานข้อมูล'; return; }
    const p = Object.fromEntries(fd.entries()); p.grades = grades;
    const btn = $('#rg-go'); btn.disabled = true;
    try {
      const res = await fetch(`${CFG.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/register_school`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY }, body: JSON.stringify({ p }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok === false) throw new Error((json && (json.error || json.message)) || 'ส่งไม่สำเร็จ');
      f.hidden = true; $('#rg-ref').textContent = json.ref; $('#rg-ok').hidden = false;
    } catch (er) { err.textContent = er.message || 'เชื่อมต่อไม่ได้'; } finally { btn.disabled = false; }
  });
})();
