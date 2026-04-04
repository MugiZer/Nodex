#!/usr/bin/env node
import crypto from "node:crypto";

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { ensureDbContract } from "./db-contract-check.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const strictDbPaths =
  process.argv.includes("--strict-rpc") ||
  process.env.FOUNDATION_STRICT_DB_PATHS === "true";

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function formatVectorLiteral(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Embedding vectors must be a non-empty array.");
  }

  return `[${values.join(",")}]`;
}

function createUniqueEmbedding(seed) {
  const source = seed.replace(/[^a-f0-9]/gi, "");
  const values = Array.from({ length: 1536 }, (_, index) => {
    const charCode = source.charCodeAt(index % source.length) || 97;
    return ((charCode % 23) + 1) / 100;
  });

  return values;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function computeSimilarity(left, right) {
  const normalizedLeft = normalizeEmbedding(left);
  const normalizedRight = normalizeEmbedding(right);

  if (
    normalizedLeft.length === 0 ||
    normalizedRight.length === 0 ||
    normalizedLeft.length !== normalizedRight.length
  ) {
    return -1;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < normalizedLeft.length; index += 1) {
    const leftValue = Number(normalizedLeft[index]);
    const rightValue = Number(normalizedRight[index]);
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? -1 : dotProduct / denominator;
}

function normalizeEmbedding(value) {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const normalized = trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;

    if (normalized.length === 0) {
      return [];
    }

    return normalized.split(",").map((item) => Number(item.trim()));
  }

  return [];
}

function rankRetrievalCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    if (right.similarity !== left.similarity) {
      return right.similarity - left.similarity;
    }

    if (left.flagged_for_review !== right.flagged_for_review) {
      return Number(left.flagged_for_review) - Number(right.flagged_for_review);
    }

    if (right.version !== left.version) {
      return right.version - left.version;
    }

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}

function decideRetrievalCandidate(candidates, threshold = 0.85) {
  const ranked = rankRetrievalCandidates(candidates);
  const thresholdMatches = ranked.filter((candidate) => candidate.similarity >= threshold);

  if (thresholdMatches.length === 0) {
    return { graph_id: null };
  }

  const unflagged = thresholdMatches.find((candidate) => !candidate.flagged_for_review);
  return { graph_id: unflagged ? unflagged.id : null };
}

function computeAvailableNodeIds(nodes, edges, progressRows) {
  const completedNodeIds = new Set(
    progressRows.filter((row) => row.completed).map((row) => row.node_id),
  );

  return nodes
    .filter((node) => {
      if (completedNodeIds.has(node.id)) {
        return true;
      }

      const incomingHardEdges = edges.filter(
        (edge) => edge.to_node_id === node.id && edge.type === "hard",
      );

      return incomingHardEdges.every((edge) => completedNodeIds.has(edge.from_node_id));
    })
    .map((node) => node.id);
}

function createServiceClient() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function readGraphPayload(client, graphId, userId, graphVersion, nodeIds) {
  const [graphResult, nodesResult, edgesResult, progressResult] = await Promise.all([
    client
      .from("graphs")
      .select("id,title,subject,topic,description,embedding,version,flagged_for_review,created_at")
      .eq("id", graphId)
      .maybeSingle(),
    client
      .from("nodes")
      .select("id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count")
      .eq("graph_id", graphId)
      .order("position", { ascending: true })
      .order("id", { ascending: true }),
    client
      .from("edges")
      .select("from_node_id,to_node_id,type")
      .eq("from_node_id", nodeIds[0])
      .eq("to_node_id", nodeIds[1])
      .order("from_node_id", { ascending: true })
      .order("to_node_id", { ascending: true }),
    client
      .from("user_progress")
      .select("id,user_id,node_id,graph_version,completed,attempts")
      .eq("user_id", userId)
      .eq("graph_version", graphVersion)
      .order("node_id", { ascending: true }),
  ]);

  if (graphResult.error) {
    throw new Error(`Graph read failed: ${graphResult.error.message}`);
  }

  if (nodesResult.error) {
    throw new Error(`Node read failed: ${nodesResult.error.message}`);
  }

  if (edgesResult.error) {
    throw new Error(`Edge read failed: ${edgesResult.error.message}`);
  }

  if (progressResult.error) {
    throw new Error(`Progress read failed: ${progressResult.error.message}`);
  }

  return {
    graph: graphResult.data,
    nodes: nodesResult.data ?? [],
    edges: edgesResult.data ?? [],
    progress: progressResult.data ?? [],
  };
}

