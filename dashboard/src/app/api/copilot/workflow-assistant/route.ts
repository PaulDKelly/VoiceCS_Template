import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AnyRecord = Record<string, any>;

function collectKnowledgeNodes(config: AnyRecord) {
  const workflows = config?.workflows && typeof config.workflows === "object" ? config.workflows : {};
  const out: Array<{ workflow: string; nodeId: string; actionConfig: AnyRecord }> = [];
  for (const [workflowKey, wf] of Object.entries(workflows as Record<string, AnyRecord>)) {
    const nodes = Array.isArray((wf as AnyRecord)?.nodes) ? (wf as AnyRecord).nodes : [];
    for (const node of nodes) {
      if (String(node?.data?.actionType || "") === "knowledge_search") {
        out.push({
          workflow: workflowKey,
          nodeId: String(node?.id || ""),
          actionConfig: (node?.data?.actionConfig || {}) as AnyRecord,
        });
      }
    }
  }
  return out;
}

function collectDatabaseConnections(config: AnyRecord) {
  const conns = config?.database_connections && typeof config.database_connections === "object"
    ? config.database_connections
    : {};
  return Object.entries(conns as Record<string, AnyRecord>).map(([key, value]) => ({
    key,
    type: String((value as AnyRecord)?.type || "unknown"),
    hasEnvKey: Boolean((value as AnyRecord)?.supabase_key_env),
    hasInlineKey: Boolean((value as AnyRecord)?.supabase_key),
  }));
}

function buildReadinessSummary(config: AnyRecord, kbAware: boolean) {
  const lines: string[] = [];
  const workflows = Object.keys(config?.workflows || {});
  const dbConnections = collectDatabaseConnections(config);
  const kbNodes = collectKnowledgeNodes(config);

  lines.push(`Workflows: ${workflows.length ? workflows.join(", ") : "none found"}`);
  lines.push(
    `Database connections: ${
      dbConnections.length ? dbConnections.map((c) => `${c.key} (${c.type})`).join(", ") : "none configured"
    }`
  );

  if (kbAware) {
    if (!kbNodes.length) {
      lines.push("Knowledge base: no Knowledge Search action nodes found.");
    } else {
      const ready = kbNodes.filter((n) => {
        const cfg = n.actionConfig || {};
        return !!String(cfg.endpoint || "").trim() && !!String(cfg.index_name || "").trim() && (!!String(cfg.api_key || "").trim() || !!String(cfg.api_key_env || "").trim());
      });
      lines.push(`Knowledge base nodes: ${kbNodes.length} total, ${ready.length} fully configured.`);
    }
  }
  return lines;
}

function answerQuestion(message: string, config: AnyRecord, kbAware: boolean, selectedWorkflowKey?: string | null) {
  const q = message.toLowerCase();
  const lines: string[] = [];

  if (q.includes("knowledge base") || q.includes("kb")) {
    const kbNodes = collectKnowledgeNodes(config);
    if (!kbAware) {
      lines.push("KB-aware mode is currently off. Turn it on to validate knowledge-search readiness.");
    } else if (!kbNodes.length) {
      lines.push("No Knowledge Search node is configured yet. Add a Knowledge Base node in the workflow.");
      lines.push("Then set: `endpoint`, `index_name`, and either `api_key_env` (recommended) or `api_key`.");
    } else {
      const ready = kbNodes.filter((n) => {
        const cfg = n.actionConfig || {};
        return !!String(cfg.endpoint || "").trim() && !!String(cfg.index_name || "").trim() && (!!String(cfg.api_key || "").trim() || !!String(cfg.api_key_env || "").trim());
      });
      lines.push(`Knowledge base coverage: ${ready.length}/${kbNodes.length} nodes are fully configured.`);
      if (ready.length < kbNodes.length) {
        lines.push("Some nodes are missing endpoint/index/key settings.");
      } else {
        lines.push("KB node config looks complete. Next step is validating index schema and result fields.");
      }
    }
  }

  if (
    q.includes("database") ||
    q.includes("supabase") ||
    q.includes("sql") ||
    q.includes("query") ||
    q.includes("postcode") ||
    q.includes("address") ||
    q.includes("engineer")
  ) {
    const conns = collectDatabaseConnections(config);
    if (!conns.length) {
      lines.push("No database connections found in this client config.");
      lines.push("Create one in Client Config > Database Connections, then reference it in a Database Query action node.");
    } else {
      lines.push(`Available DB connections: ${conns.map((c) => c.key).join(", ")}`);
      lines.push("For postcode -> address lookup, use a Database Query node with `single_row=true` and `result_var=db`.");
      lines.push("Example template for Supabase REST endpoint:");
      lines.push("`/rest/v1/engineers?postcode=eq.{postcode}&select=contact_name,phone,address&limit=1`");
      lines.push("Then in next prompt node: `The telephone number for {db.contact_name} is {db.phone}.`");
    }
  }

  if (q.includes("workflow") || q.includes("intent") || q.includes("node")) {
    const wf = selectedWorkflowKey || "";
    lines.push(`Current workflow focus: ${wf || "none selected"}.`);
    lines.push("Recommended pattern: Prompt (ask) -> Action (extract/lookup) -> Condition (result exists?) -> Prompt (respond).");
  }

  if (!lines.length) {
    lines.push("I can help with:");
    lines.push("- Knowledge Base setup and readiness checks");
    lines.push("- Database connection/query node configuration");
    lines.push("- Prompt variable wiring (`{db.field}`) and workflow flow design");
    lines.push("Ask a specific setup question and I’ll return a concrete configuration suggestion.");
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: AnyRecord;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = String(body?.message || "").trim();
  const context = (body?.context || {}) as AnyRecord;
  const kbAware = Boolean(context?.kbAware);
  const useContext = Boolean(context?.useContext);
  const selectedWorkflowKey = String(context?.selectedWorkflowKey || "") || null;
  const config = useContext && context?.configSnapshot && typeof context.configSnapshot === "object"
    ? (context.configSnapshot as AnyRecord)
    : {};

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const summary = buildReadinessSummary(config, kbAware);
  const answer = answerQuestion(message, config, kbAware, selectedWorkflowKey);

  const reply = [
    `Context`,
    ...summary.map((s) => `- ${s}`),
    "",
    "Assistant Guidance",
    answer,
  ].join("\n");

  return NextResponse.json({ reply });
}

