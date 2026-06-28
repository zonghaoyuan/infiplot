-- Story cloud sync — optimistic-concurrency upsert RPC (story-cloud-sync).
--
-- Why an RPC (not a plain .upsert): the bare upsert in cloudStore.cloudSaveStory
-- was last-write-wins with NO monotonic guard, so a slow concurrent writer could
-- clobber newer cloud state. This function moves the "only overwrite when newer"
-- decision into SQL, matching the reconcile decision table (rev wins; on a rev
-- tie, the later updated_at wins). A stale write leaves the cloud row untouched
-- and returns the CURRENT cloud row, so the client can detect it lost and pull
-- the newer state back instead of erroring.
--
-- Security model: SECURITY INVOKER (the default, stated explicitly) so the
-- existing RLS policies on public.stories (auth.uid() = user_id) still apply —
-- no service_role, no RLS bypass. user_id is injected from auth.uid(), never
-- from the client, so a caller cannot write rows for another user. Granted to
-- the `authenticated` role only.
--
-- Idempotent: create or replace + idempotent grant — safe to re-run.

create or replace function public.upsert_story_if_newer(
  p_id           text,
  p_world        text,
  p_style        text,
  p_orientation  text,
  p_scene_count  integer,
  p_rev          integer,
  p_updated_at   timestamptz,
  p_deleted_at   timestamptz,
  p_session      jsonb
)
returns public.stories
language plpgsql
security invoker
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.stories;
begin
  -- Defense in depth: RLS would already reject an anonymous write, but failing
  -- fast here avoids inserting with a null user_id and yields a clearer error.
  if v_uid is null then
    raise exception 'upsert_story_if_newer: not authenticated';
  end if;

  insert into public.stories (
    id, user_id, world_setting, style_guide, orientation,
    scene_count, rev, created_at, updated_at, deleted_at, session_jsonb
  )
  values (
    p_id, v_uid, coalesce(p_world, ''), coalesce(p_style, ''),
    coalesce(p_orientation, 'landscape'), coalesce(p_scene_count, 0),
    coalesce(p_rev, 1), now(), coalesce(p_updated_at, now()),
    p_deleted_at, p_session
  )
  on conflict (user_id, id) do update
    set world_setting = excluded.world_setting,
        style_guide   = excluded.style_guide,
        orientation   = excluded.orientation,
        scene_count   = excluded.scene_count,
        rev           = excluded.rev,
        updated_at    = excluded.updated_at,
        deleted_at    = excluded.deleted_at,
        session_jsonb = excluded.session_jsonb
    -- Optimistic-concurrency guard: overwrite ONLY when the incoming version is
    -- strictly newer. created_at is intentionally NOT in the SET list, so an
    -- update preserves the original insert timestamp.
    where excluded.rev > public.stories.rev
       or (excluded.rev = public.stories.rev
           and excluded.updated_at > public.stories.updated_at)
  returning * into v_row;

  -- FOUND is the idiomatic PL/pgSQL test for whether RETURNING produced a row:
  -- true on a fresh insert OR a winning update; false when the row already
  -- existed AND the where-guard rejected the update (stale write). In the stale
  -- case fall through and return the current cloud row so the caller sees it
  -- lost and can reconcile by pulling the newer cloud state.
  if found then
    return v_row;
  end if;

  select * into v_row
  from public.stories
  where user_id = v_uid and id = p_id;
  return v_row;
end;
$$;

-- Lock down execution. Postgres grants EXECUTE to PUBLIC by default on function
-- creation, which would let the `anon` role reach this RPC via PostgREST. The
-- SECURITY INVOKER + null check + RLS would still reject an anonymous call, but
-- least-privilege says don't rely on the function body as the only gate —
-- revoke PUBLIC, then grant only the authenticated role.
revoke execute on function public.upsert_story_if_newer(
  text, text, text, text, integer, integer, timestamptz, timestamptz, jsonb
) from public;
grant execute on function public.upsert_story_if_newer(
  text, text, text, text, integer, integer, timestamptz, timestamptz, jsonb
) to authenticated;
