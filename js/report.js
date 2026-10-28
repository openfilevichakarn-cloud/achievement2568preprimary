/* report.js — สร้างเอกสาร HTML: แบบรายงานผลความสามารถรายบุคคล และสรุปผลทั้งห้อง (ใช้ทั้งบนจอและพิมพ์) */
(function (root) {
  'use strict';
  const { DOMAINS, DESC, GRADES } = root.PPCurr;
  const E = root.PPEngine;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lv = (n) => (n >= 1 && n <= 3 ? String(n) : '–');

  // กลุ่มหัวข้อใหญ่ตามแบบรายงาน: 1-3 เป็นด้านเดียว, 4 ด้านสติปัญญา แบ่ง ก-จ
  const SECTIONS = [
    { n: 1, title: 'ด้านสุขภาวะทางกาย', doms: ['phys'] },
    { n: 2, title: 'ด้านอารมณ์ จิตใจ และสังคม', doms: ['emo'] },
    { n: 3, title: 'ด้านความเป็นพลเมือง และความเป็นไทย', doms: ['civic'] },
    { n: 4, title: 'ด้านสติปัญญา', doms: ['lang', 'math', 'solve', 'seek', 'create'], sub: ['ก', 'ข', 'ค', 'ง', 'จ'] },
  ];
  const dom = (id) => DOMAINS.find((d) => d.id === id);

  function logoImg(ctx) { return ctx.logo ? `<img src="${esc(ctx.logo)}" alt="">` : ''; }

  /** แบบรายงานผลความสามารถรายบุคคล ของนักเรียน 1 คน
   *  opt.editable = true: ช่อง "จุดเด่นความสามารถ" เป็นกล่องข้อความแก้ไขได้บนจอ */
  function student(ctx, sid, opt) {
    opt = opt || {};
    const d = ctx.data, info = d.info;
    const st = d.students.find((x) => x.id === sid);
    if (!st) return '';
    const no = d.students.indexOf(st) + 1;
    const sum = {}; E.studentSummary(d, sid).forEach((r) => { sum[r.id] = r; });
    const desc = DESC[ctx.grade] || DESC[1];
    const hiOf = (domId, k) => ((d.hi[sid] || {})[domId] || [])[k] || '';
    const hiCell = (domId, k, span) => {
      const v = hiOf(domId, k);
      const inner = opt.editable
        ? `<textarea data-hi="${domId}:${k}" data-sid="${esc(sid)}" maxlength="400" placeholder="พิมพ์จุดเด่น">${esc(v)}</textarea>`
        : esc(v);
      return `<td class="hi" rowspan="${span}">${inner}</td>`;
    };

    let rows = '';
    const domBlock = (dm, label, cls) => {
      const span = 1 + dm.inds.length; const s = sum[dm.id];
      let h = `<tr class="${cls}"><td>${esc(label)}</td><td class="lv">${lv(s.t1)}</td>${hiCell(dm.id, 0, span)}<td class="lv">${lv(s.t2)}</td>${hiCell(dm.id, 1, span)}</tr>`;
      for (const ind of dm.inds) {
        h += `<tr class="ind"><td class="t"><b>${esc(ind.id + ' ' + ind.t)}</b><div class="dsc">${esc(ind.id + '.1 ' + (desc[ind.id] || ''))}</div></td><td class="lv">${lv(E.getScore(d, sid, ind.id, 0))}</td><td class="lv">${lv(E.getScore(d, sid, ind.id, 1))}</td></tr>`;
      }
      return h;
    };
    // ช่องจุดเด่น rowspan ทั้งด้าน (หัวด้าน + ทุกสภาพที่พึงประสงค์) แถวสภาพที่พึงประสงค์จึงมีแค่ 3 ช่อง
    for (const sec of SECTIONS) {
      if (sec.sub) {
        rows += `<tr class="maj"><td colspan="5">${sec.n}. ${esc(sec.title)}</td></tr>`;
        sec.doms.forEach((id, i) => { const dm = dom(id); rows += domBlock(dm, `${sec.sub[i]}. ${dm.name}`, 'sub'); });
      } else {
        const dm = dom(sec.doms[0]); rows += domBlock(dm, `${sec.n}. ${sec.title}`, 'dom');
      }
    }

    const sign = (name, role) => `<div><p class="line">ลงชื่อ.............................................................</p><p>${esc(name ? '(' + name + ')' : '')}</p><p>${esc(role)}</p></div>`;
    const signs = [sign(info.teacher, 'ครูประจำชั้น'), sign(info.academic, 'หัวหน้างานวิชาการ')];
    if (info.deputy) signs.push(sign(info.deputy, 'รองผู้อำนวยการ' + ctx.schoolName));
    signs.push(sign(info.director, 'ผู้อำนวยการ' + ctx.schoolName));

    return `<div class="rp">
  <div class="rp-head">${logoImg(ctx)}<div><h1>แบบรายงานผลความสามารถรายบุคคล</h1>
  <p class="rp-sub">${esc(ctx.schoolName)}${info.area ? ' · ' + esc(info.area) : ''}</p></div></div>
  <div class="rp-id"><span><b>ชื่อ - สกุล</b> ${esc(st.name)}</span><span><b>เลขที่</b> ${no}</span><span><b>ชั้น</b> ${esc(GRADES[ctx.grade])}${ctx.room > 1 ? '/' + ctx.room : ''}</span><span><b>ปีการศึกษา</b> ${esc(info.year || ctx.year)}</span></div>
  <table>
    <colgroup><col style="width:46%"><col style="width:9%"><col style="width:20%"><col style="width:9%"><col style="width:16%"></colgroup>
    <thead>
      <tr><th rowspan="2">ความสามารถผู้เรียน</th><th colspan="4">ผลการประเมินความสามารถ</th></tr>
      <tr><th>ภาคเรียนที่ 1</th><th>จุดเด่นความสามารถ</th><th>ภาคเรียนที่ 2</th><th>จุดเด่นความสามารถ</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="rp-note">คำอธิบาย ระดับคุณภาพ 3 หมายถึง ดี · 2 หมายถึง พอใช้ · 1 หมายถึง ควรส่งเสริม</p>
  <div class="rp-sign">${signs.join('')}</div>
</div>`;
  }

  /** สรุปผลทั้งห้อง (ตารางกว้าง ใช้แนวนอน): ภาคเรียน 1 / 2 / ภาพรวม ต่อด้าน */
  function classSummary(ctx) {
    const d = ctx.data, info = d.info;
    const head1 = DOMAINS.map((dm) => `<th colspan="3">${esc(dm.name)}</th>`).join('');
    const head2 = DOMAINS.map(() => '<th>1</th><th>2</th><th>รวม</th>').join('');
    const body = d.students.map((s, i) => {
      const sm = E.studentSummary(d, s.id);
      return `<tr><td class="c">${i + 1}</td><td class="l">${esc(s.name)}</td>${sm.map((r) => `<td>${lv(r.t1)}</td><td>${lv(r.t2)}</td><td><b>${lv(r.all)}</b></td>`).join('')}</tr>`;
    }).join('');
    return `<div class="rp cs">
  <div class="rp-head">${logoImg(ctx)}<div><h1>สรุปผลการประเมินความสามารถผู้เรียน ระดับปฐมวัย</h1>
  <p class="rp-sub">${esc(ctx.schoolName)} · ชั้น${esc(GRADES[ctx.grade])}${ctx.room > 1 ? '/' + ctx.room : ''} · ปีการศึกษา ${esc(info.year || ctx.year)} · ครูประจำชั้น ${esc(info.teacher || '-')}</p></div></div>
  <table class="cst"><thead><tr><th rowspan="2" style="width:30px">ที่</th><th rowspan="2" style="width:170px">ชื่อ - สกุล</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${body}</tbody></table>
  <p class="rp-note">ภาคเรียนที่ 1 / 2 / รวม = ผลสรุปรายด้าน (ระดับ 3 ดี · 2 พอใช้ · 1 ควรส่งเสริม) · "–" = ยังไม่ได้ประเมิน</p>
</div>`;
  }

  root.PPReport = { student, classSummary, esc, lv, SECTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
