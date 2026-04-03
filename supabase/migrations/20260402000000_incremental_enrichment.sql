begin;

alter table public.nodes
  add column if not exists lesson_status text not null default 'pending';

alter table public.nodes
  drop constraint if exists nodes_lesson_status_check;

alter table public.nodes
  add constraint nodes_lesson_status_check
  check (lesson_status in ('pending', 'ready', 'failed'));

create or replace function public.store_generated_graph(
  p_graph jsonb,
  p_nodes jsonb,
  p_edges jsonb,
  p_embedding text
)
returns table (graph_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_graph_id uuid := coalesce(nullif(p_graph->>'id', '')::uuid, gen_random_uuid());
  v_title text := p_graph->>'title';
  v_subject text := p_graph->>'subject';
  v_topic text := p_graph->>'topic';
  v_description text := p_graph->>'description';
  v_version integer := coalesce(nullif(p_graph->>'version', '')::integer, 1);
  v_flagged boolean := coalesce(nullif(p_graph->>'flagged_for_review', '')::boolean, false);
  v_created_at timestamptz := coalesce(nullif(p_graph->>'created_at', '')::timestamptz, now());
begin
  insert into public.graphs (
    id,
    title,
    subject,
    topic,
    description,
    embedding,
    version,
    flagged_for_review,
    created_at
  )
  values (
    v_graph_id,
    v_title,
    v_subject,
    v_topic,
    v_description,
    p_embedding::vector,
    v_version,
    v_flagged,
    v_created_at
  );

  insert into public.nodes (
    id,
    graph_id,
    graph_version,
    title,
    lesson_text,
    static_diagram,
    p5_code,
    visual_verified,
    quiz_json,
    diagnostic_questions,
    lesson_status,
    position,
    attempt_count,
    pass_count
  )
  select
    node_row.id::uuid,
    v_graph_id,
    v_version,
    node_row.title,
    node_row.lesson_text,
    node_row.static_diagram,
    node_row.p5_code,
    node_row.visual_verified,
    node_row.quiz_json,
    node_row.diagnostic_questions,
    coalesce(node_row.lesson_status, 'pending'),
    node_row.position,
    coalesce(node_row.attempt_count, 0),
    coalesce(node_row.pass_count, 0)
  from jsonb_to_recordset(p_nodes) as node_row(
    id text,
    title text,
    lesson_text text,
    static_diagram text,
    p5_code text,
    visual_verified boolean,
    quiz_json jsonb,
    diagnostic_questions jsonb,
    lesson_status text,
    position integer,
    attempt_count integer,
    pass_count integer
  );

  insert into public.edges (
    from_node_id,
    to_node_id,
    type
  )
  select
    edge_row.from_node_id::uuid,
    edge_row.to_node_id::uuid,
    edge_row.type
  from jsonb_to_recordset(p_edges) as edge_row(
    from_node_id text,
    to_node_id text,
    type text
  );

  return query select v_graph_id;
end;
$$;

commit;
