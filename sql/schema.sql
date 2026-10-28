-- =====================================================================
--  โปรแกรมแจ้งผลการประเมินความสามารถผู้เรียน ระดับปฐมวัย หลักสูตร 2568 (เว็บ)
--  โครงสร้างฐานข้อมูล Supabase — Supabase > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้ ข้อมูลไม่หาย)
--  หลักการ
--   * ตารางทั้งหมดเปิด RLS และไม่มี policy => เว็บ (anon key) อ่าน/เขียนตารางตรง ๆ ไม่ได้
--   * เว็บเรียกได้เฉพาะฟังก์ชัน app_* / admin_* / register_school โดยแนบ "รหัสสิทธิ์โรงเรียน" หรือ "รหัสผ่านผู้ดูแล"
--   * ข้อมูลเก็บแยก โรงเรียน + ชั้น (อนุบาล 1–3) + ห้อง (ชั้นละไม่เกิน 10 ห้อง)
--   * รหัสสิทธิ์เก็บเป็น SHA-256 เท่านั้น · รหัสผ่านผู้ดูแลเก็บเป็น bcrypt
--   * ฟังก์ชันออกรหัสที่ไม่ผ่านรหัสผ่านผู้ดูแล (issue_school / reset_school_code / set_admin_password) ใช้ใน SQL Editor เท่านั้น
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- ตาราง ----------
create table if not exists public.schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  code_hash   text not null unique,
  grades      smallint[] not null default '{1,2,3}',
  active      boolean not null default true,
  logo        text,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.school_data (
  school_id   uuid not null references public.schools(id) on delete cascade,
  grade       smallint not null check (grade between 1 and 3),
  room        smallint not null default 1 constraint school_data_room_chk check (room between 1 and 10),
  data        jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  constraint school_data_pkey primary key (school_id, grade, room)
);

create table if not exists public.login_attempts (
  id    bigserial primary key,
  ip    text not null,
  at    timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on public.login_attempts (ip, at);

alter table public.schools        enable row level security;
alter table public.school_data    enable row level security;
alter table public.login_attempts enable row level security;
revoke all on public.schools, public.school_data, public.login_attempts from anon, authenticated;
revoke all on sequence public.login_attempts_id_seq from anon, authenticated;

-- ---------- ฟังก์ชันภายใน ----------
create or replace function public._code_hash(p text) returns text
language sql immutable
set search_path = public, extensions
as $$ select encode(extensions.digest(convert_to(upper(regexp_replace(coalesce(p,''), '[\s-]', '', 'g')), 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public._client_ip() returns text
language sql stable
as $$ select coalesce(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), 'unknown') $$;

-- ตรวจรหัส: คืนแถวโรงเรียน หรือ null (บันทึกความพยายามที่ผิด และจำกัด 20 ครั้ง/10 นาที ต่อ IP)
create or replace function public._auth(p_code text) returns public.schools
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; v_ip text := public._client_ip();
begin
  if (select count(*) from public.login_attempts where ip = v_ip and at > now() - interval '10 minutes') >= 20 then
    return null;
  end if;
  select * into s from public.schools where code_hash = public._code_hash(p_code) and active;
  if not found then
    insert into public.login_attempts(ip) values (v_ip);
    delete from public.login_attempts where at < now() - interval '1 day';
    return null;
  end if;
  return s;
end $$;

create or replace function public._new_code() returns text
language plpgsql volatile
set search_path = public, extensions
as $$
declare raw text := upper(encode(extensions.gen_random_bytes(8), 'hex'));
begin
  return substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4)||'-'||substr(raw,13,4);
end $$;

create or replace function public._clean_grades(p_grades smallint[]) returns smallint[]
language sql immutable
as $$ select coalesce(nullif(array_agg(distinct g order by g), '{}'), '{1,2,3}') from unnest(coalesce(p_grades, '{1,2,3}')) g where g between 1 and 3 $$;

-- ---------- ฟังก์ชันของเจ้าของระบบ (SQL Editor เท่านั้น) ----------
create or replace function public.issue_school(p_name text, p_grades smallint[] default '{1,2,3}') returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare code text := public._new_code();
begin
  insert into public.schools(name, code_hash, grades) values (btrim(p_name), public._code_hash(code), public._clean_grades(p_grades));
  return code;
end $$;

create or replace function public.reset_school_code(p_school_id uuid) returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare code text := public._new_code();
begin
  update public.schools set code_hash = public._code_hash(code) where id = p_school_id;
  if not found then raise exception 'ไม่พบโรงเรียน'; end if;
  return code;
end $$;

-- ---------- ฟังก์ชันที่เว็บเรียกได้ ----------
create or replace function public.app_login(p_code text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง หรือพยายามเข้าสู่ระบบผิดหลายครั้ง (รอ 10 นาทีแล้วลองใหม่)'); end if;
  return jsonb_build_object('ok', true, 'school_name', s.name, 'grades', to_jsonb(s.grades), 'logo', s.logo,
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('grade', d.grade, 'room', d.room) order by d.grade, d.room)
                       from public.school_data d where d.school_id = s.id), '[]'::jsonb));
