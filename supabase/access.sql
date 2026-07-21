-- ════════════════════════════════════════════════════════════════════════════
-- QRouter — console access control
-- Run this whole file in Supabase → SQL Editor (safe to re-run).
--
-- ⚠️  RUN THIS BEFORE DEPLOYING THE MATCHING CODE. The app calls
--     can_access_console() to decide who may enter /dashboard; until the
--     function exists, that check fails closed and nobody gets in.
--
-- Two lists, both living in the database — no email is hardcoded in the app:
--   public.admin_emails    → who gets the Admin tab.   Edited HERE, in SQL.
--   public.allowed_emails  → who may enter the console. Managed from the
--                            console itself (Admin → Access), which calls the
--                            grant/revoke functions at the bottom of this file.
--
-- Admins always have console access, so you can never lock yourself out of the
-- page you use to approve other people.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ADMINS — EDIT THIS LIST ──────────────────────────────────────────────
-- These accounts get the Admin tab and permanent console access.
insert into public.admin_emails (email, added_by) values
  ('lagodaoleg1357@gmail.com',        'founder'),
  ('qci.research@gmail.com',          'founder'),
  ('gouthamkrishnaronanki@gmail.com', 'founder')
on conflict (email) do nothing;

-- To remove an admin, delete the row (they keep console access unless you also
-- delete them from allowed_emails):
--   delete from public.admin_emails where email = 'someone@example.com';

-- Every admin is also on the console list, so a fresh admin can sign in even
-- before anyone has approved them.
insert into public.allowed_emails (email, added_by)
select email, 'admin' from public.admin_emails
on conflict (email) do nothing;

-- ── 2. The console access check ─────────────────────────────────────────────
-- Called by middleware, the OAuth callback, and the dashboard layout. Security
-- definer so the two lists stay unreadable to clients (both have RLS on with no
-- policies) while the boolean answer is still available to the signed-in user.
create or replace function public.can_access_console()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_emails a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) or exists (
    select 1 from public.admin_emails ad
    where lower(ad.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.can_access_console() to authenticated, anon;

-- ── 3. Granting access from the console (Admin → Access) ────────────────────
-- Admin-only, enforced in the database as well as in the API route, so a
-- forged request still cannot grant anyone access.

create or replace function public.grant_console_access(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target text := lower(nullif(trim(p_email), ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can grant console access' using errcode = '42501';
  end if;
  if target is null then
    raise exception 'An email address is required' using errcode = '22023';
  end if;

  insert into public.allowed_emails (email, added_by)
  values (target, coalesce(auth.jwt() ->> 'email', 'admin'))
  on conflict (email) do nothing;

  -- Keep the waitlist row in step when the grant came from a request.
  update public.waitlist_submissions
     set status = 'approved', updated_at = now()
   where lower(email) = target;
end $$;
grant execute on function public.grant_console_access(text) to authenticated;

create or replace function public.revoke_console_access(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target text := lower(nullif(trim(p_email), ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can revoke console access' using errcode = '42501';
  end if;
  if target is null then
    raise exception 'An email address is required' using errcode = '22023';
  end if;
  -- Admins are protected: revoking one here would remove the access needed to
  -- reach this page. Take them out of admin_emails first if that's intended.
  if exists (select 1 from public.admin_emails where lower(email) = target) then
    raise exception 'That account is an admin — remove it from admin_emails first'
      using errcode = '42501';
  end if;

  delete from public.allowed_emails where lower(email) = target;
end $$;
grant execute on function public.revoke_console_access(text) to authenticated;

create or replace function public.decline_waitlist_submission(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target text := lower(nullif(trim(p_email), ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can update the waitlist' using errcode = '42501';
  end if;
  if target is null then
    raise exception 'An email address is required' using errcode = '22023';
  end if;

  update public.waitlist_submissions
     set status = 'declined', updated_at = now()
   where lower(email) = target;
end $$;
grant execute on function public.decline_waitlist_submission(text) to authenticated;
