import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import { getAuthenticatedUser } from "@/lib/auth";
import { getConfigPath } from "@/lib/config";
import { getUserPermissions, hasClientAccess, isSuperAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type CallTraceEntry = {
  ts?: number;
  industry?: string;
  client_id?: string;
  [key: string]: unknown;
};

function readRecentCallTraces(limit: number): CallTraceEntry[] {
  const tracePath = path.join(getConfigPath(), "call_traces.jsonl");
  if (!fs.existsSync(tracePath)) return [];

  const raw = fs.readFileSync(tracePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const parsed: CallTraceEntry[] = [];

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
  const limit = Number(searchParams.get("limit") || 120);

  const rows = readRecentCallTraces(limit).filter((row) => {
    const rowIndustry = String(row?.industry || "");
    const rowClient = String(row?.client_id || "");

    if (industry && rowIndustry.toLowerCase() !== industry.toLowerCase()) return false;
    if (clientId && rowClient.toLowerCase() !== clientId.toLowerCase()) return false;

    if (isSuperAdmin(user)) return true;
    if (!rowIndustry || !rowClient) return false;
    return hasClientAccess(user, rowIndustry, rowClient);
  });

  return NextResponse.json({ traces: rows });
}
