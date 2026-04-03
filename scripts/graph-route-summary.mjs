#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { stdin, stdout, argv, exit } from "node:process";

const LATENCY_BUCKETS = [
  10000,
  20000,
  30000,
  45000,
];

function createCountMap() {
  return Object.create(null);
}

function incrementCount(map, key) {
  if (typeof key !== "string" || key.length === 0) {
    return;
  }

  map[key] = (map[key] ?? 0) + 1;
}

export function bucketLatencyMs(totalMs) {
  if (!Number.isFinite(totalMs) || totalMs < 0) {
    return "unknown";
  }

  for (const upperBound of LATENCY_BUCKETS) {
    if (totalMs <= upperBound) {
      return `<=${upperBound / 1000}s`;
    }
  }

  return ">45s";
}

export function aggregateGraphRouteLogs(records) {
  const summary = {
    runs: 0,
    repair_mode_counts: createCountMap(),
    outcome_bucket_counts: createCountMap(),
    curriculum_audit_status_counts: createCountMap(),
    curriculum_outcome_bucket_counts: createCountMap(),
    structure_issue_type_counts: createCountMap(),
    structure_issue_key_counts: createCountMap(),
    curriculum_issue_type_counts: createCountMap(),
    curriculum_issue_key_counts: createCountMap(),
    resolution_summary_issue_key_counts: createCountMap(),
    latency_bucket_counts: createCountMap(),
  };

  for (const record of records) {
    if (
      !record ||
      record.route !== "POST /api/generate/graph" ||
      record.stage !== "graph_generate" ||
      record.event !== "success" ||
      !record.telemetry
    ) {
      continue;
    }

    summary.runs += 1;
    incrementCount(summary.repair_mode_counts, record.telemetry.repair_mode);
    incrementCount(summary.outcome_bucket_counts, record.telemetry.outcome_bucket);
    incrementCount(
      summary.curriculum_audit_status_counts,
      record.telemetry.curriculum_audit_status,
    );
    incrementCount(
      summary.curriculum_outcome_bucket_counts,
      record.telemetry.curriculum_outcome_bucket,
    );

    for (const [issueType, count] of Object.entries(
      record.telemetry.structure_issue_type_counts ?? {},
    )) {
      summary.structure_issue_type_counts[issueType] =
        (summary.structure_issue_type_counts[issueType] ?? 0) + Number(count);
    }

    for (const [issueKey, count] of Object.entries(
      record.telemetry.structure_issue_key_counts ?? {},
    )) {
      summary.structure_issue_key_counts[issueKey] =
        (summary.structure_issue_key_counts[issueKey] ?? 0) + Number(count);
    }

    for (const [issueType, count] of Object.entries(
      record.telemetry.curriculum_issue_type_counts ?? {},
    )) {
      summary.curriculum_issue_type_counts[issueType] =
        (summary.curriculum_issue_type_counts[issueType] ?? 0) + Number(count);
    }

    for (const [issueKey, count] of Object.entries(
      record.telemetry.curriculum_issue_key_counts ?? {},
    )) {
      summary.curriculum_issue_key_counts[issueKey] =
        (summary.curriculum_issue_key_counts[issueKey] ?? 0) + Number(count);
    }

    for (const [issueKey, count] of Object.entries(
      record.telemetry.resolution_summary_issue_key_counts ?? {},
    )) {
      summary.resolution_summary_issue_key_counts[issueKey] =
        (summary.resolution_summary_issue_key_counts[issueKey] ?? 0) + Number(count);
    }

    incrementCount(summary.latency_bucket_counts, bucketLatencyMs(record.timings_ms?.total));
  }

  return summary;
}

function readAllInput(paths) {
  if (paths.length === 0) {
    if (stdin.isTTY) {
      return "";
    }

    return readFileSync(0, "utf8");
  }

  return paths.map((filePath) => readFileSync(filePath, "utf8")).join("\n");
}

function parseJsonLines(input) {
  const records = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }

  return records;
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const input = readAllInput(argv.slice(2));
  const summary = aggregateGraphRouteLogs(parseJsonLines(input));
  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.runs === 0 && input.trim().length > 0) {
    exit(1);
  }
}
