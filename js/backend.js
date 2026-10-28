/* backend.js — เชื่อม Supabase ผ่าน RPC (ไม่ต้องใช้ SDK) + โหมดทดลองในเครื่อง
 * ตารางใน Supabase ปิดด้วย RLS ทั้งหมด เข้าถึงได้ผ่านฟังก์ชัน app_* / admin_* / register_school เท่านั้น */
(function (root) {
  'use strict';
  const norm = (code) => String(code || '').replace(/[\s-]/g, '').toUpperCase();

  class SupabaseBackend {
    constructor(cfg) { this.url = cfg.SUPABASE_URL.replace(/\/$/, ''); this.key = cfg.SUPABASE_ANON_KEY; this.demo = false; }
    async rpc(fn, body, opt) {
      let res;
      try {
        res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
          method: 'POST', keepalive: !!(opt && opt.keepalive),
          headers: { 'Content-Type': 'application/json', apikey: this.key, Authorization: 'Bearer ' + this.key },
          body: JSON.stringify(body),
        });
      } catch (e) { const err = new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้'); err.offline = true; throw err; }
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
      if (!res.ok) {
        const err = new Error((json && (json.message || json.hint)) || ('คำขอล้มเหลว (' + res.status + ')')); err.status = res.status; throw err;
      }
      if (json && json.ok === false) { const err = new Error(json.error || 'ไม่สำเร็จ'); err.denied = true; throw err; }
      return json;
    }
    login(code) { return this.rpc('app_login', { p_code: norm(code) }); }
    load(code, grade, room) { return this.rpc('app_load', { p_code: norm(code), p_grade: grade, p_room: room || 1 }); }
    save(code, grade, room, data, baseVersion, force, opt) {
      return this.rpc('app_save', { p_code: norm(code), p_grade: grade, p_room: room || 1, p_data: data, p_base_version: baseVersion, p_force: !!force }, opt);
    }
    deleteRoom(code, grade, room) { return this.rpc('app_delete_room', { p_code: norm(code), p_grade: grade, p_room: room }); }
    setLogo(code, logo) { return this.rpc('app_set_logo', { p_code: norm(code), p_logo: logo || null }); }
  }

  // โหมดทดลอง: เก็บในเบราว์เซอร์นี้เท่านั้น (ใช้ตอนยังไม่ได้ตั้งค่า Supabase) รหัส DEMO
  class DemoBackend {
    constructor(cfg) { this.demo = true; this.cfg = cfg || {}; this.prefix = 'pre_demo_'; }
    key(g, r) { return this.prefix + g + '_' + (r || 1); }
    ls(fn) { try { return fn(localStorage); } catch (e) { return null; } }
    async login(code) {
      if (norm(code) !== 'DEMO') throw new Error('โหมดทดลองใช้รหัส DEMO');
      const grades = this.cfg.GRADES_READY || [1, 2, 3], rooms = [];
      this.ls((st) => { for (const g of grades) for (let r = 1; r <= 10; r++) if (st.getItem(this.key(g, r)) !== null) rooms.push({ grade: g, room: r }); });
      return { ok: true, school_name: 'โรงเรียนตัวอย่าง (โหมดทดลอง)', grades, rooms, logo: this.ls((st) => st.getItem(this.prefix + 'logo')) };
    }
    async load(code, g, r) { const raw = this.ls((st) => st.getItem(this.key(g, r))); return raw ? JSON.parse(raw) : { data: null, version: 0 }; }
    async save(code, g, r, data, base) {
      const v = (base || 0) + 1; this.ls((st) => st.setItem(this.key(g, r), JSON.stringify({ data, version: v }))); return { ok: true, version: v };
    }
    async deleteRoom(code, g, r) { this.ls((st) => st.removeItem(this.key(g, r))); return { ok: true }; }
    async setLogo(code, logo) { this.ls((st) => (logo ? st.setItem(this.prefix + 'logo', logo) : st.removeItem(this.prefix + 'logo'))); return { ok: true }; }
  }

  root.PPBackend = {
    create(cfg) { return cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY ? new SupabaseBackend(cfg) : new DemoBackend(cfg); },
    Supabase: SupabaseBackend,
    norm,
  };
})(typeof window !== 'undefined' ? window : globalThis);