async function loadRetrievalCandidates(client, subject, embedding) {
  const rpcResult = await client.rpc("search_graph_candidates", {
    p_subject: subject,
    p_embedding: formatVectorLiteral(embedding),
    p_limit: 10,
  });

  if (!rpcResult.error) {
    return rpcResult.data ?? [];
  }

  if (strictDbPaths) {
    throw new Error(
      `Retrieval RPC unavailable while strict DB paths are enabled: ${rpcResult.error.message}`,
    );
  }

  console.warn(
    `[round2-smoke] retrieval RPC fallback engaged: ${rpcResult.error.message}`,
  );

  const { data, error } = await client
    .from("graphs")
    .select("id,embedding,flagged_for_review,version,created_at")
    .eq("subject", subject);

  if (error) {
    throw new Error(`Retrieval fallback failed: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => normalizeEmbedding(row.embedding).length > 0)
    .map((row) => ({
      id: row.id,
      similarity: computeSimilarity(row.embedding, embedding),
      flagged_for_review: row.flagged_for_review,
      version: row.version,
      created_at: row.created_at,
    }));
}

async function readProgressRow(client, userId, nodeId, graphVersion) {
  const { data, error } = await client
    .from("user_progress")
    .select("id,user_id,node_id,graph_version,completed,attempts")
    .eq("user_id", userId)
    .eq("node_id", nodeId)
    .eq("graph_version", graphVersion)
    .maybeSingle();

  if (error) {
    throw new Error(`Progress read failed: ${error.message}`);
  }

  return data;
}

async function recordProgressAttemptWithFallback(
  client,
  graphId,
  nodeId,
  userId,
  score,
  timestamp,
) {
  const rpcResult = await client.rpc("record_progress_attempt", {
    p_graph_id: graphId,
    p_node_id: nodeId,
    p_user_id: userId,
    p_score: score,
    p_timestamp: timestamp,
  });

  if (!rpcResult.error) {
    if (!Array.isArray(rpcResult.data) || rpcResult.data.length === 0) {
      throw new Error("Progress RPC returned no rows.");
    }

    return rpcResult.data[0];
  }

  if (strictDbPaths) {
    throw new Error(
      `Progress RPC unavailable while strict DB paths are enabled: ${rpcResult.error.message}`,
    );
  }

  console.warn(`[round2-smoke] progress RPC fallback engaged: ${rpcResult.error.message}`);

  const { data: nodeRow, error: nodeReadError } = await client
    .from("nodes")
    .select("id,graph_id,graph_version,attempt_count,pass_count")
    .eq("id", nodeId)
    .eq("graph_id", graphId)
    .maybeSingle();

  if (nodeReadError) {
    throw new Error(`Progress fallback node lookup failed: ${nodeReadError.message}`);
  }

  if (!nodeRow) {
    throw new Error("Progress fallback could not find target node.");
  }

  const existingProgress = await readProgressRow(client, userId, nodeId, nodeRow.graph_version);
  const isPass = score >= 2;
  const nextAttempts = [
    ...((existingProgress && Array.isArray(existingProgress.attempts) ? existingProgress.attempts : []) ?? []),
    { score, timestamp },
  ];

  const progressRow = {
    id: existingProgress?.id ?? crypto.randomUUID(),
    user_id: userId,
    node_id: nodeId,
    graph_version: nodeRow.graph_version,
    completed: Boolean(existingProgress?.completed) || isPass,
    attempts: nextAttempts,
  };

  if (existingProgress) {
    const { error: updateError } = await client
      .from("user_progress")
      .update({
        completed: progressRow.completed,
        attempts: progressRow.attempts,
      })
      .eq("id", existingProgress.id);

    if (updateError) {
      throw new Error(`Progress fallback update failed: ${updateError.message}`);
    }
  } else {
    const { error: insertError } = await client.from("user_progress").insert(progressRow);

    if (insertError) {
      throw new Error(`Progress fallback insert failed: ${insertError.message}`);
    }
  }

  const nextAttemptCount = nodeRow.attempt_count + 1;
  const nextPassCount = nodeRow.pass_count + (isPass ? 1 : 0);

  const { error: nodeUpdateError } = await client
    .from("nodes")
    .update({
      attempt_count: nextAttemptCount,
      pass_count: nextPassCount,
    })
    .eq("id", nodeId)
    .eq("graph_id", graphId);

  if (nodeUpdateError) {
    throw new Error(`Progress fallback node counter update failed: ${nodeUpdateError.message}`);
  }

  const shouldFlag = nextAttemptCount > 10 && nextPassCount / nextAttemptCount < 0.4;
  if (shouldFlag) {
    const { error: graphFlagError } = await client
      .from("graphs")
      .update({ flagged_for_review: true })
      .eq("id", graphId);

    if (graphFlagError) {
      throw new Error(`Progress fallback graph flag update failed: ${graphFlagError.message}`);
    }
  }

  const { data: updatedPayload, error: payloadError } = await client
    .from("nodes")
    .select("id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count")
    .eq("graph_id", graphId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (payloadError) {
    throw new Error(`Progress fallback payload reload failed: ${payloadError.message}`);
  }

  const nodeIds = (updatedPayload ?? []).map((node) => node.id);
  const { data: edges, error: edgesError } = await client
    .from("edges")
    .select("from_node_id,to_node_id,type")
    .in("from_node_id", nodeIds)
    .in("to_node_id", nodeIds)
    .order("from_node_id", { ascending: true })
    .order("to_node_id", { ascending: true });

  if (edgesError) {
    throw new Error(`Progress fallback edge reload failed: ${edgesError.message}`);
  }

  const { data: progressRows, error: progressReloadError } = await client
    .from("user_progress")
    .select("id,user_id,node_id,graph_version,completed,attempts")
    .eq("user_id", userId)
    .eq("graph_version", nodeRow.graph_version);

  if (progressReloadError) {
    throw new Error(`Progress fallback progress reload failed: ${progressReloadError.message}`);
  }

  const availableNodeIds = computeAvailableNodeIds(
    updatedPayload ?? [],
    edges ?? [],
    progressRows ?? [],
  );

  return {
    progress: progressRow,
    available_node_ids: availableNodeIds,
    flagged_for_review: shouldFlag,
  };
}

async function cleanupTempGraph(client, ids) {
  const operations = [
    client.from("user_progress").delete().eq("user_id", ids.userId).eq("graph_version", ids.graphVersion),
    client
      .from("edges")
      .delete()
      .eq("from_node_id", ids.nodeIds[0])
      .eq("to_node_id", ids.nodeIds[1]),
    client.from("nodes").delete().eq("graph_id", ids.graphId),
    client.from("graphs").delete().eq("id", ids.graphId),
  ];

  for (const operation of operations) {
    const { error } = await operation;
    if (error) {
      console.error(`Cleanup warning: ${error.message}`);
    }
  }
}

async function main() {
  await ensureDbContract();
  const client = createServiceClient();
  const subject = "general";
  const graphId = crypto.randomUUID();
  const node1Id = crypto.randomUUID();
  const node2Id = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const graphVersion = 1;
  const timestamp1 = "2026-04-01T12:00:00.000Z";
  const timestamp2 = "2026-04-01T12:01:00.000Z";
  const embedding = createUniqueEmbedding(graphId);

  const smokeContext = {
    graphId,
    nodeIds: [node1Id, node2Id],
    userId,
    graphVersion,
  };

  try {
    console.log("[round2-smoke] creating temp graph snapshot");
    const graphRow = {
      id: graphId,
      title: "Round 2 Smoke Graph",
      subject,
      topic: `round2_smoke_${Date.now()}`,
      description: "Round 2 smoke graph for persistence and retrieval verification.",
      embedding,
      version: graphVersion,
      flagged_for_review: false,
      created_at: new Date().toISOString(),
    };

    const { error: graphInsertError } = await client.from("graphs").insert(graphRow);
    if (graphInsertError) {
      throw new Error(`Failed to insert graph row: ${graphInsertError.message}`);
    }

    const nodeRows = [
      {
        id: node1Id,
        graph_id: graphId,
        graph_version: graphVersion,
        title: "Root Node",
        lesson_text: "Root lesson text.",
        static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        p5_code: "",
        visual_verified: false,
        quiz_json: [
          {
            question: "Root question 1?",
            options: ["a", "b", "c", "d"],
            correct_index: 1,
            explanation: "Root explanation 1.",
          },
          {
            question: "Root question 2?",
            options: ["a", "b", "c", "d"],
            correct_index: 2,
            explanation: "Root explanation 2.",
          },
          {
            question: "Root question 3?",
            options: ["a", "b", "c", "d"],
            correct_index: 3,
            explanation: "Root explanation 3.",
          },
        ],
        diagnostic_questions: [
          {
            question: "Root diagnostic?",
            options: ["a", "b", "c", "d"],
            correct_index: 1,
            difficulty_order: 0,
            node_id: node1Id,
          },
        ],
        position: 0,
        attempt_count: 0,
        pass_count: 0,
      },
      {
        id: node2Id,
        graph_id: graphId,
        graph_version: graphVersion,
        title: "Dependent Node",
        lesson_text: "Dependent lesson text.",
        static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        p5_code: "",
        visual_verified: false,
        quiz_json: [
          {
            question: "Dependent question 1?",
            options: ["a", "b", "c", "d"],
            correct_index: 1,
            explanation: "Dependent explanation 1.",
          },
          {
            question: "Dependent question 2?",
            options: ["a", "b", "c", "d"],
            correct_index: 2,
            explanation: "Dependent explanation 2.",
          },
          {
            question: "Dependent question 3?",
            options: ["a", "b", "c", "d"],
            correct_index: 3,
            explanation: "Dependent explanation 3.",
          },
        ],
        diagnostic_questions: [
          {
            question: "Dependent diagnostic?",
            options: ["a", "b", "c", "d"],
            correct_index: 1,
            difficulty_order: 1,
            node_id: node2Id,
          },
        ],
        position: 1,
        attempt_count: 0,
        pass_count: 0,
      },
    ];

    const { error: nodeInsertError } = await client.from("nodes").insert(nodeRows);
    if (nodeInsertError) {
      throw new Error(`Failed to insert nodes: ${nodeInsertError.message}`);
    }

    const { error: edgeInsertError } = await client.from("edges").insert([
      { from_node_id: node1Id, to_node_id: node2Id, type: "hard" },
    ]);
    if (edgeInsertError) {
      throw new Error(`Failed to insert edges: ${edgeInsertError.message}`);
    }

    console.log("[round2-smoke] validating retrieval candidate query");
    const candidates = await loadRetrievalCandidates(client, subject, embedding);
    const retrieved = decideRetrievalCandidate(candidates);

    assert(
      retrieved.graph_id === graphId,
      "Inserted graph was not returned by retrieval candidates.",
    );

    console.log("[round2-smoke] validating graph payload read");
    const graphPayload = await readGraphPayload(client, graphId, userId, graphVersion, [
      node1Id,
      node2Id,
    ]);
    assert(graphPayload.graph?.id === graphId, "Graph read did not return the inserted graph.");
    assert(graphPayload.nodes.length === 2, "Graph read did not return both inserted nodes.");
    assert(graphPayload.edges.length === 1, "Graph read did not return the inserted edge.");
    assert(graphPayload.progress.length === 0, "Graph should start with no learner progress rows.");

    console.log("[round2-smoke] validating progress fail path");
    const failData = await recordProgressAttemptWithFallback(
      client,
      graphId,
      node1Id,
      userId,
      1,
      timestamp1,
    );

    assert(failData?.progress?.completed === false, "Fail path unexpectedly marked completion.");
    assert(
      Array.isArray(failData?.available_node_ids) &&
        failData.available_node_ids.includes(node1Id) &&
        !failData.available_node_ids.includes(node2Id),
      "Fail path unlock visibility was incorrect.",
    );

    console.log("[round2-smoke] validating progress pass path and unlock visibility");
    const passData = await recordProgressAttemptWithFallback(
      client,
      graphId,
      node1Id,
      userId,
      3,
      timestamp2,
    );

    assert(passData?.progress?.completed === true, "Pass path did not mark completion.");
    assert(
      Array.isArray(passData?.available_node_ids) &&
        passData.available_node_ids.includes(node2Id),
      "Pass path did not unlock the dependent node.",
    );

    const finalPayload = await readGraphPayload(client, graphId, userId, graphVersion, [
      node1Id,
      node2Id,
    ]);
    const rootNode = finalPayload.nodes.find((node) => node.id === node1Id);
    assert(rootNode?.attempt_count === 2, "Root node attempt_count was not incremented twice.");
    assert(rootNode?.pass_count === 1, "Root node pass_count was not incremented once.");
    assert(finalPayload.progress.length === 1, "Expected one persisted progress row.");
    assert(
      finalPayload.progress[0].attempts.length === 2,
      "Persisted progress attempts were not appended correctly.",
    );

    console.log("[round2-smoke] round 2 smoke passed");
    if (strictDbPaths) {
      console.log("[round2-smoke] strict DB path mode passed");
    }
  } finally {
    await cleanupTempGraph(client, smokeContext);
  }
}

main().catch((error) => {
  console.error("[round2-smoke] smoke failed");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
