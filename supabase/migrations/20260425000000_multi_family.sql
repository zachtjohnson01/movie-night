-- Multi-family migration (PR 2 of the rollout)
--
-- Adds the families + family_members tables, scopes movie_night by
-- (family_id, kind), and seeds the bootstrap "Johnsons" family with
-- the two existing emails as pre-bound members. Library data is
-- per-family; pool / reasons / weights stay global (family_id NULL).
--
-- Safe to apply in one shot: no DROPs, no DELETEs. Existing 5 rows
-- in movie_night gain family_id (Johnsons UUID for kind='library',
-- NULL for the rest) and kind. id=5 is the dynamic role-grants row
-- written by the Manage Users screen (#126); it stays global until
-- PRs 5/6 replace it with family_members-driven roles, at which
-- point it can be dropped.

create extension if not exists citext;

-- Families directory. Public select for the landing-page enumeration
-- (PR 3); writes restricted via RLS in a follow-up effort.
create table families (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Family-membership index. `user_id` is null until first sign-in
-- binds an invite (see `claim_pending_memberships` below). `email`
-- uses citext so admin invites + Google profiles match regardless
-- of case differences.
create table family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid references auth.users(id),
  email citext not null,
  display_name text,
  role text not null check (role in ('admin','member')),
  is_global_owner boolean not null default false,
  invited_by uuid references auth.users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now()
);

-- One pre-bound row per (family, email). Uses citext so this stays
-- case-insensitive without a separate lower() expression index.
create unique index family_members_family_email_uniq
  on family_members (family_id, email);

-- Lock down the global-owner column. Even when RLS is later
-- tightened, family-admin write policies must NOT be able to
-- escalate a member to global owner. Service-role updates still
-- work because superusers bypass column-level grants.
revoke update (is_global_owner) on family_members from authenticated;

-- Per-family library rows; pool/reasons/weights stay global with
-- family_id IS NULL. `kind` is added nullable, backfilled, then
-- locked NOT NULL so existing data isn't disturbed mid-flight.
alter table movie_night
  add column family_id uuid references families(id) on delete cascade,
  add column kind text;

update movie_night set kind = case id
  when 1 then 'library'
  when 2 then 'pool'
  when 3 then 'reasons'
  when 4 then 'weights'
  when 5 then 'users'
end;

alter table movie_night alter column kind set not null;
alter table movie_night
  add constraint movie_night_kind_check
  check (kind in ('library','pool','reasons','weights','users'));

-- One library row per family (enforced for non-null family_id).
create unique index movie_night_family_library_uniq
  on movie_night (family_id, kind)
  where family_id is not null;

-- Exactly one global row per kind (pool / reasons / weights).
-- The legacy library row keeps family_id non-null after backfill,
-- so this index doesn't conflict with it.
create unique index movie_night_global_kind_uniq
  on movie_night (kind)
  where family_id is null;

-- Bootstrap the Johnsons family with a fixed UUID so app code can
-- reference it as a constant during cutover (DEFAULT_FAMILY_UUID
-- in src/supabase.ts). Random-looking but deterministic.
insert into families (id, slug, name)
  values ('00000001-0000-0000-0000-000000000001', 'johnson', 'The Johnsons');

-- Backfill the library row to point at the Johnsons. Pool, reasons,
-- and weights stay global (family_id NULL) — they're shared across
-- every family per the design doc.
update movie_night
  set family_id = '00000001-0000-0000-0000-000000000001'
  where kind = 'library';

-- Pre-bind the two existing users. user_id is null until they next
-- sign in; the claim RPC below then fills it from auth.uid().
insert into family_members (family_id, email, role, is_global_owner) values
  ('00000001-0000-0000-0000-000000000001', 'zachtjohnson01@gmail.com', 'admin', true),
  ('00000001-0000-0000-0000-000000000001', 'alexandrabjohnson01@gmail.com', 'member', false);

-- Auto-bind RPC: called from useAuth after every sign-in. Idempotent
-- — returns 0 if there's nothing pending. SECURITY DEFINER lets it
-- update rows the caller doesn't yet have access to (because
-- user_id is null pre-bind).
create or replace function public.claim_pending_memberships()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update family_members
    set user_id = auth.uid(),
        joined_at = coalesce(joined_at, now())
    where user_id is null
      and email = auth.email();
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.claim_pending_memberships() to authenticated;

-- Family-creation RPC: single-transaction bootstrap for new sign-ups.
-- Creates the families row, the admin family_members row, and the
-- empty library row in one shot so we never leave a half-created
-- family in the DB.
create or replace function public.create_family(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'slug required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name required';
  end if;
  insert into families (slug, name, created_by)
    values (lower(trim(p_slug)), trim(p_name), auth.uid())
    returning id into new_id;
  insert into family_members (family_id, user_id, email, role, joined_at)
    values (new_id, auth.uid(), auth.email(), 'admin', now());
  insert into movie_night (family_id, kind, movies)
    values (new_id, 'library', '[]'::jsonb);
  return new_id;
end;
$$;

grant execute on function public.create_family(text, text) to authenticated;

-- Permissive RLS on the new tables matches the existing posture for
-- movie_night (currently `using (true)` on all operations). The
-- multi-family migration plan tracks tightening RLS as a follow-up
-- effort; for now these are public-readable / authenticated-writable
-- so the app keeps working without an immediate auth refactor.
alter table families enable row level security;
alter table family_members enable row level security;

create policy families_public_select on families for select using (true);
create policy families_auth_insert on families for insert to authenticated with check (true);
create policy families_auth_update on families for update to authenticated using (true) with check (true);

create policy family_members_public_select on family_members for select using (true);
create policy family_members_auth_insert on family_members for insert to authenticated with check (true);
create policy family_members_auth_update on family_members for update to authenticated using (true) with check (true);
create policy family_members_auth_delete on family_members for delete to authenticated using (true);
