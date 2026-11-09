-- MICE Design · compartir propuestas con el cliente
-- Ejecutar una vez en Supabase: SQL Editor → New query → pegar → Run.
--
-- Seguridad: la app solo usa la clave pública (publishable). Nadie puede listar las
-- propuestas: solo se lee una propuesta conociendo su identificador (UUID del enlace),
-- a través de funciones. Los archivos (escaneos, fotos) van a un bucket público con
-- rutas imposibles de adivinar y sin permiso de listado.

create extension if not exists pgcrypto;

create table if not exists public.shares (
  id uuid primary key,
  created_at timestamptz not null default now(),
  title text check (char_length(title) <= 200),
  project jsonb not null
);

create table if not exists public.share_comments (
  id uuid primary key,
  share_id uuid not null references public.shares (id) on delete cascade,
  created_at timestamptz not null default now(),
  author text not null check (char_length(author) between 1 and 80),
  body text not null check (char_length(body) between 1 and 2000),
  variant text check (char_length(variant) <= 100),
  x double precision,
  z double precision,
  resolved boolean not null default false
);

create index if not exists share_comments_share_idx on public.share_comments (share_id, created_at);

alter table public.shares enable row level security;
alter table public.share_comments enable row level security;

-- Publicar una propuesta y comentar: permitido; leer y listar directamente: no.
drop policy if exists "publicar propuestas" on public.shares;
create policy "publicar propuestas" on public.shares for insert to anon, authenticated with check (char_length(project::text) < 20000000);

drop policy if exists "comentar" on public.share_comments;
create policy "comentar" on public.share_comments for insert to anon, authenticated
  with check (exists (select 1 from public.shares s where s.id = share_id));

-- Lectura solo por identificador
create or replace function public.get_share(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'created_at', s.created_at, 'title', s.title, 'project', s.project)
  from public.shares s where s.id = p_id
$$;

create or replace function public.get_comments(p_share uuid)
returns setof public.share_comments language sql stable security definer set search_path = public as $$
  select * from public.share_comments c where c.share_id = p_share order by c.created_at
$$;

create or replace function public.set_comment_resolved(p_comment uuid, p_share uuid, p_resolved boolean)
returns void language sql security definer set search_path = public as $$
  update public.share_comments set resolved = p_resolved where id = p_comment and share_id = p_share
$$;

revoke all on function public.get_share(uuid) from public;
revoke all on function public.get_comments(uuid) from public;
revoke all on function public.set_comment_resolved(uuid, uuid, boolean) from public;
grant execute on function public.get_share(uuid) to anon, authenticated;
grant execute on function public.get_comments(uuid) to anon, authenticated;
grant execute on function public.set_comment_resolved(uuid, uuid, boolean) to anon, authenticated;

-- Archivos de las propuestas (escaneos, fotos de paredes, cuadros…)
insert into storage.buckets (id, name, public)
values ('mice-assets', 'mice-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "subir archivos de propuestas" on storage.objects;
create policy "subir archivos de propuestas" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'mice-assets');

-- ============================================================================
-- Sincronización entre dispositivos (ordenador ↔ móvil)
-- Un «espacio de trabajo» se identifica por un UUID aleatorio que solo conocen los
-- dispositivos vinculados (código QR). Sin políticas directas: todo pasa por funciones
-- que exigen ese identificador, así que nadie puede listar espacios ajenos.
-- ============================================================================

create table if not exists public.ws_items (
  workspace uuid not null,
  kind text not null check (kind in ('project', 'library')),
  id text not null check (char_length(id) <= 100),
  updated_at bigint not null,
  deleted boolean not null default false,
  data jsonb,
  primary key (workspace, kind, id)
);

alter table public.ws_items enable row level security;

create or replace function public.ws_pull(p_ws uuid, p_since bigint)
returns setof public.ws_items language sql stable security definer set search_path = public as $$
  select * from public.ws_items where workspace = p_ws and updated_at > p_since order by updated_at
$$;

