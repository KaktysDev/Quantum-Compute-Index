-- Hotfix: consume_rate_limit() raised 42702 "column reference \"window_start\"
-- is ambiguous", which took down every authenticated request.
--
-- Cause: the function declared PL/pgSQL locals named `window_start` and
-- `window_seconds`, colliding with the rate_limit_windows columns of the same
-- name. In `on conflict(bucket,window_start)` Postgres cannot tell the local
-- from the column and aborts with 42702.
--
-- Blast radius: consumeRateLimit() in the web tier fails closed on any error
-- other than "function is missing", so the exception propagated out of
-- resolvePrincipal() and every authenticated endpoint answered 500
-- "Internal server error." Public endpoints (e.g. GET /api/v1/backends) were
-- unaffected, which is what made this look like a routing or provider problem.
--
-- Note this only bites once qrouter.sql has been applied: before that the RPC
-- is absent, the caller detects PGRST202 and falls back to per-instance
-- limiting, so the platform kept working.
--
-- Safe to run on a live database: CREATE OR REPLACE swaps the body in place,
-- touches no rows, and needs no downtime.

create or replace function public.consume_rate_limit(p_bucket text,p_limit integer default 120,p_window_seconds integer default 60)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_window_seconds integer;v_window_start timestamptz;v_counted integer;
begin
  if p_bucket is null or p_bucket='' then return false;end if;
  v_window_seconds=greatest(1,least(coalesce(p_window_seconds,60),86400));
  v_window_start=to_timestamp(floor(extract(epoch from now())/v_window_seconds)*v_window_seconds);
  insert into public.rate_limit_windows(bucket,window_start,request_count)
  values(left(p_bucket,200),v_window_start,1)
  on conflict(bucket,window_start) do update set request_count=public.rate_limit_windows.request_count+1
  returning request_count into v_counted;
  return v_counted<=greatest(1,p_limit);
end$$;

revoke all on function public.consume_rate_limit(text,integer,integer) from public;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;

-- Verify: both calls must return true (the second proves the ON CONFLICT
-- update path works, which is the branch that was raising 42702).
--   select public.consume_rate_limit('verify:hotfix', 100, 60);
--   select public.consume_rate_limit('verify:hotfix', 100, 60);
--   delete from public.rate_limit_windows where bucket = 'verify:hotfix';
