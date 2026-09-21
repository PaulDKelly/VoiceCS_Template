import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AnyRecord = Record<string, any>;

type CopilotResult = {
  kind: "question" | "diagnosis" | "workflow_draft" | "new_client_draft" | "guidance";
  reply: string;
  questions?: string[];
  proposed_config?: AnyRecord | null;
  client_draft?: AnyRecord | null;
  change_summary?: string[];
};

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const out: AnyRecord = {};
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    if (/secret|token|password|api[_-]?key/i.test(key)) {
      out[key] = child ? "[configured]" : "";
    } else {
      out[key] = redactSecrets(child);
    }
  }
  return out;
}

function diagnoseConfig(config: AnyRecord) {
  const issues: string[] = [];
  const prompts = config?.prompts && typeof config.prompts === "object" ? config.prompts : {};
  const workflows = config?.workflows && typeof config.workflows === "object" ? config.workflows : {};
  if (!workflows.first_response) issues.push("Missing required first_response workflow.");
  for (const [workflowKey, workflow] of Object.entries(workflows as Record<string, AnyRecord>)) {
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const edges = Array.isArray(workflow?.edges) ? workflow.edges : [];
    const ids = new Set<string>();
    const incoming = new Set<string>();
    for (const node of nodes) {
      const id = String(node?.id || "").trim();
      if (!id) issues.push(`${workflowKey}: node without an id.`);
      else if (ids.has(id)) issues.push(`${workflowKey}: duplicate node id '${id}'.`);
      else ids.add(id);
      const promptKey = String(node?.data?.promptKey || "").trim();
      if (promptKey && !String(prompts[promptKey] || "").trim()) {
        issues.push(`${workflowKey}/${id}: missing prompt '${promptKey}'.`);
      }
      const actionType = String(node?.data?.actionType || "");
      if (["database_query", "knowledge_search"].includes(actionType)) {
        const cfg = node?.data?.actionConfig || {};
        if (!String(cfg.error_prompt || "").trim()) issues.push(`${workflowKey}/${id}: ${actionType} has no error prompt.`);
      }
    }
    for (const edge of edges) {
      const source = String(edge?.source || "");
      const target = String(edge?.target || "");
      if (!ids.has(source) || !ids.has(target)) issues.push(`${workflowKey}: broken edge ${source} -> ${target}.`);
      incoming.add(target);
    }
    for (const id of ids) {
      if (id !== String(nodes[0]?.id || "") && !incoming.has(id)) issues.push(`${workflowKey}/${id}: unreachable node.`);
    }
  }
  return issues;
}

function validWorkflowDraft(candidate: unknown, current: AnyRecord) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const next = candidate as AnyRecord;
  if (!next.workflows || typeof next.workflows !== "object") return null;
  if (!next.prompts || typeof next.prompts !== "object") return null;
  if (!next.workflows.first_response) return null;
  for (const workflow of Object.values(next.workflows as Record<string, AnyRecord>)) {
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const edges = Array.isArray(workflow?.edges) ? workflow.edges : [];
    if (!nodes.length) return null;
    const ids = nodes.map((node: AnyRecord) => String(node?.id || "").trim());
    if (ids.some((id: string) => !id) || new Set(ids).size !== ids.length) return null;
    const idSet = new Set(ids);
    const incoming = new Set(edges.map((edge: AnyRecord) => String(edge?.target || "")));
    for (const node of nodes) {
      const promptKey = String(node?.data?.promptKey || "").trim();
      if (promptKey && !String(next.prompts[promptKey] || "").trim()) return null;
    }
    if (edges.some((edge: AnyRecord) => !idSet.has(String(edge?.source || "")) || !idSet.has(String(edge?.target || "")))) {
      return null;
    }
    if (ids.slice(1).some((id: string) => !incoming.has(id))) return null;
  }
  next.client_id = current.client_id || next.client_id;
  next.industry = current.industry || next.industry;
  return next;
}

