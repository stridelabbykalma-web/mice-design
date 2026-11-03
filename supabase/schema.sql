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
