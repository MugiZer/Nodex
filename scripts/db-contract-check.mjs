#!/usr/bin/env node

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { exit } from "node:process";
import { pathToFileURL } from "node:url";

const { loadEnvConfig } = nextEnv;

const REQUIRED_SURFACES = [
  {
    name: "graph_read.graph",
    table: "graphs",
    select: "id,title,subject,topic,description,version,flagged_for_review,created_at",
  },
  {
    name: "graph_read.nodes",
    table: "nodes",
    select:
      "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count",
  },
  {
    name: "graph_read.edges",
    table: "edges",
    select: "from_node_id,to_node_id,type",
  },
  {
    name: "graph_read.progress",
    table: "user_progress",
    select: "id,user_id,node_id,graph_version,completed,attempts",
  },
  {
    name: "store.duplicate_recheck.graphs",
    table: "graphs",
    select: "id, flagged_for_review, version, created_at",
  },
  {
    name: "retrieve.fallback.graphs",
    table: "graphs",
    select: "id,subject,embedding,flagged_for_review,version,created_at",
  },
  {
    kind: "rpc",
    name: "store.write_rpc.store_generated_graph",
    functionName: "store_generated_graph",
    probeArguments: {
      __codex_probe__: "db_contract_probe",
    },
  },
  {
    name: "store.fallback_write.graphs",
    table: "graphs",
    select: "id,title,subject,topic,description,embedding,version,flagged_for_review",
  },
  {
    name: "store.fallback_write.nodes.required",
    table: "nodes",
    select:
      "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count",
  },
  {
    name: "store.fallback_write.edges",
    table: "edges",
    select: "from_node_id,to_node_id,type",
  },
];

const OPTIONAL_SURFACES = [
  {
    name: "store.fallback_write.nodes.optional_lesson_status",
    table: "nodes",
    select:
      "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,lesson_status,position,attempt_count,pass_count",
  },
];

loadEnvConfig(process.cwd());

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
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

function getDbErrorMessage(error) {
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }

  return "";
}

function getDbErrorDetails(error) {
  if (!error || typeof error !== "object") {
    return {};
  }

  const details = {};

  if (typeof error.message === "string" && error.message.length > 0) {
    details.cause_message = error.message;
  }

  if (typeof error.code === "string" && error.code.length > 0) {
    details.cause_code = error.code;
  }

  if (typeof error.hint === "string" && error.hint.length > 0) {
    details.cause_hint = error.hint;
  }

  if (error.details !== undefined) {
    details.cause_details = error.details;
  }

  if (typeof error.status === "number") {
    details.cause_status = error.status;
  }

  if (typeof error.statusCode === "number") {
    details.cause_status_code = error.statusCode;
  }

  if (!Object.prototype.hasOwnProperty.call(details, "cause_message")) {
    try {
      details.cause_raw = JSON.parse(JSON.stringify(error));
    } catch {
      details.cause_raw = String(error);
    }
  }

  return details;
}

function isSchemaMismatch(error) {
  const message = getDbErrorMessage(error).toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("could not find the function")
  );
}

async function probeSurface(client, surface) {
  if (surface.kind === "rpc") {
    const { error } = await client.rpc(surface.functionName, surface.probeArguments);

    if (!error) {
      return;
    }

    const details = {
      surface: surface.name,
      source_function: surface.functionName,
      expected_call: surface.functionName,
      cause: getDbErrorMessage(error),
      ...getDbErrorDetails(error),
    };

    if (isSchemaMismatch(error)) {
      throw Object.assign(new Error(`Database schema is out of sync for ${surface.name}.`), {
        code: "DB_SCHEMA_OUT_OF_SYNC",
        status: 503,
        details,
      });
    }

    throw Object.assign(new Error(`Failed to verify database surface ${surface.name}.`), {
      code: "DB_SURFACE_CHECK_FAILED",
      status: 503,
      details,
    });
  }

  const { error: headError } = await client.from(surface.table).select(surface.select, {
    head: true,
    count: "exact",
  });

  if (!headError) {
    return;
  }

  let error = headError;
  const headMessage = getDbErrorMessage(headError);
  if (headMessage.trim().length === 0) {
    try {
      const probe = client.from(surface.table).select(surface.select);
      if (probe && typeof probe.limit === "function") {
        const limitResult = await probe.limit(0);
        if (limitResult && limitResult.error) {
          error = limitResult.error;
        }
      }
    } catch {
      // Keep the original head error if the secondary probe fails.
    }
  }

  const details = {
    surface: surface.name,
    source_table: surface.table,
    expected_select: surface.select,
    cause: getDbErrorMessage(error),
    ...getDbErrorDetails(error),
  };

  if (isSchemaMismatch(error)) {
    throw Object.assign(new Error(`Database schema is out of sync for ${surface.name}.`), {
      code: "DB_SCHEMA_OUT_OF_SYNC",
      status: 503,
      details,
    });
  }

  throw Object.assign(new Error(`Failed to verify database surface ${surface.name}.`), {
    code: "DB_SURFACE_CHECK_FAILED",
    status: 503,
    details,
  });
}

export async function ensureDbContract(client = createServiceClient()) {
  for (const surface of REQUIRED_SURFACES) {
    await probeSurface(client, surface);
  }

  const optionalCapabilities = {};
  for (const surface of OPTIONAL_SURFACES) {
    try {
      await probeSurface(client, surface);
      optionalCapabilities[surface.name] = true;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "DB_SCHEMA_OUT_OF_SYNC") {
        optionalCapabilities[surface.name] = false;
        continue;
      }
      throw error;
    }
  }

  return optionalCapabilities;
}

async function main() {
  try {
    const optionalCapabilities = await ensureDbContract();
    console.log(
      JSON.stringify({
        ok: true,
        message: "Live database contract matches required surfaces.",
        surfaces: REQUIRED_SURFACES.map((surface) => surface.name),
        optional_capabilities: optionalCapabilities,
      }),
    );
  } catch (error) {
    const code = typeof error === "object" && error !== null && typeof error.code === "string"
      ? error.code
      : "DB_CONTRACT_CHECK_FAILED";
    const status = typeof error === "object" && error !== null && typeof error.status === "number"
      ? error.status
      : 1;
    const details = typeof error === "object" && error !== null && "details" in error
      ? error.details
      : null;

    console.error(
      JSON.stringify({
        ok: false,
        error: code,
        status,
        message: error instanceof Error ? error.message : "Live database contract check failed.",
        details,
      }),
    );
    exit(1);
  }
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  await main();
}
