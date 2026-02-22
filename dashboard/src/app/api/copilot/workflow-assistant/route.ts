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

function normalizeIntentName(raw: string) {
  return String(raw || "").toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function getKnownIntents(config: AnyRecord) {
  const known = new Set<string>();
  const fromConfigIntents = Array.isArray(config?.intents) ? config.intents : [];
  fromConfigIntents.forEach((i) => {
    const name = normalizeIntentName(String(i || ""));
    if (name && name !== "general") known.add(name);
  });
  Object.keys(config?.workflows || {}).forEach((k) => {
    const name = normalizeIntentName(k);
    if (name && name !== "general") known.add(name);
  });
  ["first_response", "sales", "service", "warranty", "finance", "booking", "support"].forEach((i) => known.add(i));
  return Array.from(known);
}

function extractRequestedIntents(message: string, knownIntents: string[]) {
  const q = String(message || "").toLowerCase();
  const out: string[] = [];
  for (const intent of knownIntents) {
    const spaced = intent.replace(/_/g, " ");
    if (q.includes(intent) || q.includes(spaced)) out.push(intent);
  }
  return Array.from(new Set(out)).filter((x) => x !== "first_response" && x !== "general");
}

function intentImplementationGuidance(intent: string) {
  switch (intent) {
    case "sales":
      return "Prompt (qualify interest) -> Action (capture product/need) -> Condition (in stock/eligible) -> Prompt (next step/booking).";
    case "service":
      return "Prompt (issue capture) -> Action (extract name/postcode) -> Action (DB lookup engineer/history) -> Prompt (confirm slot/contact).";
    case "warranty":
      return "Prompt (collect product + purchase date) -> Condition (in warranty?) -> Prompt (covered/not covered route).";
    case "finance":
      return "Prompt (finance query) -> Action (policy/eligibility lookup) -> Prompt (answer + compliance wording).";
    case "booking":
      return "Prompt (date/time preference) -> Action (availability lookup) -> Condition (slot found) -> Prompt (confirm booking).";
    case "support":
      return "Prompt (issue) -> Action (KB search) -> Condition (confidence/no result) -> Prompt (solution/handoff).";
    default:
      return "Prompt -> Action (extract/lookup) -> Condition -> Prompt.";
  }
}

function isWalkthroughQuery(message: string) {
  const q = String(message || "").toLowerCase();
  const asksSetup =
    q.includes("walkthrough") ||
    q.includes("full walk") ||
    q.includes("how do i set up") ||
    q.includes("setup a new client") ||
    q.includes("set up a new client") ||
    q.includes("configure a new client");
  const mentionsKb = q.includes("knowledge base") || q.includes("knowledgebase") || q.includes("kb");
  return asksSetup && mentionsKb;
}

function buildFullKbClientWalkthrough(message: string, config: AnyRecord, selectedWorkflowKey?: string | null) {
  const knownIntents = getKnownIntents(config);
  const requested = extractRequestedIntents(message, knownIntents);
  const configured = knownIntents.filter((i) => i !== "first_response");
  const intentPlan = requested.length
    ? requested
    : (selectedWorkflowKey && selectedWorkflowKey !== "first_response" ? [normalizeIntentName(selectedWorkflowKey)] : configured.slice(0, 3));

  const steps: string[] = [];
  steps.push("Full Walkthrough: New Knowledge-Base Client");
  steps.push("1. Create the client using `+ New Client` (or `Clone Client` if you want a starter template).");
  steps.push("2. In Client Config, set assistant identity, tone, TTS provider/voice, and phone routing.");
  steps.push("3. Add only required intents from Intent Library for this client.");
  steps.push("4. Configure Knowledge Search action defaults:");
  steps.push("   `endpoint`, `index_name`, `api_key_env`, `query_template={_last_user_input}`, `result_var=kb`.");
  steps.push("5. Build/verify `first_response`: greeting -> intent detect/handoff -> selected intent workflow.");
  steps.push("6. Intent-specific implementation:");
  for (const intent of intentPlan) {
    steps.push(`   ${intent}: ${intentImplementationGuidance(intent)}`);
  }
  steps.push("7. Add prompt nodes after action nodes so callers hear outputs, e.g. `Here is what I found: {kb.summary}`.");
  steps.push("8. Add fallback prompts on actions: `no_results_prompt` and `error_prompt` to avoid silent turns.");
  steps.push("9. Test each intent in 3 cases: success path, no-results path, and error/timeout path.");
  steps.push("10. Save client config, deploy, and run one live call test per intent.");
  return steps.join("\n");
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

  if (isWalkthroughQuery(message)) {
    return buildFullKbClientWalkthrough(message, config, selectedWorkflowKey);
  }

  if (q.includes("knowledge base") || q.includes("kb")) {
    const kbNodes = collectKnowledgeNodes(config);
    if (!kbAware) {
      lines.push("KB-aware mode is currently off. Turn it on to validate knowledge-search readiness.");
    } else if (!kbNodes.length) {
      lines.push("No Knowledge Search node is configured yet.");
      lines.push("Set up sequence: add node -> set endpoint/index/key env -> add prompt using `{kb.summary}`.");
      lines.push("If you want, ask: `full walkthrough for new KB client with service + finance intents`.");
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
    if (q.includes("depending on intent") || q.includes("by intent")) {
      const knownIntents = getKnownIntents(config).filter((x) => x !== "first_response" && x !== "general");
      const intents = knownIntents.length ? knownIntents : ["service", "sales", "warranty", "finance"];
      lines.push("Intent-specific implementation patterns:");
      intents.forEach((intent) => lines.push(`- ${intent}: ${intentImplementationGuidance(intent)}`));
    }
  }

  if (!lines.length) {
    lines.push("I can help with:");
    lines.push("- Full new-client walkthroughs (KB + intents + testing)");
    lines.push("- Knowledge Base setup and readiness checks");
    lines.push("- Database connection/query node configuration");
    lines.push("- Prompt variable wiring (`{db.field}`) and workflow design");
    lines.push("Ask: `full walkthrough for new KB client with service + finance intents`.");
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
    "Context",
    ...summary.map((s) => `- ${s}`),
    "",
    "Assistant Guidance",
    answer,
  ].join("\n");

  return NextResponse.json({ reply });
}