function normalizeCopilotResult(result: CopilotResult, current: AnyRecord): CopilotResult {
  const allowedKinds = new Set(["question", "diagnosis", "workflow_draft", "new_client_draft", "guidance"]);
  if (!allowedKinds.has(result.kind)) result.kind = "guidance";
  result.questions = Array.isArray(result.questions) ? result.questions.map(String).slice(0, 5) : [];
  result.change_summary = Array.isArray(result.change_summary) ? result.change_summary.map(String).slice(0, 20) : [];

  if (result.kind === "workflow_draft") {
    result.proposed_config = validWorkflowDraft(result.proposed_config, current);
    if (!result.proposed_config) throw new Error("The generated workflow draft failed structural validation.");
    result.reply = "I have prepared a workflow draft. Nothing has been saved or deployed. Review the summary, apply it to the editor, then use Save when you are satisfied.";
  } else {
    result.proposed_config = null;
  }

  if (result.kind === "new_client_draft") {
    const draft = result.client_draft && typeof result.client_draft === "object" ? result.client_draft : null;
    const clientName = String(draft?.client_name || draft?.client_id || "").trim();
    const industry = String(draft?.industry || "").trim();
    const assistantName = String(draft?.assistant_name || "").trim();
    const tone = String(draft?.tone || "").trim();
    const intents = Array.isArray(draft?.intents)
      ? draft.intents.map((value: unknown) => normalizeIntentName(String(value || ""))).filter((value: string) => value && value !== "first_response")
      : [];
    const intentRequirements = draft?.intent_requirements && typeof draft.intent_requirements === "object"
      ? draft.intent_requirements as AnyRecord
      : {};
    const incompleteIntents = intents.filter((intent: string) => {
      const detail = intentRequirements[intent];
      return !detail
        || !Array.isArray(detail.caller_requests) || !detail.caller_requests.length
        || !Array.isArray(detail.agent_actions) || !detail.agent_actions.length
        || !Array.isArray(detail.data_sources) || !detail.data_sources.length
        || !Array.isArray(detail.information_to_collect) || !detail.information_to_collect.length
        || !["informational", "transactional", "both"].includes(String(detail.mode || "").trim().toLowerCase())
        || !String(detail.completion_outcome || "").trim()
        || !String(detail.escalation || "").trim()
        || !String(detail.out_of_scope || "").trim();
    });
    const generatedQuestions = [
      ...(!clientName ? ["What should the new client be called?"] : []),
      ...(!industry ? ["Which industry should the client belong to?"] : []),
      ...(!intents.length ? ["Which caller intents should this agent handle?"] : []),
      ...incompleteIntents.slice(0, 2).map((intent: string) =>
        `For ${intent.replace(/_/g, " ")}, what may callers ask, what should the agent do, which data source should it use, how should it finish, when should it escalate, and what is outside scope?`
      ),
      ...(!assistantName || !tone ? ["What should the assistant be called, and what tone should it use?"] : []),
    ];
    if (!draft || !clientName || !industry || !assistantName || !tone || !intents.length || incompleteIntents.length) {
      result.kind = "question";
      result.client_draft = null;
      result.reply = "I need to finish the service discovery before preparing this client. This prevents vague workflows and unsupported answers.";
      result.questions = Array.from(new Set([...(result.questions || []), ...generatedQuestions])).slice(0, 5);
    } else {
      result.reply = `I have prepared a draft for ${clientName}. The client has not been created yet. Select Review & create client, check the details, then confirm Create Client.`;
    }
  } else {
    result.client_draft = null;
    if (/\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:now\s+)?created\b/i.test(String(result.reply || ""))) {
      result.reply = "I have not made that change. I can prepare a draft for you to review, but creation and saving require an explicit confirmation in the Workflow Manager.";
    }
  }

  return result;
}

