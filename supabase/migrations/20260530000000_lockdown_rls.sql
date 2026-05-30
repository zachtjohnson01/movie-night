-- Data-scraping lockdown (PR A of the families-access rollout)
--
-- Until now movie_night / families / family_members were readable with
-- the public anon key (RLS `using (true)`), so anyone holding the bundled
-- publishable key could pull every family's entire library straight from
-- PostgREST and recreate the site. This migration makes reads require an
-- authenticated session AND membership of the family that owns the row.
--
-- Scope of THIS migration (PR A):
--   * Read (SELECT) lockdown on all three tables — the scraping fix.
--   * Library/member writes scoped to family members; global pool /
--     reasons / weights rows (family_id IS NULL) stay writable by any
--     authenticated user, preserving the current pool-admin behavior.
--
-- Deliberately OUT of scope, tracked for PR B:
--   * Cross-family view grants. `can_view_family` currently == membership;
--     PR B widens it to also return true on an APPROVED access grant.
--   * Tightening family_members write policies to family admins only.

-- ---------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so they execute as the table
-- owner and bypass RLS — which is what lets them be called from inside
-- the family_members SELECT policy without infinite recursion (a policy
-- that queried family_members directly would re-trigger itself).
-- STABLE: result is constant within a statement for a given auth.uid().
-- ---------------------------------------------------------------------
create or replace function public.is_family_member(fam uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from family_members
    where family_id = fam
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_view_family(fam uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- PR A: viewing == membership. PR B will OR-in an EXISTS check against
  -- an APPROVED row in family_access_grants whose viewer family the
  -- caller belongs to.
  select public.is_family_member(fam);
$$;

-- Callable by both roles. For anon, auth.uid() is null so both helpers
-- simply return false — granting execute avoids a "permission denied for
-- function" error when an anonymous SELECT evaluates the policy.
revoke all on function public.is_family_member(uuid) from public;
revoke all on function public.can_view_family(uuid) from public;
grant execute on function public.is_family_member(uuid) to anon, authenticated;
grant execute on function public.can_view_family(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- movie_night: replace the permissive `using (true)` policies. The
-- original policies were created outside this repo's migrations (in the
-- single-table era), so drop whatever exists by name before recreating.
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'movie_night'
  loop
    execute format('drop policy %I on public.movie_night', p.policyname);
  end loop;
end $$;

alter table movie_night enable row level security;

-- Read: global rows (pool/reasons/weights) to any signed-in user;
-- per-family library rows only to viewers of that family.
create policy movie_night_select on movie_night
  for select
  using (
    (family_id is null and auth.uid() is not null)
    or (family_id is not null and public.can_view_family(family_id))
  );

-- Writes: members of the owning family for library rows; any signed-in
-- user for global rows (matches the existing pool-admin write path,
-- which the app still gates to the global owner client-side).
create policy movie_night_insert on movie_night
  for insert to authenticated
  with check (family_id is null or public.is_family_member(family_id));

create policy movie_night_update on movie_night
  for update to authenticated
  using (family_id is null or public.is_family_member(family_id))
  with check (family_id is null or public.is_family_member(family_id));

create policy movie_night_delete on movie_night
  for delete to authenticated
  using (family_id is null or public.is_family_member(family_id));

-- ---------------------------------------------------------------------
-- families: drop the public-select policy; signed-in users may still
-- enumerate families (needed for the directory + PR D search), but
-- anonymous visitors get nothing. Insert/update unchanged (creation
-- goes through the create_family SECURITY DEFINER RPC anyway).
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'families'
  loop
    execute format('drop policy %I on public.families', p.policyname);
  end loop;
end $$;

create policy families_auth_select on families
  for select to authenticated using (true);
create policy families_auth_insert on families
  for insert to authenticated with check (true);
create policy families_auth_update on families
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- family_members: was public-select, which leaked every member's email.
-- Restrict reads to members of the same family (via the SECURITY DEFINER
-- helper to avoid self-recursion). Write policies are intentionally left
-- permissive-for-authenticated here and tightened to admins in PR B.
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'family_members'
  loop
    execute format('drop policy %I on public.family_members', p.policyname);
  end loop;
end $$;

create policy family_members_select on family_members
  for select to authenticated
  using (public.is_family_member(family_id));
create policy family_members_insert on family_members
  for insert to authenticated with check (true);
create policy family_members_update on family_members
  for update to authenticated using (true) with check (true);
create policy family_members_delete on family_members
  for delete to authenticated using (true);
