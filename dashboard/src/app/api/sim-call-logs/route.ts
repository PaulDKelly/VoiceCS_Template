import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import { getAuthenticatedUser } from "@/lib/auth";
import { getConfigPath } from "@/lib/config";
import { getUserPermissions, hasClientAccess, isSuperAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type SimCallLogEntry = {
  ts?: number;
  client_ts?: string;
  industry?: string;
  client_id?: string;
  session_id?: string;
  message?: string;
  event?: string;
  step?: number;
  intent?: string;
  previous_intent?: string;
  current_node_id?: string;
  input_text?: string;
  output_text?: string;
  latency_ms?: number;
  [key: string]: unknown;
};

function appendSimLogs(entries: SimCallLogEntry[]) {
  const logPath = path.join(getConfigPath(), "sim_call_logs.jsonl");
  const lines = entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  if (!lines) return;
  fs.appendFileSync(logPath, `${lines}\n`, "utf-8");
}

function readRecentSimLogs(limit: number): SimCallLogEntry[] {
  const logPath = path.join(getConfigPath(), "sim_call_logs.jsonl");
  if (!fs.existsSync(logPath)) return [];
  const raw = fs.readFileSync(logPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const parsed: SimCallLogEntry[] = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item && typeof item === "object") parsed.push(item);
    } catch {
      // Ignore invalid lines.
    }
  }
  parsed.sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0));
  return parsed.slice(0, Math.max(1, Math.min(limit, 500)));
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const permissions = getUserPermissions(user);
  if (!permissions.can_view_history && !isSuperAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const industry = String(body?.industry || "").trim();
  const clientId = String(body?.client_id || "").trim();
  const sessionId = String(body?.session_id || "").trim();

  if (!industry || !clientId) {
    return NextResponse.json({ error: "Missing industry/client_id" }, { status: 400 });
  }

  if (!isSuperAdmin(user) && !hasClientAccess(user, industry, clientId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = Date.now() / 1000;
  const logs = Array.isArray(body?.logs) ? body.logs : null;
  const entries: SimCallLogEntry[] = [];

  if (logs && logs.length) {
    for (const item of logs) {
      const message = String(item?.message || "").trim();
      if (!message) continue;
      entries.push({
        ts: now,
        client_ts: String(item?.ts || ""),
        industry,
        client_id: clientId,
        session_id: sessionId || undefined,
        event: "sim_log",
        message,
        step: typeof item?.step === "number" ? item.step : undefined,
        intent: item?.intent,
        previous_intent: item?.previous_intent,
        current_node_id: item?.current_node_id,
        input_text: item?.input_text,
        output_text: item?.output_text,
        latency_ms: item?.latency_ms
      });
    }
  } else {
    const message = String(body?.message || "").trim();
    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }
    entries.push({
      ts: now,
      client_ts: String(body?.ts || ""),
      industry,
      client_id: clientId,
      session_id: sessionId || undefined,
      event: "sim_log",
      message,
      step: typeof body?.step === "number" ? body.step : undefined,
      intent: body?.intent,
      previous_intent: body?.previous_intent,
      current_node_id: body?.current_node_id,
      input_text: body?.input_text,
      output_text: body?.output_text,
      latency_ms: body?.latency_ms
    });
  }

  if (entries.length) appendSimLogs(entries);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const permissions = getUserPermissions(user);
  if (!permissions.can_view_history && !isSuperAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const industry = String(searchParams.get("industry") || "").trim();
  const clientId = String(searchParams.get("client_id") || "").trim();
  const limit = Number(searchParams.get("limit") || 200);

  const rows = readRecentSimLogs(limit).filter((row) => {
    const rowIndustry = String(row?.industry || "");
    const rowClient = String(row?.client_id || "");
    if (industry && rowIndustry.toLowerCase() !== industry.toLowerCase()) return false;
    if (clientId && rowClient.toLowerCase() !== clientId.toLowerCase()) return false;
    if (isSuperAdmin(user)) return true;
    if (!rowIndustry || !rowClient) return false;
    return hasClientAccess(user, rowIndustry, rowClient);
  });

  return NextResponse.json({ logs: rows });
}