async function callAzureCopilot(args: {
  message: string;
  conversation: Array<{ role: string; text: string }>;
  config: AnyRecord;
  industry: string;
  client: string;
  selectedWorkflowKey: string | null;
  diagnostics: string[];
}): Promise<CopilotResult | null> {
  const endpoint = String(process.env.AOAI_ENDPOINT || "").replace(/\/+$/, "");
  const apiKey = String(process.env.AOAI_API_KEY || "");
  const deployment = String(process.env.AOAI_DEPLOYMENT || "gpt-4o-mini");
  if (!endpoint || !apiKey) return null;

  const system = `You are the Workflow Manager Copilot for a deterministic voice customer-service platform.
Return JSON only. Never include secrets. Never claim a change is live.
Your result must have: kind, reply, questions, proposed_config, client_draft, change_summary.
kind is one of question, diagnosis, workflow_draft, new_client_draft, guidance.
Ask concise follow-up questions when business requirements are missing. Ask no more than 5 at once.
For workflow_draft, return the COMPLETE updated client config in proposed_config. Preserve unrelated configuration exactly.
Workflow shape: workflows.<intent>.nodes[] and edges[]. Nodes have id, type, data, position. Prompt/input nodes use data.promptKey and optional captureVariable. Action nodes use data.actionType/actionConfig. Every promptKey must exist in prompts. Every edge endpoint must exist. Add the intent to intents.
For a new client, conduct discovery before returning new_client_draft. Do not infer missing business behavior. Ask up to 5 related questions at a time and adapt later questions to earlier answers.
Discovery sequence:
1. Establish client/brand, industry, assistant identity, language and tone.
2. Ask which distinct caller intents the agent must handle. Use specific names such as product_information, place_order, stock_availability, store_information, returns, delivery_status or escalation rather than one broad sales intent.
3. For EACH intent ask: examples of caller requests; products/services/categories involved; information to collect; exact agent actions; whether it is informational or transactional; successful completion outcome; escalation/handoff rule; and explicit out-of-scope boundary.
4. Ask what data supports EACH intent: static prompts, uploaded knowledge base, website/search index, product catalogue, stock/store/order/customer database, external API, or none. Ask whether access is read-only or may create/update records. Never request credentials in chat.
5. Ask operational policy: authentication/identity checks, consent/compliance wording, opening hours, human handoff destination, failure behavior and unsupported-request wording.
For clothing retail, specifically distinguish product/style/size guidance, catalogue information, live stock by store/size/colour, store details, order placement, delivery/order status, returns/exchanges and promotions. Ask which are required; do not assume all of them.
Only return new_client_draft once discovery is sufficient. It MUST contain intents and intent_requirements keyed by normalized intent. Every intent requirement must contain non-empty caller_requests[], information_to_collect[] (use ["none"] when appropriate), agent_actions[], data_sources[] (use ["none"] when appropriate), mode (informational, transactional or both), completion_outcome, escalation, and out_of_scope. It may also contain requirements_summary, integration_requirements and scope_guardrails.
For diagnosis, explain concrete faults and repairs using the supplied deterministic diagnostics.
Do not modify phone routing, credentials, database credentials, authentication, or users.`;

  const context = {
    selected: { industry: args.industry, client: args.client, workflow: args.selectedWorkflowKey },
    diagnostics: args.diagnostics,
    config: redactSecrets(args.config),
  };
  const recent = args.conversation.slice(-10).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: String(item.text || "").slice(0, 4000),
  }));
  const response = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-02-01`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          ...recent,
          { role: "user", content: `${args.message}\n\nCURRENT_CONTEXT:\n${JSON.stringify(context).slice(0, 60000)}` },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok) throw new Error(`Azure OpenAI request failed (${response.status}).`);
  const body = await response.json();
  const raw = String(body?.choices?.[0]?.message?.content || "");
  return normalizeCopilotResult(JSON.parse(raw) as CopilotResult, args.config);
}

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
  const industry = String(context?.industry || "");
  const client = String(context?.client || "");
  const conversation = Array.isArray(body?.conversation) ? body.conversation : [];
  const config = useContext && context?.configSnapshot && typeof context.configSnapshot === "object"
    ? (context.configSnapshot as AnyRecord)
    : {};

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const diagnostics = diagnoseConfig(config);
  try {
    const result = await callAzureCopilot({
      message,
      conversation,
      config,
      industry,
      client,
      selectedWorkflowKey,
      diagnostics,
    });
    if (result) return NextResponse.json(result);
  } catch (error) {
    console.error("Workflow copilot model request failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Copilot request failed." }, { status: 502 });
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

  return NextResponse.json({ kind: "guidance", reply, questions: [], proposed_config: null, client_draft: null, change_summary: [] });
}