end $$;

create or replace function public.app_load(p_code text, p_grade smallint, p_room smallint) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; d public.school_data;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if not (p_grade = any (s.grades)) then return jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้ไม่มีสิทธิ์ใช้งานชั้นนี้'); end if;
  select * into d from public.school_data where school_id = s.id and grade = p_grade and room = p_room;
  if not found then return jsonb_build_object('ok', true, 'data', null, 'version', 0); end if;
  return jsonb_build_object('ok', true, 'data', d.data, 'version', d.version);
end $$;

create or replace function public.app_save(p_code text, p_grade smallint, p_room smallint, p_data jsonb, p_base_version integer, p_force boolean default false) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; cur integer; nv integer;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if not (p_grade = any (s.grades)) then return jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้ไม่มีสิทธิ์ใช้งานชั้นนี้'); end if;
  if p_room is null or p_room < 1 or p_room > 10 then return jsonb_build_object('ok', false, 'error', 'ห้องเรียนต้องอยู่ระหว่าง 1-10'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'error', 'รูปแบบข้อมูลไม่ถูกต้อง'); end if;
  if pg_column_size(p_data) > 2000000 then return jsonb_build_object('ok', false, 'error', 'ข้อมูลใหญ่เกินกำหนด (2 MB)'); end if;
  select version into cur from public.school_data where school_id = s.id and grade = p_grade and room = p_room for update;
  if not found then
    insert into public.school_data(school_id, grade, room, data, version) values (s.id, p_grade, p_room, p_data, 1)
    on conflict (school_id, grade, room) do nothing;
    if found then return jsonb_build_object('ok', true, 'version', 1); end if;
    select version into cur from public.school_data where school_id = s.id and grade = p_grade and room = p_room for update;
  end if;
  if cur <> coalesce(p_base_version, 0) and not coalesce(p_force, false) then
    return jsonb_build_object('ok', true, 'conflict', true, 'version', cur);
  end if;
  update public.school_data set data = p_data, version = cur + 1, updated_at = now()
   where school_id = s.id and grade = p_grade and room = p_room returning version into nv;
  return jsonb_build_object('ok', true, 'version', nv);
end $$;

create or replace function public.app_delete_room(p_code text, p_grade smallint, p_room smallint) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  delete from public.school_data where school_id = s.id and grade = p_grade and room = p_room;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_set_logo(p_code text, p_logo text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if p_logo is not null and (p_logo not like 'data:image/%' or length(p_logo) > 400000) then
    return jsonb_build_object('ok', false, 'error', 'ไฟล์รูปตราไม่ถูกต้องหรือใหญ่เกินไป');
  end if;
  update public.schools set logo = p_logo where id = s.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- หน้าผู้ดูแล (admin.html) ----------
create table if not exists public.admin_auth (
  id          smallint primary key default 1 check (id = 1),
  pass_hash   text not null,
  updated_at  timestamptz not null default now()
);
create table if not exists public.admin_attempts (
  id    bigserial primary key,
  ip    text not null,
  at    timestamptz not null default now()
);
create index if not exists admin_attempts_ip_at on public.admin_attempts (ip, at);
alter table public.admin_auth     enable row level security;
alter table public.admin_attempts enable row level security;
revoke all on public.admin_auth, public.admin_attempts from anon, authenticated;
revoke all on sequence public.admin_attempts_id_seq from anon, authenticated;

create or replace function public.set_admin_password(p_pass text) returns text
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_pass, '')) < 10 then raise exception 'รหัสผ่านผู้ดูแลต้องยาวอย่างน้อย 10 ตัวอักษร'; end if;
  insert into public.admin_auth(id, pass_hash) values (1, extensions.crypt(p_pass, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set pass_hash = excluded.pass_hash, updated_at = now();
  return 'ตั้งรหัสผ่านผู้ดูแลแล้ว';
end $$;

create or replace function public._admin_ok(p_pass text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare h text; v_ip text := public._client_ip();
begin
  if (select count(*) from public.admin_attempts where ip = v_ip and at > now() - interval '10 minutes') >= 10 then return false; end if;
  select pass_hash into h from public.admin_auth where id = 1;
  if h is not null and extensions.crypt(coalesce(p_pass, ''), h) = h then return true; end if;
  insert into public.admin_attempts(ip) values (v_ip);
  delete from public.admin_attempts where at < now() - interval '1 day';
  return false;
end $$;

create or replace function public.admin_login(p_pass text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง หรือพยายามผิดหลายครั้ง (รอ 10 นาที)'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_list(p_pass text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  return jsonb_build_object('ok', true, 'schools', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'grades', to_jsonb(s.grades), 'active', s.active, 'note', s.note, 'created_at', s.created_at,
      'saves', coalesce((select jsonb_agg(jsonb_build_object('grade', d.grade, 'room', d.room, 'version', d.version, 'updated_at', d.updated_at) order by d.grade, d.room)
                         from public.school_data d where d.school_id = s.id), '[]'::jsonb)
    ) order by s.created_at desc)
    from public.schools s), '[]'::jsonb));
