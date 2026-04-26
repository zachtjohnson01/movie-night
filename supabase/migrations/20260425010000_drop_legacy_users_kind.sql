-- Drop the legacy global `users` row from movie_night and shrink the
-- `kind` check constraint accordingly.
--
-- Background: the Manage Users screen (#126) wrote a single global
-- `(family_id IS NULL, kind='users')` row holding `{email, role}[]`
-- to control which emails could write. PR 6 of the multi-family
-- rollout replaces that mechanism with per-family `family_members`
-- roles and removes the screen + the `useUserRoles` hook. Once the
-- app stops reading id=5, the row + its `kind` value are dead schema.
--
-- Idempotent: safe to apply twice. The DELETE is filtered on `kind`
-- so it can't accidentally hit a library row, and the constraint
-- swap is wrapped in DROP IF EXISTS / re-create.

delete from movie_night where kind = 'users';

alter table movie_night drop constraint if exists movie_night_kind_check;
alter table movie_night
  add constraint movie_night_kind_check
  check (kind in ('library','pool','reasons','weights'));
