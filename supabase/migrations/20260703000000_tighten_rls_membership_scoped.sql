-- Tighten RLS from the permissive multi-family bootstrap posture to
-- membership-scoped writes. The 20260425000000_multi_family migration shipped
-- deliberately-permissive policies ("writes restricted via RLS in a follow-up
-- effort") that were never tightened. This is that follow-up. It closes two
-- holes, both verified against the live database before/after:
--
--   1. movie_night carried legacy public UPDATE/INSERT policies (USING true)
--      that OR-override the newer email-allowlist policies, so the anon key
--      shipped in the client bundle could rewrite every family's library, the
--      candidate pool, and the scoring weights with no sign-in at all.
--
--   2. family_members allowed any authenticated user to INSERT a row, and the
--      is_global_owner column was only protected by a column-level UPDATE
--      revoke that a blanket TABLE-level grant silently overrode. So a signed-in
--      user could insert a self-owned row with is_global_owner = true and unlock
--      the credit-spending Anthropic endpoints (api/enrich|verify|recommendations
--      gate on that flag). Emails were also world-readable.
--
-- This migration was applied to production directly via the Supabase MCP in
-- three steps; it is consolidated here as the single source of truth so a
-- fresh rebuild reproduces the same end state.

-- ============================ Membership helpers ============================
-- SECURITY DEFINER (owner = postgres, the table owner) so they bypass RLS on
-- family_members and don't recurse when referenced inside family_members'
-- own policies.
create or replace function public.is_family_member(fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_members m
    where m.family_id = fid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_family_admin(fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_members m
    where m.family_id = fid and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

create or replace function public.is_family_member_any()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from family_members m where m.user_id = auth.uid());
$$;

-- Functions default to EXECUTE for PUBLIC; revoke that (removes anon) and grant
-- only to authenticated. Authenticated must retain EXECUTE because these are
-- evaluated inside RLS policies.
revoke execute on function public.is_family_member(uuid) from public;
revoke execute on function public.is_family_admin(uuid) from public;
revoke execute on function public.is_family_member_any() from public;
grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.is_family_admin(uuid) to authenticated;
grant execute on function public.is_family_member_any() to authenticated;

-- =============================== movie_night ===============================
drop policy if exists "anyone can write" on movie_night;
drop policy if exists "anyone can insert" on movie_night;
drop policy if exists "anyone can read" on movie_night;
drop policy if exists "public read" on movie_night;
drop policy if exists "allowlisted update" on movie_night;
drop policy if exists "allowlisted insert" on movie_night;

-- Read stays public: the share/poster/movies API endpoints and the signed-out
-- landing page read the blob unauthenticated. It's a family movie list, already
-- surfaced by /api/movies and iMessage unfurls.
create policy movie_night_public_select on movie_night
  for select using (true);

-- Library rows are per-family. Pool/reasons/weights are global (family_id IS
-- NULL) and are written as a side effect of any member's add/edit (the
-- candidate-seed path), so any signed-in family member may write them.
create policy movie_night_member_update on movie_night
  for update using (
    (family_id is not null and public.is_family_member(family_id))
    or (family_id is null and public.is_family_member_any())
  ) with check (
    (family_id is not null and public.is_family_member(family_id))
    or (family_id is null and public.is_family_member_any())
  );

create policy movie_night_member_insert on movie_night
  for insert with check (
    (family_id is not null and public.is_family_member(family_id))
    or (family_id is null and public.is_family_member_any())
  );

-- ============================== family_members =============================
drop policy if exists family_members_public_select on family_members;
drop policy if exists family_members_auth_insert on family_members;
drop policy if exists family_members_auth_update on family_members;
drop policy if exists family_members_auth_delete on family_members;

-- Roster is visible to that family's members only (was world-readable, leaking
-- every member email).
create policy family_members_member_select on family_members
  for select using (public.is_family_member(family_id));

-- Only admins invite / edit / remove. The first admin row for a new family is
-- created by create_family (SECURITY DEFINER, bypasses RLS); the null user_id
-- binding on first sign-in is done by claim_pending_memberships (also DEFINER).
create policy family_members_admin_insert on family_members
  for insert with check (public.is_family_admin(family_id));
create policy family_members_admin_update on family_members
  for update using (public.is_family_admin(family_id))
              with check (public.is_family_admin(family_id));
create policy family_members_admin_delete on family_members
  for delete using (public.is_family_admin(family_id));

-- Close the is_global_owner escalation for real. A column-level revoke is
-- useless while a blanket table-level grant exists (that's why the multi-family
-- migration's `revoke update (is_global_owner)` had no effect). Drop the
-- table-level write grants and re-grant every column EXCEPT is_global_owner.
-- RLS still restricts WHO writes (admins); this restricts WHICH columns.
-- create_family / claim_pending_memberships run as DEFINER (owner postgres) and
-- are unaffected.
revoke insert, update on family_members from authenticated;
revoke insert (is_global_owner), update (is_global_owner) on family_members from authenticated;
revoke insert, update, delete on family_members from anon;
grant insert (family_id, user_id, email, display_name, role, invited_by, joined_at)
  on family_members to authenticated;
grant update (family_id, user_id, email, display_name, role, invited_by, joined_at)
  on family_members to authenticated;

-- ================================= families ================================
drop policy if exists families_auth_insert on families;
drop policy if exists families_auth_update on families;
-- families_public_select (read) stays: landing directory + share slug lookup.

-- Creation goes through create_family (SECURITY DEFINER); only admins rename.
create policy families_admin_update on families
  for update using (public.is_family_admin(id))
              with check (public.is_family_admin(id));

-- ========================= SECURITY DEFINER RPC access =====================
-- Both require a session (auth.uid()/email); revoke the default PUBLIC EXECUTE
-- (removes anon) and grant only to authenticated.
revoke execute on function public.create_family(text, text) from public;
revoke execute on function public.claim_pending_memberships() from public;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.claim_pending_memberships() to authenticated;

-- Accepted, not addressed here (low severity / out of scope):
--   * citext extension lives in public schema — moving it risks the
--     family_members.email column type on a live DB.
--   * Leaked-password protection is disabled — N/A: auth is Google-OAuth-only,
--     there are no password sign-ups. Toggle in the dashboard if that changes.