-- Gana la versión más reciente (updated_at mayor)
create or replace function public.ws_push(p_ws uuid, p_kind text, p_id text, p_updated bigint, p_deleted boolean, p_data jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.ws_items (workspace, kind, id, updated_at, deleted, data)
  values (p_ws, p_kind, p_id, p_updated, p_deleted, case when p_deleted then null else p_data end)
  on conflict (workspace, kind, id) do update
    set updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data
    where public.ws_items.updated_at < excluded.updated_at
$$;

revoke all on function public.ws_pull(uuid, bigint) from public;
revoke all on function public.ws_push(uuid, text, text, bigint, boolean, jsonb) from public;
grant execute on function public.ws_pull(uuid, bigint) to anon, authenticated;
grant execute on function public.ws_push(uuid, text, text, bigint, boolean, jsonb) to anon, authenticated;
-- Los archivos de los espacios de trabajo usan el mismo bucket, en ws/<espacio>/<archivo>.

-- ============================================================================
-- Cuentas de hotel (inicio de sesión)
-- Cada hotel tiene sus salas, proyectos y catálogo. Las personas entran con correo y
-- contraseña (Supabase Auth); las gafas y los móviles del equipo se emparejan con un
-- código de un solo uso, sin escribir contraseñas (inicio de sesión anónimo).
--   · admin: todo, incluido invitar a otras personas como admin.
--   · editor: diseña y edita; puede emparejar dispositivos.
--   · viewer: solo ver (gafas, pantallas); recibe los cambios en directo.
-- En Supabase: Authentication → Sign In / Providers → activar «Allow anonymous sign-ins»
-- (para las gafas) y, si se quiere entrar sin confirmar el correo, desactivar «Confirm email».
-- ============================================================================

create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.hotel_members (
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  label text check (char_length(label) <= 120),
  created_at timestamptz not null default now(),
  primary key (hotel_id, user_id)
);

create table if not exists public.hotel_codes (
  code text primary key,
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  project_id text check (char_length(project_id) <= 100),
  label text check (char_length(label) <= 120),
  expires_at timestamptz not null,
  created_by uuid not null
);

create table if not exists public.hotel_items (
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  kind text not null check (kind in ('project', 'library')),
  id text not null check (char_length(id) <= 100),
  updated_at bigint not null,
  deleted boolean not null default false,
  data jsonb,
  primary key (hotel_id, kind, id)
);

-- Sin políticas directas: todo pasa por las funciones de abajo, que comprueban el rol.
alter table public.hotels enable row level security;
alter table public.hotel_members enable row level security;
alter table public.hotel_codes enable row level security;
alter table public.hotel_items enable row level security;

create or replace function public.hotel_role(p_hotel uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.hotel_members where hotel_id = p_hotel and user_id = auth.uid()
$$;

create or replace function public.create_hotel(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Para dar de alta un hotel hace falta una cuenta con correo';
  end if;
  insert into public.hotels (name) values (trim(p_name)) returning id into v;
  insert into public.hotel_members (hotel_id, user_id, role, label) values (v, auth.uid(), 'admin', auth.jwt() ->> 'email');
  return v;
end $$;

create or replace function public.my_hotels()
returns table (id uuid, name text, role text) language sql stable security definer set search_path = public as $$
  select h.id, h.name, m.role from public.hotels h join public.hotel_members m on m.hotel_id = h.id
  where m.user_id = auth.uid() order by h.name
$$;

-- Código de un solo uso para unir a una persona o emparejar unas gafas / un móvil.
create or replace function public.create_code(p_hotel uuid, p_role text, p_project text, p_label text, p_minutes int)
returns text language plpgsql security definer set search_path = public as $$
declare
  r text := public.hotel_role(p_hotel);
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := gen_random_bytes(8);
  c text := '';
begin
  if r is null or r = 'viewer' then raise exception 'No tienes permiso para invitar'; end if;
  if p_role not in ('admin', 'editor', 'viewer') then raise exception 'Rol no válido'; end if;
  if p_role = 'admin' and r <> 'admin' then raise exception 'Solo un administrador puede invitar administradores'; end if;
  for i in 0..7 loop c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
  delete from public.hotel_codes where expires_at < now();
  insert into public.hotel_codes (code, hotel_id, role, project_id, label, expires_at, created_by)
  values (c, p_hotel, p_role, p_project, p_label, now() + make_interval(mins => greatest(5, least(coalesce(p_minutes, 30), 10080))), auth.uid());
  return c;
end $$;

create or replace function public.join_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.hotel_codes;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  select * into k from public.hotel_codes
  where code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) and expires_at > now() for update;
  if not found then raise exception 'El código no es válido o ha caducado'; end if;
  insert into public.hotel_members (hotel_id, user_id, role, label)
  values (k.hotel_id, auth.uid(), k.role, coalesce(auth.jwt() ->> 'email', k.label))
  on conflict (hotel_id, user_id) do update set role = excluded.role
    where public.hotel_members.role = 'viewer' or excluded.role = 'admin';
  delete from public.hotel_codes where code = k.code;
  return jsonb_build_object('hotel_id', k.hotel_id, 'name', (select name from public.hotels where id = k.hotel_id),
    'role', public.hotel_role(k.hotel_id), 'project_id', k.project_id);
end $$;

create or replace function public.hotel_members_list(p_hotel uuid)
returns table (user_id uuid, role text, label text, created_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, m.label, m.created_at, m.user_id = auth.uid()
  from public.hotel_members m where m.hotel_id = p_hotel and public.hotel_role(p_hotel) is not null
  order by m.created_at
$$;

create or replace function public.hotel_remove_member(p_hotel uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- coalesce: quien no pertenece al hotel tiene rol NULL y, sin él, la comparación no impediría nada
  if coalesce(public.hotel_role(p_hotel), '') <> 'admin' and p_user <> auth.uid() then raise exception 'Solo un administrador puede quitar miembros'; end if;
  delete from public.hotel_members where hotel_id = p_hotel and user_id = p_user;
end $$;

create or replace function public.hotel_pull(p_hotel uuid, p_since bigint)
returns setof public.hotel_items language plpgsql stable security definer set search_path = public as $$
begin
  if public.hotel_role(p_hotel) is null then raise exception 'No perteneces a este hotel'; end if;
  return query select * from public.hotel_items where hotel_id = p_hotel and updated_at > p_since order by updated_at;
end $$;

create or replace function public.hotel_push(p_hotel uuid, p_kind text, p_id text, p_updated bigint, p_deleted boolean, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.hotel_role(p_hotel), 'viewer') = 'viewer' then raise exception 'No tienes permiso para editar'; end if;
  insert into public.hotel_items (hotel_id, kind, id, updated_at, deleted, data)
  values (p_hotel, p_kind, p_id, p_updated, p_deleted, case when p_deleted then null else p_data end)
  on conflict (hotel_id, kind, id) do update
    set updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data
    where public.hotel_items.updated_at < excluded.updated_at;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'hotel_role(uuid)', 'create_hotel(text)', 'my_hotels()', 'create_code(uuid, text, text, text, int)', 'join_code(text)',
    'hotel_members_list(uuid)', 'hotel_remove_member(uuid, uuid)', 'hotel_pull(uuid, bigint)',
    'hotel_push(uuid, text, text, bigint, boolean, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Archivos de cada hotel (escaneos, fotos): bucket privado, carpeta <hotel>/<archivo>.
insert into storage.buckets (id, name, public) values ('mice-hotel', 'mice-hotel', false)
on conflict (id) do update set public = false;

create or replace function public.storage_hotel_role(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return public.hotel_role(split_part(p_name, '/', 1)::uuid);
exception when others then
  return null;
end $$;
grant execute on function public.storage_hotel_role(text) to authenticated;

drop policy if exists "leer archivos del hotel" on storage.objects;
create policy "leer archivos del hotel" on storage.objects for select to authenticated
  using (bucket_id = 'mice-hotel' and public.storage_hotel_role(name) is not null);

drop policy if exists "subir archivos del hotel" on storage.objects;
create policy "subir archivos del hotel" on storage.objects for insert to authenticated
  with check (bucket_id = 'mice-hotel' and public.storage_hotel_role(name) in ('admin', 'editor'));
