begin;

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.graphs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text not null,
  topic text not null,
  description text not null,
  embedding vector(1536),
  version integer not null check (version >= 1),
  flagged_for_review boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists graphs_subject_idx on public.graphs (subject);
create index if not exists graphs_subject_version_created_at_idx on public.graphs (subject, version desc, created_at desc);
create index if not exists graphs_flagged_for_review_idx on public.graphs (flagged_for_review);
create index if not exists graphs_embedding_ivfflat_idx on public.graphs using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  graph_id uuid not null references public.graphs(id) on delete restrict,
  graph_version integer not null check (graph_version >= 1),
  title text not null,
  lesson_text text,
  static_diagram text,
  p5_code text,
  visual_verified boolean not null default false,
  quiz_json jsonb,
  diagnostic_questions jsonb,
  position integer not null check (position >= 0),
  attempt_count integer not null default 0,
  pass_count integer not null default 0,
  constraint nodes_quiz_json_is_array check (quiz_json is null or jsonb_typeof(quiz_json) = 'array'),
  constraint nodes_diagnostic_questions_is_array check (diagnostic_questions is null or jsonb_typeof(diagnostic_questions) = 'array'),
  constraint nodes_pass_count_not_exceed_attempt_count check (pass_count <= attempt_count)
);

create index if not exists nodes_graph_id_idx on public.nodes (graph_id);
create index if not exists nodes_graph_version_idx on public.nodes (graph_version);
create index if not exists nodes_graph_position_idx on public.nodes (graph_id, position, id);

create table if not exists public.edges (
  from_node_id uuid not null references public.nodes(id) on delete restrict,
  to_node_id uuid not null references public.nodes(id) on delete restrict,
  type text not null check (type in ('hard', 'soft')),
  primary key (from_node_id, to_node_id, type)
);

create index if not exists edges_from_node_type_idx on public.edges (from_node_id, type);
create index if not exists edges_to_node_type_idx on public.edges (to_node_id, type);

create table if not exists public.user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  node_id uuid not null references public.nodes(id) on delete restrict,
  graph_version integer not null check (graph_version >= 1),
  completed boolean not null default false,
  attempts jsonb not null default '[]'::jsonb,
  constraint user_progress_attempts_is_array check (jsonb_typeof(attempts) = 'array'),
  constraint user_progress_unique_logical unique (user_id, node_id, graph_version)
);

create index if not exists user_progress_user_graph_idx on public.user_progress (user_id, graph_version);
create index if not exists user_progress_node_idx on public.user_progress (node_id);

alter table public.graphs enable row level security;
alter table public.nodes enable row level security;
alter table public.edges enable row level security;
alter table public.user_progress enable row level security;

create or replace function public.search_graph_candidates(
  p_subject text,
  p_embedding text,
  p_limit integer default 25
)
returns table (
  id uuid,
  similarity double precision,
  flagged_for_review boolean,
  version integer,
  created_at timestamptz
)
language sql
stable
as $$
  select
    g.id,
    1 - (g.embedding <=> p_embedding::vector) as similarity,
    g.flagged_for_review,
    g.version,
    g.created_at
  from public.graphs g
  where g.subject = p_subject
    and g.embedding is not null
  order by similarity desc, g.flagged_for_review asc, g.version desc, g.created_at desc
  limit p_limit;
$$;

create or replace function public.record_progress_attempt(
  p_graph_id uuid,
  p_node_id uuid,
  p_user_id uuid,
  p_score integer,
  p_timestamp timestamptz
)
returns table (
  progress jsonb,
  available_node_ids uuid[],
  flagged_for_review boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_graph_version integer;
  v_graph_flagged boolean;
  v_attempt jsonb := jsonb_build_object(
    'score',
    p_score,
    'timestamp',
    to_char(p_timestamp at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  v_is_pass boolean := p_score >= 2;
  v_progress_row jsonb;
begin
  select n.graph_version
    into v_graph_version
  from public.nodes n
  where n.id = p_node_id
    and n.graph_id = p_graph_id;

  if not found then
    raise exception 'node % does not belong to graph %', p_node_id, p_graph_id;
  end if;

  insert into public.user_progress as up (user_id, node_id, graph_version, completed, attempts)
  values (
    p_user_id,
    p_node_id,
    v_graph_version,
    v_is_pass,
    jsonb_build_array(v_attempt)
  )
  on conflict (user_id, node_id, graph_version)
  do update set
    completed = up.completed or excluded.completed,
    attempts = coalesce(up.attempts, '[]'::jsonb) || excluded.attempts
  returning row_to_json(up)::jsonb into v_progress_row;

  update public.nodes
  set
    attempt_count = attempt_count + 1,
    pass_count = pass_count + case when v_is_pass then 1 else 0 end
  where id = p_node_id;

  update public.graphs
  set flagged_for_review = true
  where id = p_graph_id
    and exists (
      select 1
      from public.nodes n
      where n.id = p_node_id
        and n.graph_id = p_graph_id
        and n.attempt_count > 10
        and (n.pass_count::numeric / nullif(n.attempt_count, 0)) < 0.4
    );

  select g.flagged_for_review
    into v_graph_flagged
  from public.graphs g
  where g.id = p_graph_id;

  return query
  with available_nodes as (
    select n.id, n.position
    from public.nodes n
    where n.graph_id = p_graph_id
      and (
        exists (
          select 1
          from public.user_progress up
          where up.user_id = p_user_id
            and up.node_id = n.id
            and up.graph_version = v_graph_version
            and up.completed = true
        )
        or not exists (
          select 1
          from public.edges e
          left join public.user_progress prereq_progress
            on prereq_progress.node_id = e.from_node_id
           and prereq_progress.user_id = p_user_id
           and prereq_progress.graph_version = v_graph_version
          where e.to_node_id = n.id
            and e.type = 'hard'
            and coalesce(prereq_progress.completed, false) = false
        )
      )
  )
  select
    v_progress_row,
    coalesce(
      (
        select array_agg(id order by position, id)
        from available_nodes
      ),
      '{}'::uuid[]
    ),
    v_graph_flagged;
end;
$$;

revoke all on function public.search_graph_candidates(text, text, integer) from public;
revoke all on function public.record_progress_attempt(uuid, uuid, uuid, integer, timestamptz) from public;

grant execute on function public.search_graph_candidates(text, text, integer) to service_role;
grant execute on function public.record_progress_attempt(uuid, uuid, uuid, integer, timestamptz) to service_role;

commit;