end $$;

create or replace function public.admin_issue(p_pass text, p_names text[], p_grades smallint[] default '{1,2,3}', p_note text default null) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare n text; code text; out jsonb := '[]'::jsonb; sid uuid;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  if coalesce(array_length(p_names, 1), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อโรงเรียน'); end if;
  if array_length(p_names, 1) > 200 then return jsonb_build_object('ok', false, 'error', 'ออกได้ครั้งละไม่เกิน 200 โรงเรียน'); end if;
  foreach n in array p_names loop
    n := btrim(coalesce(n, ''));
    continue when n = '';
    code := public._new_code();
    insert into public.schools(name, code_hash, grades, note) values (n, public._code_hash(code), public._clean_grades(p_grades), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into sid;
    out := out || jsonb_build_object('id', sid, 'name', n, 'code', code);
  end loop;
  return jsonb_build_object('ok', true, 'issued', out);
end $$;

create or replace function public.admin_reset(p_pass text, p_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare code text := public._new_code();
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  update public.schools set code_hash = public._code_hash(code) where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบโรงเรียน'); end if;
  return jsonb_build_object('ok', true, 'code', code);
end $$;

create or replace function public.admin_update(p_pass text, p_id uuid, p_name text default null, p_grades smallint[] default null, p_active boolean default null, p_note text default null) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  if p_name is not null and btrim(p_name) = '' then return jsonb_build_object('ok', false, 'error', 'ชื่อโรงเรียนว่างไม่ได้'); end if;
  update public.schools set
    name   = coalesce(nullif(btrim(p_name), ''), name),
    grades = case when p_grades is null then grades else public._clean_grades(p_grades) end,
    active = coalesce(p_active, active),
    note   = case when p_note is null then note else nullif(btrim(p_note), '') end
   where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบโรงเรียน'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ลบโรงเรียนถาวร (พร้อมข้อมูลทั้งหมดของโรงเรียนนั้น)
create or replace function public.admin_delete(p_pass text, p_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  delete from public.schools where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบโรงเรียน'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- หน้าสมัครใช้งาน (register.html) ----------
create table if not exists public.registrations (
  id          uuid primary key default gen_random_uuid(),
  school      text not null,
  area        text,
  contact     text not null,
  position    text,
  phone       text not null,
  line_id     text,
  email       text,
  grades      smallint[] not null default '{}',
  rooms       smallint,
  note        text,
  status      text not null default 'new' check (status in ('new', 'done', 'cancel')),
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists registrations_ip_at on public.registrations (ip, created_at);
alter table public.registrations enable row level security;
revoke all on public.registrations from anon, authenticated;

create or replace function public.register_school(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_ip text := public._client_ip(); t text; r public.registrations; g smallint[];
begin
  if coalesce(p->>'website', '') <> '' then return jsonb_build_object('ok', true, 'ref', 'OK'); end if;   -- กับดักบอท
  if (select count(*) from public.registrations where ip = v_ip and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.registrations where created_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'error', 'ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง หรือติดต่อทางเพจ');
  end if;
  t := btrim(coalesce(p->>'school', ''));
  if length(t) < 3 or length(t) > 200 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อโรงเรียน'); end if;
  if length(btrim(coalesce(p->>'contact', ''))) < 2 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อผู้ติดต่อ'); end if;
  if length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) < 9 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง'); end if;
  select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into g
    from jsonb_array_elements_text(coalesce(p->'grades', '[]')) x where x ~ '^[1-3]$';
  if cardinality(g) = 0 then return jsonb_build_object('ok', false, 'error', 'กรุณาเลือกชั้นที่ต้องการอย่างน้อย 1 ชั้น'); end if;
  insert into public.registrations(school, area, contact, position, phone, line_id, email, grades, rooms, note, ip)
  values (left(t, 200), left(btrim(p->>'area'), 200), left(btrim(p->>'contact'), 100), left(btrim(p->>'position'), 100),
          left(btrim(p->>'phone'), 30), left(btrim(p->>'line_id'), 60), left(btrim(p->>'email'), 120), g,
          case when coalesce(p->>'rooms', '') ~ '^\d{1,2}$' then least((p->>'rooms')::int, 60)::smallint end,
          left(btrim(p->>'note'), 1000), v_ip)
  returning * into r;
  return jsonb_build_object('ok', true, 'ref', upper(left(replace(r.id::text, '-', ''), 6)));
end $$;

create or replace function public.admin_registrations(p_pass text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'ref', upper(left(replace(id::text, '-', ''), 6)), 'school', school, 'area', area,
      'contact', contact, 'position', position, 'phone', phone, 'line_id', line_id, 'email', email, 'grades', to_jsonb(grades),
      'rooms', rooms, 'note', note, 'status', status, 'created_at', created_at) order by created_at desc)
    from (select * from public.registrations order by created_at desc limit 500) x), '[]'::jsonb));
end $$;

create or replace function public.admin_registration_set(p_pass text, p_id uuid, p_status text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  if p_status not in ('new', 'done', 'cancel') then return jsonb_build_object('ok', false, 'error', 'สถานะไม่ถูกต้อง'); end if;
  update public.registrations set status = p_status where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- กันโปรเจกต์ Supabase แบบฟรีหยุดอัตโนมัติ (เรียกจาก .github/workflows/keepalive.yml)
create or replace function public.ping() returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform 1 from public.schools limit 1;
  return jsonb_build_object('ok', true, 'at', now());
end $$;

-- ---------- สิทธิ์การเรียกฟังก์ชัน ----------
revoke all on function
  public._code_hash(text), public._client_ip(), public._auth(text), public._new_code(), public._clean_grades(smallint[]),
  public.issue_school(text, smallint[]), public.reset_school_code(uuid), public.set_admin_password(text), public._admin_ok(text),
  public.app_login(text), public.app_load(text, smallint, smallint), public.app_save(text, smallint, smallint, jsonb, integer, boolean),
  public.app_delete_room(text, smallint, smallint), public.app_set_logo(text, text),
  public.admin_login(text), public.admin_list(text), public.admin_issue(text, text[], smallint[], text),
  public.admin_reset(text, uuid), public.admin_update(text, uuid, text, smallint[], boolean, text), public.admin_delete(text, uuid),
  public.register_school(jsonb), public.admin_registrations(text), public.admin_registration_set(text, uuid, text), public.ping()
  from public, anon, authenticated;

grant execute on function
  public.app_login(text), public.app_load(text, smallint, smallint), public.app_save(text, smallint, smallint, jsonb, integer, boolean),
  public.app_delete_room(text, smallint, smallint), public.app_set_logo(text, text),
  public.admin_login(text), public.admin_list(text), public.admin_issue(text, text[], smallint[], text),
  public.admin_reset(text, uuid), public.admin_update(text, uuid, text, smallint[], boolean, text), public.admin_delete(text, uuid),
  public.register_school(jsonb), public.admin_registrations(text), public.admin_registration_set(text, uuid, text), public.ping()
  to anon, authenticated;

-- =====================================================================
--  วิธีบริหารโรงเรียน (SQL Editor) — หรือใช้หน้า admin.html
--  ตั้งรหัสผ่านผู้ดูแล:  select public.set_admin_password('รหัสผ่านยาวอย่างน้อย10ตัว');
--  ออกสิทธิ์ให้โรงเรียน:  select public.issue_school('โรงเรียนบ้านตัวอย่าง');            -- อนุบาล 1-3
--                          select public.issue_school('โรงเรียนบ้านตัวอย่าง', '{2}');     -- เฉพาะอนุบาล 2
--  ออกรหัสใหม่:           select public.reset_school_code('<school id>');
--  ระงับสิทธิ์:           update public.schools set active = false where id = '<school id>';
-- =====================================================================
