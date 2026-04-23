"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Save, Plus, History, LogOut, Settings, ChevronDown, ChevronRight } from "lucide-react";
import PromptEditor from "@/components/PromptEditor";
import WorkflowVisualizer from "@/components/WorkflowVisualizer";
import ClientConfigForm from "@/components/ClientConfigForm";
import PhoneMappings from "@/components/PhoneMappings";
import VersionHistory from "@/components/VersionHistory";
import UserManagement from "@/components/UserManagement";
import WorkflowCopilot from "@/components/WorkflowCopilot";

import { signIn, signOut, useSession } from "next-auth/react";

type ConfigList = {
  industries: string[];
  clients: Record<string, string[]>;
};

type NewClientDraft = {
  industry: string;
  brand_name: string;
  assistant_name: string;
  agent_name: string;
  opening_hours: string;
  brand_phone: string;
  language: string;
  tone: string;
  tts_provider: "" | "elevenlabs" | "azure_neural";
  elevenlabs_voice_id: string;
  azure_voice_name: string;
  intents_csv: string;
  default_intent: string;
};
type CreateClientMode = "industry_template" | "blank";
type NewClientVoiceEntry = {
  name: string;
  provider: "elevenlabs" | "azure_neural";
  voice_id?: string;
  voice_name?: string;
  locale?: string;
};

const LANGUAGE_OPTIONS = [
  { locale: "en-GB", label: "English (United Kingdom)" },
  { locale: "en-US", label: "English (United States)" },
  { locale: "pt-PT", label: "Portuguese (Portugal)" },
  { locale: "pt-BR", label: "Portuguese (Brazil)" },
  { locale: "es-ES", label: "Spanish (Spain)" },
  { locale: "es-MX", label: "Spanish (Mexico)" },
  { locale: "fr-FR", label: "French (France)" },
  { locale: "de-DE", label: "German (Germany)" },
  { locale: "it-IT", label: "Italian (Italy)" },
  { locale: "nl-NL", label: "Dutch (Netherlands)" },
  { locale: "pl-PL", label: "Polish (Poland)" },
  { locale: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { locale: "hi-IN", label: "Hindi (India)" },
  { locale: "ja-JP", label: "Japanese (Japan)" },
  { locale: "ko-KR", label: "Korean (Korea)" },
  { locale: "zh-CN", label: "Chinese Mandarin (Simplified)" },
];

type NodePickerAction = {
  type: "prompt" | "action" | "condition" | "knowledge" | "handoff";
  nonce: number;
};
type LeftEditorTab = "none" | "prompts" | "config" | "json" | "phone_routing";

type SimCallLog = {
  ts: string;
  message: string;
};

type CallTraceEntry = {
  ts?: number;
  event?: string;
  session_id?: string;
  client_id?: string;
  industry?: string;
  input_text?: string;
  output_text?: string;
  previous_intent?: string;
  intent?: string;
  previous_node_id?: string;
  current_node_id?: string;
  handoff?: boolean;
  latency_ms?: number;
  error?: string;
  [key: string]: any;
};

export default function Home() {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<any | null>(null);

  const [list, setList] = useState<ConfigList | null>(null);
  const [phoneMappings, setPhoneMappings] = useState<Record<string, { client_id: string, industry: string }>>({});
  const [selectedType, setSelectedType] = useState<"industry" | "client" | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [pickerIndustry, setPickerIndustry] = useState<string>("");
  const [pickerClientKey, setPickerClientKey] = useState<string>("");
  const [pickerClientSearch, setPickerClientSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [testingMenuOpen, setTestingMenuOpen] = useState(false);
  const [versioningMenuOpen, setVersioningMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"prompts" | "workflows" | "config" | "phone_mappings" | "json" | "users">("workflows");
  const [leftEditorTab, setLeftEditorTab] = useState<LeftEditorTab>("none");
  const [nodePickerAction, setNodePickerAction] = useState<NodePickerAction | null>(null);
  const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<string | null>(null);
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [addWorkflowRequestNonce, setAddWorkflowRequestNonce] = useState(0);
  const [isSidebarCompact, setIsSidebarCompact] = useState(true);
  const [phoneMappingsContent, setPhoneMappingsContent] = useState<string>(JSON.stringify({ mappings: {} }, null, 2));
  const [collapsedSections, setCollapsedSections] = useState({
    context: false,
    workflows: false,
    picker: false,
  });

  const [editorContent, setEditorContent] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"create_industry" | "create_client" | "copy_client" | null>(null);
  const [modalData, setModalData] = useState<{ industry?: string, sourceClient?: string }>({});
  const [modalInput, setModalInput] = useState("");
  const [newClientDraft, setNewClientDraft] = useState<NewClientDraft>({
    industry: "",
    brand_name: "",
    assistant_name: "",
    agent_name: "",
    opening_hours: "",
    brand_phone: "",
    language: "en-GB",
    tone: "",
    tts_provider: "",
    elevenlabs_voice_id: "",
    azure_voice_name: "",
    intents_csv: "",
    default_intent: "first_response",
  });
  const [createClientMode, setCreateClientMode] = useState<CreateClientMode>("industry_template");
  const [createClientTemplateSource, setCreateClientTemplateSource] = useState<string>("");
  const [createClientVoices, setCreateClientVoices] = useState<NewClientVoiceEntry[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadRequestIdRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [initialConfigLoaded, setInitialConfigLoaded] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [availableAuthProviders, setAvailableAuthProviders] = useState<string[]>([]);
  const [testCallOpen, setTestCallOpen] = useState(false);
  const [testCallTo, setTestCallTo] = useState("");
  const [testCallFrom, setTestCallFrom] = useState("");
  const [testCallWebhookBaseUrl, setTestCallWebhookBaseUrl] = useState("");
  const [isStartingTestCall, setIsStartingTestCall] = useState(false);
  const [simulateCallOpen, setSimulateCallOpen] = useState(false);
  const [isSimulatingCall, setIsSimulatingCall] = useState(false);
  const [simCallLogs, setSimCallLogs] = useState<SimCallLog[]>([]);
  const [callTraceOpen, setCallTraceOpen] = useState(false);
  const [callTraces, setCallTraces] = useState<CallTraceEntry[]>([]);
  const [isLoadingCallTraces, setIsLoadingCallTraces] = useState(false);
  const [callTraceError, setCallTraceError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const testingMenuRef = useRef<HTMLDivElement | null>(null);
  const versioningMenuRef = useRef<HTMLDivElement | null>(null);
  const simStreamSidRef = useRef<string>("");
  const simAudioContextRef = useRef<AudioContext | null>(null);
  const simMediaStreamRef = useRef<MediaStream | null>(null);
  const simSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const simProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const simGainNodeRef = useRef<GainNode | null>(null);
  const simNextPlaybackTimeRef = useRef<number>(0);
  const simReceivedAudioRef = useRef<number>(0);

  useEffect(() => {
    if (status === "authenticated") {
      fetchList();
      fetchMe();
    }
  }, [status]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (testingMenuRef.current && !testingMenuRef.current.contains(target)) {
        setTestingMenuOpen(false);
      }
      if (versioningMenuRef.current && !versioningMenuRef.current.contains(target)) {
        setVersioningMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (status !== "unauthenticated") return;
    (async () => {
      try {
        const res = await fetch("/api/auth/providers", { cache: "no-store" });
        const json = await res.json();
        setAvailableAuthProviders(Object.keys(json || {}));
      } catch {
        setAvailableAuthProviders([]);
      }
    })();
  }, [status]);

  async function fetchMe() {
    try {
      const attempt = async () => fetch("/api/me", { cache: "no-store" });
      let res = await attempt();

      // In dev, session cookies can race right after sign-in.
      if (res.status === 401) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        res = await attempt();
      }

      if (res.status === 401) {
        await signOut();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        return;
      }
      console.error("Failed to load user profile", await res.text());
      await signOut();
    } catch (e) {
      console.error("Failed to load user profile", e);
      await signOut();
    }
  }

  async function fetchList() {
    try {
      const [resList, resMappings] = await Promise.all([
        fetch("/api/config?type=list", { cache: "no-store" }),
        fetch("/api/config?type=phone_mappings&_t=" + Date.now(), { cache: "no-store" }) // Cache bust
      ]);
      if (resList.status === 401 || resMappings.status === 401) {
        await signOut();
        return;
      }
      if (!resList.ok) {
        throw new Error(`Failed to load config list (${resList.status})`);
      }
      const dataList = await resList.json();
      const dataMappings = resMappings.ok ? await resMappings.json() : { mappings: {} };

      setList(dataList);
      setPhoneMappings(dataMappings.mappings || {});
      setPhoneMappingsContent(JSON.stringify(dataMappings, null, 2));
    } catch (e) {
      console.error("Failed to load initial data", e);
      setList({ industries: [], clients: {} });
      setMessage("Error: Failed to load configuration list.");
    }
  }

  async function loadConfig(type: "industry" | "client", industry: string, client?: string) {
    if (activeTab === 'phone_mappings' || activeTab === 'users') {
      setActiveTab("workflows");
    }

    setSelectedType(type);
    setSelectedIndustry(industry);
    setSelectedClient(client || null);
    setSelectedWorkflowKey(null);
    setIsLoadingConfig(true);
    setLoadError(null);

    const query = new URLSearchParams({ type, industry });
    if (client) query.set("client", client);

    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const requestId = ++loadRequestIdRef.current;

    let res: Response;
    try {
      res = await fetch(`/api/config?${query.toString()}&_t=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (e) {
      setIsLoadingConfig(false);
      return;
    }

    if (res.status === 403) {
      alert("Access Denied to this client.");
      setIsLoadingConfig(false);
      return;
    }

    if (requestId !== loadRequestIdRef.current) {
      setIsLoadingConfig(false);
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      const err = json?.error || `Failed to load config (${res.status})`;
      setLoadError(String(err));
      setMessage(`Error: ${String(err)}`);
      setIsLoadingConfig(false);
      return;
    }

    setEditorContent(JSON.stringify(json, null, 2));
    setMessage("");
    setIsLoadingConfig(false);
    try {
      const key = client ? `${industry}::${client}` : `${industry}::`;
      localStorage.setItem("dashboard:lastConfig", key);
    } catch {
      // Ignore localStorage failures.
    }
  }

  function validateConfigForSave(content: any, scope: "industry" | "client") {
    const errors: string[] = [];
    if (!content || typeof content !== "object") {
      return ["Configuration must be a JSON object."];
    }

    const workflows = content.workflows || {};
    const prompts = content.prompts || {};
    const workflowKeys = Object.keys(workflows);

    if (!workflowKeys.length) errors.push("At least one workflow is required.");
    if (!content.prompts || typeof prompts !== "object") errors.push("`prompts` object is required.");
    if (scope === "client" && !workflows.first_response) {
      errors.push("`first_response` workflow is required for client configs.");
    }
    if (content.default_intent && !workflows[content.default_intent]) {
      errors.push("`default_intent` must match an existing workflow key.");
    }
    if (Array.isArray(content.intents)) {
      for (const intent of content.intents) {
        const key = String(intent || "").trim();
        if (!key || key === "general") continue;
        if (!workflows[key]) errors.push(`Intent '${key}' has no matching workflow.`);
      }
    }

    const missingPromptKeys = new Set<string>();
    for (const workflowKey of workflowKeys) {
      const wf = workflows[workflowKey];
      const nodes = Array.isArray(wf?.nodes) ? wf.nodes : null;
      const edges = Array.isArray(wf?.edges) ? wf.edges : null;
      if (!nodes) {
        errors.push(`Workflow '${workflowKey}' is missing a valid nodes array.`);
        continue;
      }
      if (!edges) {
        errors.push(`Workflow '${workflowKey}' is missing a valid edges array.`);
        continue;
      }

      const nodeIds = new Set<string>();
      for (const node of nodes) {
        const nodeId = String(node?.id || "").trim();
        if (!nodeId) {
          errors.push(`Workflow '${workflowKey}' contains a node with no id.`);
          continue;
        }
        if (nodeIds.has(nodeId)) {
          errors.push(`Workflow '${workflowKey}' has duplicate node id '${nodeId}'.`);
        }
        nodeIds.add(nodeId);

        const promptKey = String(node?.data?.promptKey || "").trim();
        const promptKeyWithName = String(node?.data?.promptKeyWithName || "").trim();
        if (promptKey && !String(prompts[promptKey] || "").trim()) missingPromptKeys.add(promptKey);
        if (promptKeyWithName && !String(prompts[promptKeyWithName] || "").trim()) missingPromptKeys.add(promptKeyWithName);

        if (String(node?.type || "") === "handoff") {
          const targetWorkflow = String(node?.data?.targetWorkflow || "").trim();
          if (!targetWorkflow) {
            errors.push(`Workflow '${workflowKey}' has a handoff node with no target workflow.`);
          } else if (!workflows[targetWorkflow]) {
            errors.push(`Workflow '${workflowKey}' has handoff target '${targetWorkflow}' which does not exist.`);
          }
        }
      }

      for (const edge of edges) {
        const source = String(edge?.source || "").trim();
        const target = String(edge?.target || "").trim();
        if (!source || !target) {
          errors.push(`Workflow '${workflowKey}' has an edge with missing source/target.`);
          continue;
        }
        if (!nodeIds.has(source) || !nodeIds.has(target)) {
          errors.push(`Workflow '${workflowKey}' has an edge referencing unknown node(s): ${source} -> ${target}.`);
        }
      }
    }

    for (const key of missingPromptKeys) {
      errors.push(`Missing prompt text for key '${key}' (referenced by workflow nodes).`);
    }

    return errors;
  }

  async function fetchCallTraces() {
    if (!selectedIndustry || !selectedClient || selectedType !== "client") {
      setCallTraceError("Select a client config first.");
      setCallTraces([]);
      return;
    }
    setIsLoadingCallTraces(true);
    setCallTraceError("");
    try {
      const params = new URLSearchParams({
        limit: "120",
        industry: selectedIndustry,
        client_id: selectedClient,
      });
      const res = await fetch(`/api/call-traces?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setCallTraceError(String(json?.error || `Failed to load traces (${res.status})`));
        setCallTraces([]);
        return;
      }
      setCallTraces(Array.isArray(json?.traces) ? json.traces : []);
    } catch (e) {
      setCallTraceError(e instanceof Error ? e.message : "Failed to load traces.");
      setCallTraces([]);
    } finally {
      setIsLoadingCallTraces(false);
    }
  }

  async function saveConfig() {
    if (loadError) {
      setMessage(`Error: cannot save because latest load failed (${loadError})`);
      return;
    }
    if (!canSave) {
      setMessage("Read-only: you do not have permission to save.");
      return;
    }
    // Handle Phone Mappings Save
    if (activeTab === 'phone_mappings' || leftEditorTab === "phone_routing") {
      const ok = confirm("Save changes to global Phone Routing?");
      if (!ok) return;
      try {
        const content = JSON.parse(phoneMappingsContent || editorContent);
        const res = await fetch("/api/config", {
          method: "POST",
          body: JSON.stringify({
            action: 'save',
            type: 'phone_mappings',
            content
          })
        });

        if (res.status === 403) {
          setMessage("Error: Access Denied (Admin Only)");
          return;
        }

        if (res.ok) {
          setMessage("Saved successfully!");
          // Refresh mappings in state immediately
          setPhoneMappings(content.mappings || {});
        } else {
          setMessage("Error saving.");
        }
      } catch (e) {
        setMessage("Invalid JSON");
      }
      return;
    }

    if (!selectedIndustry || !selectedType) return;

    const targetLabel = selectedType === "client"
      ? `client '${selectedClient}' in industry '${selectedIndustry}'`
      : `industry defaults for '${selectedIndustry}'`;
    const confirmText = `Save changes to ${targetLabel}?`;
    if (!confirm(confirmText)) return;

    try {
      const content = JSON.parse(editorContent);
      const validationErrors = validateConfigForSave(content, selectedType);
      if (validationErrors.length > 0) {
        setMessage(`Error: Validation failed. ${validationErrors.slice(0, 3).join(" | ")}`);
        return;
      }
      console.log('[SAVE DEBUG] Saving config:', { type: selectedType, industry: selectedIndustry, client: selectedClient });
      console.log('[SAVE DEBUG] Content has workflows:', !!content.workflows);
      console.log('[SAVE DEBUG] Workflow keys:', Object.keys(content.workflows || {}));

      const res = await fetch("/api/config", {
        method: "POST",
        body: JSON.stringify({
          action: 'save',
          type: selectedType,
          industry: selectedIndustry,
          client: selectedClient,
          content
        })
      });

      if (res.status === 403) {
        setMessage("Error: Forbidden");
        return;
      }

      if (res.ok) {
        console.log('[SAVE DEBUG] Save successful!');
        setMessage("Saved successfully!");
      } else {
        const errorText = await res.text();
        console.error('[SAVE DEBUG] Save failed:', errorText);
        setMessage("Error saving.");
      }
    } catch (e) {
      console.error('[SAVE DEBUG] Exception:', e);
      setMessage("Invalid JSON");
    }
  }

  async function saveVariant() {
    if (!selectedIndustry || !selectedClient || selectedType !== "client") return;
    const variantName = prompt("Variant name");
    if (!variantName) return;

    const res = await fetch("/api/config", {
      method: "POST",
      body: JSON.stringify({
        action: "save_variant",
        industry: selectedIndustry,
        client: selectedClient,
        variantName,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({} as any));
      setMessage(`Error: ${err?.error || "Failed to save variant"}`);
      return;
    }
    setMessage(`Variant saved: ${variantName}`);
  }

  async function loadVariant() {
    if (!selectedIndustry || !selectedClient || selectedType !== "client") return;

    const listRes = await fetch(`/api/config?type=variants&industry=${encodeURIComponent(selectedIndustry)}&client=${encodeURIComponent(selectedClient)}&_t=${Date.now()}`, {
      cache: "no-store",
    });
    const listJson = await listRes.json().catch(() => ({} as any));
    const variants = Array.isArray(listJson?.variants) ? listJson.variants : [];
    if (!variants.length) {
      setMessage("No saved variants for this client");
      return;
    }

    const names = variants.map((v: any) => v.name);
    const choice = prompt(`Enter variant name to load:\n${names.join("\n")}`, names[0]);
    if (!choice) return;

    const res = await fetch("/api/config", {
      method: "POST",
      body: JSON.stringify({
        action: "load_variant",
        industry: selectedIndustry,
        client: selectedClient,
        variantName: choice,
      }),
    });

    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      setMessage(`Error: ${json?.error || "Failed to load variant"}`);
      return;
    }
    await loadConfig("client", selectedIndustry, selectedClient);
    setMessage(`Variant loaded: ${choice}`);
  }

  // --- Modal / Action Handlers ---

  const openCreateIndustry = () => {
    setModalType('create_industry');
    setModalData({});
    setModalInput("");
    setModalOpen(true);
  };

  const openCreateClient = (industry: string) => {
    setModalType('create_client');
    setModalData({ industry });
    setModalInput("");
    setNewClientDraft({
      industry: industry || "",
      brand_name: "",
      assistant_name: "",
      agent_name: "",
      opening_hours: "",
      brand_phone: "",
      language: "en-GB",
      tone: "",
      tts_provider: "",
      elevenlabs_voice_id: "",
      azure_voice_name: "",
      intents_csv: "",
      default_intent: "first_response",
    });
    setCreateClientMode("industry_template");
    setCreateClientTemplateSource("");
    // Best-effort voice library load for dropdowns in the create dialog.
    fetch("/api/config?type=voice_library", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { voices: [] })
      .then((json) => setCreateClientVoices(Array.isArray(json?.voices) ? json.voices : []))
      .catch(() => setCreateClientVoices([]));
    setModalOpen(true);
  };

  const getVoiceLocale = (voice: NewClientVoiceEntry) => {
    if (voice.locale) return voice.locale;
    const match = String(voice.voice_name || "").match(/^([a-z]{2,3}-[A-Z]{2,4})-/);
    return match ? match[1] : "";
  };

  const isCreateVoiceApplicable = (voice: NewClientVoiceEntry) => {
    if (voice.provider === "elevenlabs") return true;
    const locale = getVoiceLocale(voice);
    return !locale || locale.toLowerCase() === newClientDraft.language.toLowerCase();
  };

  const openCopyClient = (industry: string, client: string) => {
    setModalType('copy_client');
    setModalData({ industry, sourceClient: client });
    setModalInput(`${client}_copy`);
    setModalOpen(true);
  };

  const handleModalSubmit = async () => {
    if (!modalInput) return;

    const payload: any = { action: modalType, newName: modalInput };

    if (modalType === 'create_industry') {
      // uses newName
    } else if (modalType === 'create_client') {
      payload.industry = (newClientDraft.industry || modalData.industry || "").trim();
      if (!payload.industry) {
        alert("Industry is required.");
        return;
      }

      const normalizeIntent = (raw: string) =>
        String(raw || "")
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, "");

      const intents = newClientDraft.intents_csv
        .split(",")
        .map((x) => normalizeIntent(x))
        .filter(Boolean);

      const content: any = {};
      if (newClientDraft.brand_name.trim()) content.brand_name = newClientDraft.brand_name.trim();
      if (newClientDraft.assistant_name.trim()) content.assistant_name = newClientDraft.assistant_name.trim();
      if (newClientDraft.agent_name.trim()) content.agent_name = newClientDraft.agent_name.trim();
      if (newClientDraft.opening_hours.trim()) content.opening_hours = newClientDraft.opening_hours.trim();
      if (newClientDraft.brand_phone.trim()) content.brand_phone = newClientDraft.brand_phone.trim();
      if (newClientDraft.language.trim()) {
        content.language = newClientDraft.language.trim();
        content.azure_ssml_lang = newClientDraft.language.trim();
      }
      if (newClientDraft.tone.trim()) content.tone = newClientDraft.tone.trim();
      if (intents.length) content.intents = Array.from(new Set(["first_response", ...intents]));

      const defaultIntent = normalizeIntent(newClientDraft.default_intent);
      if (defaultIntent) content.default_intent = defaultIntent;

      if (newClientDraft.tts_provider) {
        content.tts_provider = newClientDraft.tts_provider;
        if (newClientDraft.tts_provider === "elevenlabs" && newClientDraft.elevenlabs_voice_id.trim()) {
          content.elevenlabs_voice_id = newClientDraft.elevenlabs_voice_id.trim();
        }
        if (newClientDraft.tts_provider === "azure_neural" && newClientDraft.azure_voice_name.trim()) {
          content.azure_voice_name = newClientDraft.azure_voice_name.trim();
        }
      }
      payload.content = content;
      payload.create_mode = createClientMode;
      if (createClientMode === "industry_template" && createClientTemplateSource.trim()) {
        payload.template_client = createClientTemplateSource.trim();
      }
    } else if (modalType === 'copy_client') {
      payload.industry = modalData.industry;
      payload.client = modalData.sourceClient;
    }

    const res = await fetch("/api/config", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (res.status === 403) {
      alert("Action Forbidden");
      return;
    }

    if (res.ok) {
      setModalOpen(false);
      fetchList(); // Refresh sidebar
      setMessage("Operation successful");
    } else {
      const err = await res.json();
      alert("Error: " + err.error);
    }
  };

  const deleteConfig = async (type: "industry" | "client", industry: string, client?: string) => {
    const label = type === "client" ? client : industry;
    if (!confirm(`Are you sure you want to delete ${label}? This cannot be undone.`)) return;

    const res = await fetch("/api/config", {
      method: "POST",
      body: JSON.stringify({
        action: type === "client" ? "delete_client" : "delete_industry",
        industry,
        client,
      }),
    });

    if (res.status === 403) {
      alert("Action Forbidden");
      return;
    }

    if (res.ok) {
      if (selectedIndustry === industry && (selectedType === "industry" || selectedClient === client)) {
        setSelectedIndustry(null);
        setSelectedClient(null);
        setSelectedType(null);
        setEditorContent("");
      }
      fetchList();
      setMessage("Deleted successfully");
    } else {
      const err = await res.json();
      alert("Error: " + err.error);
    }
  };

  const permissions = user?.permissions || {};
  const isGlobalAdmin = user?.role === "global_admin" || (
    user?.role === "admin" && (
      (user.allowed_industries || []).includes("*") || (user.allowed_clients || []).includes("*")
    )
  );
  const isAdmin = user?.role === "admin" || isGlobalAdmin;
  const canViewPhoneMappings = isGlobalAdmin || permissions.can_view_phone_mappings;
  const canEditPhoneMappings = isGlobalAdmin || permissions.can_edit_phone_mappings;
  const canEditClients = isGlobalAdmin || permissions.can_edit_clients;
  const canEditIndustries = isGlobalAdmin;
  const canManageUsers = isGlobalAdmin || permissions.can_manage_users;
  const canManagePromptLibrary = isGlobalAdmin || permissions.can_manage_prompt_library;
  const canManageIntentLibrary = isGlobalAdmin || permissions.can_manage_prompt_library;
  // Voice library modifications are Admin-only (per product requirement), regardless of per-user flags.
  const canManageVoiceLibrary = isAdmin && (isGlobalAdmin || permissions.can_manage_voice_library);
  const canViewHistory = isGlobalAdmin || permissions.can_view_history;
  const canRevertHistory = isGlobalAdmin || permissions.can_revert_history;
  const canSave = (() => {
    if (activeTab === "phone_mappings" || leftEditorTab === "phone_routing") return canEditPhoneMappings;
    if (selectedType === "client") return canEditClients;
    if (selectedType === "industry") return canEditIndustries;
    return false;
  })();

  const workflowKeys = (() => {
    if (!isValidJson(editorContent)) return [] as string[];
    const parsed = JSON.parse(editorContent);
    const rules = parsed?.intent_routing_rules || {};
    const intents: string[] = Array.isArray(parsed?.intents)
      ? parsed.intents.filter(
        (k: string) => k !== "general" && (k === "first_response" || rules?.[k]?.enabled !== false)
      )
      : [];
    const workflows: string[] = parsed?.workflows ? Object.keys(parsed.workflows).filter((k) => k !== "general") : [];
    const base: string[] = intents.length ? intents : workflows;
    if (parsed?.workflows?.first_response && !base.includes("first_response")) {
      base.push("first_response");
    }
    return Array.from(new Set<string>(base));
  })();
  const filteredWorkflowKeys = workflowKeys.filter((k) => k.toLowerCase().includes(workflowFilter.trim().toLowerCase()));
  const selectedClientMappedNumber = (() => {
    if (!selectedIndustry || !selectedClient) return "";
    const found = Object.entries(phoneMappings).find(
      ([, val]) =>
        val.client_id?.trim().toLowerCase() === selectedClient.trim().toLowerCase() &&
        val.industry?.trim().toLowerCase() === selectedIndustry.trim().toLowerCase()
    );
    return found?.[0] || "";
  })();
  const pickerQuery = pickerClientSearch.trim().toLowerCase();
  const visibleClients = (list
    ? Object.entries(list.clients).flatMap(([industry, clients]) =>
      (clients || []).map((client) => ({ industry, client }))
    )
    : []
  ).filter(({ industry, client }) => {
    if (!pickerQuery) return true;
    const clientMatch = client.toLowerCase().includes(pickerQuery);
    const industryMatch = industry.toLowerCase().includes(pickerQuery);
    return clientMatch || industryMatch;
  });

  useEffect(() => {
    if (activeTab !== "workflows") return;
    if (!workflowKeys.length) {
      if (selectedWorkflowKey !== null) setSelectedWorkflowKey(null);
      return;
    }
    if (selectedWorkflowKey && workflowKeys.includes(selectedWorkflowKey)) return;

    const parsed = isValidJson(editorContent) ? JSON.parse(editorContent) : {};
    const preferred = parsed?.default_intent && workflowKeys.includes(parsed.default_intent)
      ? parsed.default_intent
      : (workflowKeys.includes("first_response") ? "first_response" : workflowKeys[0]);
    setSelectedWorkflowKey(preferred);
  }, [activeTab, editorContent, selectedWorkflowKey, workflowKeys]);

  useEffect(() => {
    setPickerIndustry(selectedIndustry || "");
    setPickerClientKey(selectedIndustry && selectedClient ? `${selectedIndustry}::${selectedClient}` : "");
    setPickerClientSearch("");
  }, [selectedIndustry, selectedClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setTestCallTo(localStorage.getItem("dashboard:testCallTo") || "");
      const savedWebhook = localStorage.getItem("dashboard:testCallWebhookBaseUrl") || "";
      const nextWebhook = shouldIgnoreSavedWebhook(savedWebhook)
        ? inferDefaultVoiceWebhookBaseUrl()
        : (savedWebhook || inferDefaultVoiceWebhookBaseUrl());
      setTestCallWebhookBaseUrl(nextWebhook);
    } catch {
      // Ignore localStorage failures.
      setTestCallWebhookBaseUrl(inferDefaultVoiceWebhookBaseUrl());
    }
  }, []);

  useEffect(() => {
    if (!selectedClientMappedNumber) return;
    setTestCallFrom(selectedClientMappedNumber);
  }, [selectedClientMappedNumber]);

  useEffect(() => {
    if (!callTraceOpen) return;
    fetchCallTraces();
  }, [callTraceOpen, selectedIndustry, selectedClient, selectedType]);

  useEffect(() => {
    if (!list || !session || initialConfigLoaded) return;
    if (selectedIndustry || isLoadingConfig) return;

    let loaded = false;
    try {
      const saved = localStorage.getItem("dashboard:lastConfig");
      if (saved) {
        const [industry, client] = saved.split("::");
        if (industry && client && list.industries.includes(industry) && (list.clients[industry] || []).includes(client)) {
          loadConfig("client", industry, client);
          loaded = true;
        }
      }
    } catch {
      // Ignore localStorage failures.
    }

    if (!loaded) {
      const firstIndustry = list.industries[0];
      if (!firstIndustry) {
        setInitialConfigLoaded(true);
        return;
      }
      const firstClient = (list.clients[firstIndustry] || [])[0];
      if (firstClient) {
        loadConfig("client", firstIndustry, firstClient);
      } else {
        setInitialConfigLoaded(true);
        return;
      }
    }
    setInitialConfigLoaded(true);
  }, [list, session, initialConfigLoaded, selectedIndustry, isLoadingConfig]);

  const toggleSection = (section: "context" | "workflows" | "picker") => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  function inferDefaultVoiceWebhookBaseUrl() {
    if (typeof window === "undefined") return "";
    const envUrl = (process.env.NEXT_PUBLIC_VOICE_WEBHOOK_BASE_URL || "").trim();
    if (envUrl) return envUrl;

    try {
      const current = new URL(window.location.origin);
      const isLocal =
        current.hostname === "localhost" ||
        current.hostname === "127.0.0.1" ||
        current.hostname === "::1";
      // Local dev default: dashboard on :3000, voice agent on :8010.
      if (isLocal && current.port === "3000") {
        current.port = "8010";
        return current.origin;
      }
      const host = current.hostname;
      if (host.includes("app-workflow-manager")) {
        current.hostname = host.replace("app-workflow-manager", "app-voice-agent");
        return current.origin;
      }
      return current.origin;
    } catch {
      return "";
    }
  }

  function isLikelyDashboardWebhook(baseUrl: string) {
    const trimmed = baseUrl.trim();
    if (!trimmed) return false;
    try {
      const u = new URL(trimmed);
      const isLocalDashboard =
        (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1") &&
        u.port === "3000";
      const isCloudDashboard = u.hostname.includes("app-workflow-manager");
      return isLocalDashboard || isCloudDashboard;
    } catch {
      return false;
    }
  }

  function shouldIgnoreSavedWebhook(savedWebhook: string) {
    if (!savedWebhook || typeof window === "undefined") return false;
    try {
      const saved = new URL(savedWebhook);
      const current = new URL(window.location.origin);
      const savedIsLocal =
        saved.hostname === "localhost" ||
        saved.hostname === "127.0.0.1" ||
        saved.hostname === "::1";
      const currentIsLocal =
        current.hostname === "localhost" ||
        current.hostname === "127.0.0.1" ||
        current.hostname === "::1";
      return savedIsLocal && !currentIsLocal;
    } catch {
      return false;
    }
  }

  const addSimLog = (message: string) => {
    const ts = new Date().toLocaleTimeString();
    setSimCallLogs((prev) => [...prev.slice(-79), { ts, message }]);
  };

  const base64FromBytes = (bytes: Uint8Array) => {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...sub);
    }
    return btoa(binary);
  };

  const bytesFromBase64 = (b64: string) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const pcm16ToUlaw = (sample: number) => {
    const BIAS = 0x84;
    const CLIP = 32635;
    const s = Math.max(-1, Math.min(1, sample));
    let pcm = Math.round(s * 32767);
    let sign = 0;
    if (pcm < 0) {
      sign = 0x80;
      pcm = -pcm;
    }
    if (pcm > CLIP) pcm = CLIP;
    pcm += BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; expMask >>= 1) {
      exponent -= 1;
    }
    const mantissa = (pcm >> (exponent + 3)) & 0x0f;
    const ulaw = ~(sign | (exponent << 4) | mantissa) & 0xff;
    return ulaw;
  };

  const ulawToPcm16 = (ulaw: number) => {
    const BIAS = 0x84;
    const u = (~ulaw) & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    let pcm = ((mantissa << 3) + BIAS) << exponent;
    pcm -= BIAS;
    return sign ? -pcm : pcm;
  };

  const downsampleTo8k = (input: Float32Array, inputRate: number) => {
    if (inputRate === 8000) return input;
    const ratio = inputRate / 8000;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < output.length) {
      const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer; i += 1) {
        accum += input[i];
        count += 1;
      }
      output[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }
    return output;
  };

  const resolveWsUrl = (baseUrl: string, client: string, industry: string, workflow: string) => {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    const wsBase = trimmed.startsWith("https://")
      ? trimmed.replace("https://", "wss://")
      : trimmed.startsWith("http://")
        ? trimmed.replace("http://", "ws://")
        : trimmed;
    const wsUrl = new URL(`${wsBase}/api/audio-twilio`);
    wsUrl.searchParams.set("client_id", client);
    wsUrl.searchParams.set("industry", industry);
    wsUrl.searchParams.set("test_mode", "1");
    wsUrl.searchParams.set("test_workflow", workflow);
    return wsUrl.toString();
  };

  const stopSimulatedCall = (silent = false) => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const sid = simStreamSidRef.current || `sim-${Date.now()}`;
        wsRef.current.send(JSON.stringify({ event: "stop", streamSid: sid }));
      }
    } catch {
      // Ignore close send failures.
    }
    try {
      wsRef.current?.close();
    } catch {
      // Ignore close failures.
    }
    wsRef.current = null;

    try {
      simProcessorNodeRef.current?.disconnect();
      simSourceNodeRef.current?.disconnect();
      simGainNodeRef.current?.disconnect();
      simMediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // Ignore media cleanup failures.
    }
    simProcessorNodeRef.current = null;
    simSourceNodeRef.current = null;
    simGainNodeRef.current = null;
    simMediaStreamRef.current = null;

    const ctx = simAudioContextRef.current;
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => undefined);
    }
    simAudioContextRef.current = null;
    simNextPlaybackTimeRef.current = 0;
    simReceivedAudioRef.current = 0;
    setIsSimulatingCall(false);
    if (!silent) addSimLog("Simulation stopped");
  };

  async function startSimulatedCall() {
    if (!selectedIndustry || !selectedClient || selectedType !== "client") {
      setMessage("Error: Select a client config before starting simulation.");
      return;
    }
    if (!testCallWebhookBaseUrl.trim()) {
      setMessage("Error: Voice Webhook URL is required for simulation.");
      return;
    }
    if (isLikelyDashboardWebhook(testCallWebhookBaseUrl)) {
      setMessage("Error: Voice Webhook URL points to dashboard host. Use voice agent host (local default: http://localhost:8010).");
      return;
    }

    try {
      setSimCallLogs([]);
      setIsSimulatingCall(true);
      addSimLog("Requesting microphone access...");
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      simMediaStreamRef.current = mediaStream;

      const audioContext = new AudioContext({ sampleRate: 48000 });
      simAudioContextRef.current = audioContext;
      await audioContext.resume();
      const sourceNode = audioContext.createMediaStreamSource(mediaStream);
      const processorNode = audioContext.createScriptProcessor(2048, 1, 1);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.25;
      simSourceNodeRef.current = sourceNode;
      simProcessorNodeRef.current = processorNode;
      simGainNodeRef.current = gainNode;
      addSimLog(`Audio context: ${audioContext.state}`);

      const workflow = selectedWorkflowKey || "first_response";
      const wsUrl = resolveWsUrl(testCallWebhookBaseUrl, selectedClient, selectedIndustry, workflow);
      addSimLog(`Connecting WebSocket: ${wsUrl}`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      const streamSid = `sim-${Date.now()}`;
      const callSid = `simcall-${Date.now()}`;
      simStreamSidRef.current = streamSid;

      ws.onopen = () => {
        addSimLog("Connected. Starting simulated call...");
        ws.send(
          JSON.stringify({
            event: "start",
            start: {
              streamSid,
              callSid,
              customParameters: {
                phone_number: "client:browser",
                called_number: testCallFrom || "browser",
                client_id: selectedClient,
                industry: selectedIndustry,
                test_mode: "1",
                test_workflow: workflow
              }
            }
          })
        );
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as {
            event?: string;
            media?: { payload?: string };
            kind?: string;
            intent?: string;
            previous_intent?: string;
            current_node_id?: string;
            test_workflow?: string;
          };
          if (data.event === "sim_state") {
            if (data.kind === "workflow_handoff") {
              addSimLog(
                `Handoff: ${data.previous_intent || "unknown"} -> ${data.intent || "unknown"}`
              );
            } else if (data.kind === "session_start") {
              addSimLog(
                `Session started: intent=${data.intent || "-"} node=${data.current_node_id || "-"}`
              );
            } else {
              addSimLog(
                `Turn: intent=${data.intent || "-"} node=${data.current_node_id || "-"}`
              );
            }
            return;
          }
          if (data.event === "clear") {
            if (simAudioContextRef.current) {
              simNextPlaybackTimeRef.current = simAudioContextRef.current.currentTime;
            }
            return;
          }
          if (data.event !== "media" || !data.media?.payload || !simAudioContextRef.current) return;

          const ulawBytes = bytesFromBase64(data.media.payload);
          const pcmFloat = new Float32Array(ulawBytes.length);
          for (let i = 0; i < ulawBytes.length; i += 1) {
            pcmFloat[i] = ulawToPcm16(ulawBytes[i]) / 32768;
          }

          const ctx = simAudioContextRef.current;
          if (ctx.state !== "running") {
            ctx.resume().catch(() => undefined);
          }
          const buffer = ctx.createBuffer(1, pcmFloat.length, 8000);
          buffer.copyToChannel(pcmFloat, 0);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(simGainNodeRef.current || ctx.destination);
          if (simGainNodeRef.current) {
            simGainNodeRef.current.connect(ctx.destination);
          }

          const now = ctx.currentTime;
          const startAt = Math.max(simNextPlaybackTimeRef.current || now, now + 0.01);
          src.start(startAt);
          simNextPlaybackTimeRef.current = startAt + buffer.duration;
          simReceivedAudioRef.current += 1;
          if (simReceivedAudioRef.current === 1) {
            addSimLog(`Received first audio packet (${ulawBytes.length} bytes)`);
          }
        } catch {
          // Ignore non-json/unknown events.
        }
      };

      ws.onclose = () => {
        addSimLog("WebSocket closed");
        stopSimulatedCall();
      };
      ws.onerror = () => {
        addSimLog("WebSocket error");
      };

      processorNode.onaudioprocess = (event) => {
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const downsampled = downsampleTo8k(input, audioContext.sampleRate);
        const ulaw = new Uint8Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i += 1) {
          ulaw[i] = pcm16ToUlaw(downsampled[i]);
        }
        socket.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: base64FromBytes(ulaw) }
          })
        );
      };

      sourceNode.connect(processorNode);
      processorNode.connect(audioContext.destination);
      addSimLog("Streaming microphone audio to agent");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start simulation";
      setMessage(`Error: ${msg}`);
      setIsSimulatingCall(false);
      stopSimulatedCall();
    }
  }

  useEffect(() => {
    return () => {
      stopSimulatedCall(true);
    };
  }, []);

  async function startTestCall() {
    if (!selectedIndustry || !selectedClient || selectedType !== "client") {
      setMessage("Error: Select a client config before starting a test call.");
      return;
    }
    if (!testCallTo.trim() || !testCallFrom.trim() || !testCallWebhookBaseUrl.trim()) {
      setMessage("Error: Test call requires To, From, and Voice Webhook URL.");
      return;
    }
    if (isLikelyDashboardWebhook(testCallWebhookBaseUrl)) {
      setMessage("Error: Voice Webhook URL points to dashboard host. Use voice agent host (local default: http://localhost:8010).");
      return;
    }

    setIsStartingTestCall(true);
    try {
      const res = await fetch("/api/calls/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: testCallTo.trim(),
          from: testCallFrom.trim(),
          webhookBaseUrl: testCallWebhookBaseUrl.trim(),
          industry: selectedIndustry,
          client: selectedClient,
          workflow: selectedWorkflowKey || "first_response"
        })
      });
      const json: { error?: string; sid?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(`Error: ${json?.error || "Failed to start test call"}`);
        return;
      }

      try {
        localStorage.setItem("dashboard:testCallTo", testCallTo.trim());
        localStorage.setItem("dashboard:testCallWebhookBaseUrl", testCallWebhookBaseUrl.trim());
      } catch {
        // Ignore localStorage failures.
      }

      setTestCallOpen(false);
      setMessage(`Test call started (${json?.sid || "no sid"})`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to start test call";
      setMessage(`Error: ${message}`);
    } finally {
      setIsStartingTestCall(false);
    }
  }
  const beginNodeDrag = (
    event: DragEvent<HTMLButtonElement>,
    type: "prompt" | "action" | "condition" | "knowledge" | "handoff"
  ) => {
    event.dataTransfer.setData("application/x-node-type", type);
    event.dataTransfer.effectAllowed = "move";
  };
  const leftTabLabel = leftEditorTab === "prompts"
    ? "Prompt Library"
    : leftEditorTab === "config"
      ? "Client Config"
      : leftEditorTab === "phone_routing"
        ? "Phone Routing"
        : leftEditorTab === "json"
          ? "Raw JSON"
          : "Workflow Only";
  const sidebarWidthClass = isSidebarCompact ? "w-[17%] min-w-[220px]" : "w-[21%] min-w-[260px]";
  const sidebarSectionPaddingClass = isSidebarCompact ? "p-3" : "p-4";
  const compactClientListClass = "max-h-[11.5rem]";

  if (status === "loading") {
    return <div className="flex items-center justify-center h-screen bg-gray-900 text-white">Loading session...</div>;
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white p-4">
        <div className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Sign in</h2>
          <div className="space-y-3">
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
            />
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
            />
            {loginError && <div className="text-sm text-red-400">{loginError}</div>}
            <button
              onClick={async () => {
                setLoginError("");
                const res = await signIn("credentials", {
                  email: loginEmail.trim().toLowerCase(),
                  password: loginPassword,
                  redirect: false,
                });
                if (!res || res.error) {
                  setLoginError("Invalid email or password.");
                }
              }}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
            >
              Sign in
            </button>
            <div className="flex items-center justify-between text-xs">
              <button
                onClick={() => setResetOpen(true)}
                className="text-blue-300 hover:text-blue-200"
              >
                Forgot password?
              </button>
              <div className="text-gray-500">Use corporate SSO if enabled.</div>
            </div>
            {(availableAuthProviders.includes("google") || availableAuthProviders.includes("azure-ad")) && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                {availableAuthProviders.includes("google") && (
                  <button onClick={() => signIn("google")} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">Google</button>
                )}
                {availableAuthProviders.includes("azure-ad") && (
                  <button onClick={() => signIn("azure-ad")} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">Microsoft</button>
                )}
              </div>
            )}
          </div>
          {resetOpen && (
            <div className="mt-4 border-t border-gray-700 pt-4 space-y-2">
              <div className="text-sm text-gray-300">Request password reset</div>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="Your account email"
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
              />
              <button
                onClick={async () => {
                  setResetMessage("");
                  const res = await fetch("/api/auth/password-reset/request", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: resetEmail }),
                  });
                  const json = await res.json().catch(() => ({} as any));
                  setResetMessage(json?.message || (res.ok ? "If this email exists, a reset email has been sent." : "Reset request failed."));
                }}
                className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Send reset link
              </button>
              {resetMessage && <div className="text-xs text-gray-300">{resetMessage}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!list || !user) return <div className="p-10 bg-gray-900 text-white min-h-screen">Loading configuration...</div>;

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans relative">
      {/* Sidebar */}
      <div className={`${sidebarWidthClass} bg-gray-800 border-r border-gray-700 overflow-y-auto flex flex-col transition-all duration-200`}>
        {/* User Header */}
        <div className={`${sidebarSectionPaddingClass} border-b border-gray-700 bg-gray-800/50`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-col">
              <span className="font-bold text-white">{user.name}</span>
              <span className="text-xs text-gray-400">
                {user.role === "global_admin" ? "Global Admin" : user.role === "admin" ? "Admin" : "User"}
              </span>
            </div>
            <div className="flex items-center gap-2 relative">
              {(canManageUsers || canViewPhoneMappings) && (
                <div className="relative">
                  <button
                    onClick={() => setSettingsOpen(!settingsOpen)}
                    className="text-gray-400 hover:text-white"
                    title="Settings"
                  >
                    <Settings size={16} />
                  </button>
                  {settingsOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded shadow-lg z-50 overflow-hidden">
                      {canViewPhoneMappings && (
                        <button
                          onClick={() => {
                            setActiveTab("workflows");
                            setLeftEditorTab("phone_routing");
                            setSettingsOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                        >
                          Phone Routing
                        </button>
                      )}
                      {canManageUsers && (
                        <button
                          onClick={() => {
                            setActiveTab("users");
                            setSelectedType(null);
                            setSelectedIndustry(null);
                            setSettingsOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                        >
                          User Management
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => signOut()} className="text-red-400 hover:text-red-300" title="Sign Out">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className={`${sidebarSectionPaddingClass} bg-gray-900 sticky top-0 border-b border-gray-700 flex justify-between items-center`}>
          <h1 className={`${isSidebarCompact ? "text-lg" : "text-xl"} font-bold text-blue-400`}>Configurations</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSidebarCompact((v) => !v)}
              className="text-gray-400 hover:text-white"
              title={isSidebarCompact ? "Expand sidebar" : "Compact sidebar"}
            >
              {isSidebarCompact ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            {isGlobalAdmin && (
              <button onClick={openCreateIndustry} className="text-green-400 hover:text-green-300 hidden" title="Add Industry">
                <Plus size={20} />
              </button>
            )}
          </div>
        </div>

        {list && (
          <div className={`${sidebarSectionPaddingClass} border-b border-gray-700`}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Client Picker</h3>
            <div className="space-y-2">
              <input
                type="text"
                className={`w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 ${isSidebarCompact ? "text-xs" : "text-sm"} text-white`}
                placeholder="Filter clients..."
                value={pickerClientSearch}
                onChange={(e) => setPickerClientSearch(e.target.value)}
              />

              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Clients (all industries) ({visibleClients.length})
                </div>
                <div className={`${compactClientListClass} overflow-y-auto rounded border border-gray-700 bg-gray-900/60 p-1 space-y-1`}>
                  {visibleClients.map(({ industry, client }) => {
                    const key = `${industry}::${client}`;
                    return (
                      <button
                        key={key}
                        title={`${client} (${industry})`}
                        type="button"
                        onClick={() => {
                          setPickerIndustry(industry || "");
                          setPickerClientKey(key);
                          if (industry && client) loadConfig("client", industry, client);
                        }}
                        className={`w-full text-left px-2 py-1.5 text-xs rounded transition truncate ${pickerClientKey === key
                          ? "bg-blue-600/20 text-blue-300 border border-blue-500/40"
                          : "text-gray-300 hover:text-white hover:bg-gray-700"}`}
                      >
                        {client} / {industry}
                      </button>
                    );
                  })}
                  {visibleClients.length === 0 && (
                    <div className="px-2 py-1 text-xs text-gray-500">No matching clients</div>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className={`grid ${isSidebarCompact ? "grid-cols-1" : "grid-cols-3"} gap-2 pt-1`}>
                  <button
                    type="button"
                    onClick={() => {
                      const industryForCreate = pickerIndustry || selectedIndustry || "";
                      openCreateClient(industryForCreate);
                    }}
                    className="px-2 py-1.5 text-xs rounded border border-gray-600 text-gray-300 hover:text-white hover:border-blue-500"
                    title="Create a new client"
                  >
                    + New Client
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const sourceKey = pickerClientKey || (selectedIndustry && selectedClient ? `${selectedIndustry}::${selectedClient}` : "");
                      if (!sourceKey) {
                        alert("Select a source client first.");
                        return;
                      }
                      const [industryForCopy, clientForCopy] = sourceKey.split("::");
                      if (!industryForCopy || !clientForCopy) {
                        alert("Select a source client first.");
                        return;
                      }
                      openCopyClient(industryForCopy, clientForCopy);
                    }}
                    className="px-2 py-1.5 text-xs rounded border border-gray-600 text-gray-300 hover:text-white hover:border-purple-500"
                    title="Clone selected client (Admin only)"
                  >
                    Clone Client
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const sourceKey = pickerClientKey || (selectedIndustry && selectedClient ? `${selectedIndustry}::${selectedClient}` : "");
                      if (!sourceKey) {
                        alert("Select a client first.");
                        return;
                      }
                      const [industryForDelete, clientForDelete] = sourceKey.split("::");
                      if (!industryForDelete || !clientForDelete) {
                        alert("Select a client first.");
                        return;
                      }
                      deleteConfig("client", industryForDelete, clientForDelete);
                    }}
                    className="px-2 py-1.5 text-xs rounded border border-red-700 text-red-300 hover:text-white hover:bg-red-800/40"
                    title="Remove selected client (Admin only)"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="p-2 flex-1 min-h-0 flex flex-col">
          <div className="text-xs text-gray-500 px-2">
            Client and workflow navigation is in this panel.
          </div>
          <div className="flex-1 min-h-0">
            <WorkflowCopilot
              industry={selectedIndustry}
              client={selectedClient}
              selectedWorkflowKey={selectedWorkflowKey}
              editorContent={editorContent}
            />
          </div>
        </div>
      </div>

      {/* Main Editor */}
      <div className="flex-1 flex flex-col">
        {selectedIndustry || leftEditorTab === "phone_routing" || activeTab === 'phone_mappings' || activeTab === 'users' ? (
          <>
            <div className="min-h-[64px] flex items-center justify-between px-6 py-3 bg-gray-800 border-b border-gray-700">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white">
                  {leftEditorTab === "phone_routing" || activeTab === 'phone_mappings' ? "Phone Number Routing" :
                    activeTab === 'users' ? "User Management" :
                      selectedType === 'industry' ? `${selectedIndustry} / defaults.json` :
                        selectedType === 'client' ? `${selectedIndustry} / ${selectedClient}.json` : "Dashboard"}
                </h2>
                {message && <span className={`text-sm ${message.includes('Error') || message.includes('Invalid') ? 'text-red-400' : 'text-green-400'}`}>{message}</span>}
                {!canSave && (selectedIndustry || leftEditorTab === "phone_routing" || activeTab === "phone_mappings") && (
                  <span className="text-xs text-yellow-400 block">Read-only access</span>
                )}
                {selectedIndustry && (
                  <div className="text-xs text-gray-400 mt-1">
                    Active View: <span className="text-white">{leftTabLabel}</span>
                  </div>
                )}
                {selectedIndustry && activeTab === "workflows" && (
                  <div className="mt-2">
                    <div className="inline-flex flex-wrap gap-1 p-1 rounded-lg border border-gray-700 bg-gray-900/60">
                    <button
                      onClick={() => {
                        setActiveTab("workflows");
                        setLeftEditorTab("none");
                      }}
                      className={`px-3 py-1.5 text-xs rounded-md transition ${leftEditorTab === "none" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
                    >
                      Workflow Only
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab("workflows");
                        setLeftEditorTab("prompts");
                      }}
                      className={`px-3 py-1.5 text-xs rounded-md transition ${leftEditorTab === "prompts" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
                    >
                      Prompt Library
                    </button>
                    {selectedType === "client" && (
                      <button
                        onClick={() => {
                          setActiveTab("workflows");
                          setLeftEditorTab("config");
                        }}
                        className={`px-3 py-1.5 text-xs rounded-md transition ${leftEditorTab === "config" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
                      >
                        Client Config
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setActiveTab("workflows");
                        setLeftEditorTab("json");
                      }}
                      className={`px-3 py-1.5 text-xs rounded-md transition ${leftEditorTab === "json" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
                    >
                      Raw JSON
                    </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedType === "client" && (
                  <div className="relative" ref={testingMenuRef}>
                    <button
                      onClick={() => {
                        setTestingMenuOpen((v) => !v);
                        setVersioningMenuOpen(false);
                      }}
                      className={`px-3 py-2 text-sm rounded font-medium transition border ${testingMenuOpen ? "bg-teal-600/20 border-teal-500 text-teal-200" : "border-gray-600 text-gray-300 hover:text-white"}`}
                    >
                      Testing
                    </button>
                    {testingMenuOpen && (
                      <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded shadow-lg z-40 overflow-hidden">
                        {canSave && (
                          <button
                            onClick={() => {
                              setTestingMenuOpen(false);
                              setTestCallOpen(true);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                          >
                            Start Test Call
                          </button>
                        )}
                        {canSave && (
                          <button
                            onClick={() => {
                              setTestingMenuOpen(false);
                              setSimulateCallOpen(true);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                          >
                            Simulate Call
                          </button>
                        )}
                        {canViewHistory && (
                          <button
                            onClick={() => {
                              setTestingMenuOpen(false);
                              setCallTraceOpen(true);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                          >
                            View Call Trace
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {selectedType === "client" && (
                  <div className="relative" ref={versioningMenuRef}>
                    <button
                      onClick={() => {
                        setVersioningMenuOpen((v) => !v);
                        setTestingMenuOpen(false);
                      }}
                      className={`px-3 py-2 text-sm rounded font-medium transition border ${versioningMenuOpen ? "bg-blue-600/20 border-blue-500 text-blue-200" : "border-gray-600 text-gray-300 hover:text-white"}`}
                    >
                      Versioning
                    </button>
                    {versioningMenuOpen && (
                      <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded shadow-lg z-40 overflow-hidden">
                        {canViewHistory && (
                          <button
                            onClick={() => {
                              setVersioningMenuOpen(false);
                              setShowHistory((v) => !v);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                          >
                            {showHistory ? "Hide History" : "Show History"}
                          </button>
                        )}
                        {canSave && (
                          <button
                            onClick={async () => {
                              setVersioningMenuOpen(false);
                              await saveVariant();
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                          >
                            Save Variant
                          </button>
                        )}
                        {canSave && (
                          <button
                            onClick={async () => {
                              setVersioningMenuOpen(false);
                              await loadVariant();
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                          >
                            Load Variant
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={saveConfig}
                  disabled={!canSave}
                  className={`flex items-center gap-2 px-4 py-2 rounded font-medium transition text-white ${canSave ? "bg-blue-600 hover:bg-blue-500" : "bg-gray-700 cursor-not-allowed text-gray-400"}`}
                >
                  <Save size={18} /> Save
                </button>
              </div>
            </div>

            <div className="flex-1 p-0 overflow-hidden relative bg-gray-900">
              {isLoadingConfig && (
                <div className="absolute inset-0 bg-gray-900/70 z-20 flex items-center justify-center text-gray-300">
                  Loading configuration...
                </div>
              )}
              {activeTab === "workflows" && (
                leftEditorTab === "none" ? (
                  <div className="h-full flex">
                    <div className="w-56 border-r border-gray-700 bg-gray-800 p-3">
                    <button
                      onClick={() => toggleSection("context")}
                      className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2"
                    >
                      <span>Client Context</span>
                      {collapsedSections.context ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {!collapsedSections.context && (
                      <div className="mb-3 rounded border border-gray-700 bg-gray-900/50 p-2 text-xs">
                        <div className="text-gray-400">Industry</div>
                        <div className="text-white truncate">{selectedIndustry || "-"}</div>
                        <div className="text-gray-400 mt-2">Client</div>
                        <div className="text-white truncate">{selectedClient || "Industry Defaults"}</div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                      <button
                        onClick={() => toggleSection("workflows")}
                        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500"
                      >
                        {collapsedSections.workflows ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        Workflows
                      </button>
                      <button
                        onClick={() => setAddWorkflowRequestNonce(Date.now())}
                        className="text-[10px] px-2 py-1 rounded border border-gray-600 text-gray-300 hover:text-white hover:border-blue-500"
                        title="Add Workflow"
                      >
                        + Add
                      </button>
                    </div>
                    {!collapsedSections.workflows && (
                      <>
                        <input
                          type="text"
                          className="w-full mb-2 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                          placeholder="Filter workflows..."
                          value={workflowFilter}
                          onChange={(e) => setWorkflowFilter(e.target.value)}
                        />
                        <div className="space-y-1 mb-4 max-h-48 overflow-y-auto pr-1">
                          {filteredWorkflowKeys.length === 0 && (
                            <div className="text-xs text-gray-500 px-2 py-1">
                              {workflowKeys.length === 0 ? "No workflows" : "No workflow matches"}
                            </div>
                          )}
                          {filteredWorkflowKeys.map((key) => (
                            <button
                              key={key}
                              onClick={() => setSelectedWorkflowKey(key)}
                              className={`w-full text-left px-2 py-1.5 rounded text-xs transition ${selectedWorkflowKey === key
                                ? "bg-blue-600/20 text-blue-300 border border-blue-500/40"
                                : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
                            >
                              {key === "first_response" ? "Initial Response" : key}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <button
                      onClick={() => toggleSection("picker")}
                      className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3"
                    >
                      <span>Node Picker</span>
                      {collapsedSections.picker ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {!collapsedSections.picker && (
                      <div className="space-y-2 text-sm">
                        <div className="text-[10px] text-gray-500">
                          Click to add, or drag onto canvas to place.
                        </div>
                        <button
                          draggable
                          onDragStart={(e) => beginNodeDrag(e, "prompt")}
                          onClick={() => setNodePickerAction({ type: "prompt", nonce: Date.now() })}
                          className="w-full text-left px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:border-green-500 hover:text-white"
                        >
                          Prompt Node
                        </button>
                        <button
                          draggable
                          onDragStart={(e) => beginNodeDrag(e, "action")}
                          onClick={() => setNodePickerAction({ type: "action", nonce: Date.now() })}
                          className="w-full text-left px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:border-blue-500 hover:text-white"
                        >
                          Action Node
                        </button>
                        <button
                          draggable
                          onDragStart={(e) => beginNodeDrag(e, "condition")}
                          onClick={() => setNodePickerAction({ type: "condition", nonce: Date.now() })}
                          className="w-full text-left px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:border-yellow-500 hover:text-white"
                        >
                          Condition Node
                        </button>
                        <button
                          draggable
                          onDragStart={(e) => beginNodeDrag(e, "knowledge")}
                          onClick={() => setNodePickerAction({ type: "knowledge", nonce: Date.now() })}
                          className="w-full text-left px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:border-cyan-500 hover:text-white"
                        >
                          Knowledge Base Node
                        </button>
                        <button
                          draggable
                          onDragStart={(e) => beginNodeDrag(e, "handoff")}
                          onClick={() => setNodePickerAction({ type: "handoff", nonce: Date.now() })}
                          className="w-full text-left px-3 py-2 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:border-purple-500 hover:text-white"
                        >
                          Handoff Node
                        </button>
                      </div>
                    )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <WorkflowVisualizer
                        key={`${selectedType}-${selectedIndustry}-${selectedClient}`}
                        jsonContent={isValidJson(editorContent) ? JSON.parse(editorContent) : {}}
                        onChange={(newJson) => setEditorContent(JSON.stringify(newJson, null, 2))}
                        isClientScope={selectedType === "client"}
                        onOpenPrompts={() => {
                          setActiveTab("workflows");
                          setLeftEditorTab("prompts");
                        }}
                        selectedWorkflowKey={selectedWorkflowKey}
                        onSelectedWorkflowKeyChange={setSelectedWorkflowKey}
                        showWorkflowTabs={false}
                        showFloatingEditor={false}
                        showDockedInspector={true}
                        showInternalToolbar={false}
                        nodePickerAction={nodePickerAction}
                        addWorkflowRequestNonce={addWorkflowRequestNonce}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="h-full p-4 overflow-y-auto">
                    {leftEditorTab === "json" && (
                      <textarea
                        className="w-full h-full bg-gray-900 border border-gray-700 rounded p-3 font-mono text-xs resize-none outline-none text-gray-300"
                        value={editorContent}
                        onChange={(e) => setEditorContent(e.target.value)}
                        spellCheck={false}
                        readOnly={!canSave}
                      />
                    )}

                    {leftEditorTab === "prompts" && (
                      <div className="h-full min-h-0 overflow-y-auto border border-gray-700 rounded bg-gray-900/50">
                        <PromptEditor
                          jsonContent={isValidJson(editorContent) ? JSON.parse(editorContent) : {}}
                          onChange={(newJson) => setEditorContent(JSON.stringify(newJson, null, 2))}
                          canManagePromptLibrary={canManagePromptLibrary}
                        />
                      </div>
                    )}

                    {leftEditorTab === "config" && selectedType === "client" && (
                      <div className="h-full min-h-0 overflow-y-auto border border-gray-700 rounded bg-gray-900/50">
                        <ClientConfigForm
                          key={`full-client-config-${selectedType}-${selectedIndustry}-${selectedClient}`}
                          jsonContent={isValidJson(editorContent) ? JSON.parse(editorContent) : {}}
                          onChange={(newJson) => setEditorContent(JSON.stringify(newJson, null, 2))}
                          assignedPhoneNumber={Object.entries(phoneMappings).find(
                            ([_, val]) => val.client_id?.trim().toLowerCase() === selectedClient?.trim().toLowerCase() && val.industry?.trim().toLowerCase() === selectedIndustry?.trim().toLowerCase()
                          )?.[0]}
                          canManageVoiceLibrary={canManageVoiceLibrary}
                          canManageIntentLibrary={canManageIntentLibrary}
                        />
                      </div>
                    )}

                    {leftEditorTab === "config" && selectedType !== "client" && (
                      <div className="text-xs text-gray-500">Select a client to edit Client Config.</div>
                    )}

                    {leftEditorTab === "phone_routing" && canViewPhoneMappings && (
                      <div className="h-full min-h-0 overflow-y-auto border border-gray-700 rounded bg-gray-900/50">
                        <PhoneMappings
                          industries={list.industries}
                          clients={list.clients}
                          onSave={(data) => {
                            setPhoneMappingsContent(JSON.stringify(data, null, 2));
                          }}
                          readOnly={!canEditPhoneMappings}
                        />
                      </div>
                    )}
                  </div>
                )
              )}

              {activeTab === 'users' && canManageUsers && (
                <div className="p-8 max-w-4xl mx-auto">
                  <UserManagement />
                </div>
              )}
            </div>

            {showHistory && selectedType === 'client' && selectedIndustry && selectedClient && (
              <VersionHistory
                industry={selectedIndustry}
                client={selectedClient}
                canRevert={canRevertHistory}
                onRevert={() => {
                  loadConfig("client", selectedIndustry, selectedClient);
                  setMessage("Reverted to version successfully");
                }}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a configuration file to edit
          </div>
        )}
      </div>

      {/* Simple Modal */}
      {modalOpen && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`bg-gray-800 border border-gray-600 p-6 rounded shadow-xl ${modalType === "create_client" ? "w-[38rem] max-h-[85vh] overflow-y-auto" : "w-96"}`}>
            <h3 className="text-lg font-bold mb-4 text-white">
              {modalType === 'create_industry' && "New Industry"}
              {modalType === 'create_client' && "New Client"}
              {modalType === 'copy_client' && "Copy Client"}
            </h3>

            {modalType !== "create_client" && (
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white mb-4"
                placeholder="Enter name..."
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                autoFocus
              />
            )}

            {modalType === "create_client" && (
              <div className="space-y-3 mb-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Client ID</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      placeholder="e.g. acme_retail"
                      value={modalInput}
                      onChange={(e) => setModalInput(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Industry</label>
                    <select
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.industry}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, industry: e.target.value }))}
                    >
                      <option value="">Select industry...</option>
                      {(list?.industries || []).map((ind) => (
                        <option key={ind} value={ind}>{ind}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Initialization</label>
                  <select
                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                    value={createClientMode}
                    onChange={(e) => setCreateClientMode(e.target.value as CreateClientMode)}
                  >
                    <option value="industry_template">Use industry template</option>
                    <option value="blank">Start blank client (first_response only)</option>
                  </select>
                </div>
                {createClientMode === "industry_template" && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Template Source</label>
                    <select
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={createClientTemplateSource}
                      onChange={(e) => setCreateClientTemplateSource(e.target.value)}
                    >
                      <option value="">Industry defaults</option>
                      {((list?.clients?.[newClientDraft.industry] || []) as string[]).map((clientId) => (
                        <option key={clientId} value={clientId}>
                          Client template: {clientId}
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] text-gray-500 mt-1">
                      Choose an existing client to clone structure from, or leave as Industry defaults.
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Brand Name</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.brand_name}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, brand_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Assistant Name</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.assistant_name}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, assistant_name: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Agent Name</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.agent_name}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, agent_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Language</label>
                    <select
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.language}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, language: e.target.value }))}
                    >
                      {!LANGUAGE_OPTIONS.some((language) => language.locale === newClientDraft.language) && (
                        <option value={newClientDraft.language}>{newClientDraft.language}</option>
                      )}
                      {LANGUAGE_OPTIONS.map((language) => (
                        <option key={language.locale} value={language.locale}>
                          {language.label} ({language.locale})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Brand Phone</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.brand_phone}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, brand_phone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Opening Hours</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.opening_hours}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, opening_hours: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Tone</label>
                  <input
                    type="text"
                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                    value={newClientDraft.tone}
                    onChange={(e) => setNewClientDraft((prev) => ({ ...prev, tone: e.target.value }))}
                    placeholder="friendly, concise, helpful"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Intents (comma separated)</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.intents_csv}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, intents_csv: e.target.value }))}
                      placeholder="sales, warranty, returns, refunds"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Default Intent</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.default_intent}
                      onChange={(e) => setNewClientDraft((prev) => ({ ...prev, default_intent: e.target.value }))}
                      placeholder="first_response"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">TTS Provider</label>
                    <select
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                      value={newClientDraft.tts_provider}
                      onChange={(e) => setNewClientDraft((prev) => ({
                        ...prev,
                        tts_provider: e.target.value as NewClientDraft["tts_provider"],
                        elevenlabs_voice_id: e.target.value === "elevenlabs" ? prev.elevenlabs_voice_id : "",
                        azure_voice_name: e.target.value === "azure_neural" ? prev.azure_voice_name : "",
                      }))}
                    >
                      <option value="">Use system default</option>
                      <option value="elevenlabs">ElevenLabs</option>
                      <option value="azure_neural">Azure Neural</option>
                    </select>
                  </div>
                  {newClientDraft.tts_provider === "elevenlabs" && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">ElevenLabs Voice</label>
                      <select
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                        value={newClientDraft.elevenlabs_voice_id}
                        onChange={(e) => setNewClientDraft((prev) => ({ ...prev, elevenlabs_voice_id: e.target.value }))}
                      >
                        <option value="">Select ElevenLabs voice...</option>
                        {createClientVoices
                          .filter((v) => v.provider === "elevenlabs" && v.voice_id && isCreateVoiceApplicable(v))
                          .map((v) => (
                            <option key={v.voice_id} value={v.voice_id}>
                              {v.name || v.voice_id}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  {newClientDraft.tts_provider === "azure_neural" && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Azure Voice</label>
                      <select
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                        value={newClientDraft.azure_voice_name}
                        onChange={(e) => setNewClientDraft((prev) => ({ ...prev, azure_voice_name: e.target.value }))}
                      >
                        <option value="">Select Azure voice...</option>
                        {createClientVoices
                          .filter((v) => v.provider === "azure_neural" && v.voice_name && isCreateVoiceApplicable(v))
                          .map((v) => (
                            <option key={v.voice_name} value={v.voice_name}>
                              {v.name || v.voice_name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleModalSubmit} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {callTraceOpen && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 p-6 rounded shadow-xl w-[58rem] max-h-[88vh] overflow-hidden flex flex-col">
            <h3 className="text-lg font-bold mb-4 text-white">Call Trace</h3>
            <div className="text-xs text-gray-400 mb-3">
              Client: <span className="text-white">{selectedClient || "-"}</span> / Industry: <span className="text-white">{selectedIndustry || "-"}</span>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Showing newest events first.
              </div>
              <button
                onClick={fetchCallTraces}
                disabled={isLoadingCallTraces}
                className={`px-3 py-1.5 text-xs rounded border ${isLoadingCallTraces ? "border-gray-700 text-gray-500 cursor-not-allowed" : "border-gray-600 text-gray-300 hover:text-white hover:border-blue-500"}`}
              >
                {isLoadingCallTraces ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="flex-1 min-h-0 rounded border border-gray-700 bg-gray-900/60 p-2 overflow-y-auto">
              {callTraceError && <div className="text-sm text-red-400">{callTraceError}</div>}
              {!callTraceError && isLoadingCallTraces && (
                <div className="text-xs text-gray-500">Loading traces...</div>
              )}
              {!callTraceError && !isLoadingCallTraces && callTraces.length === 0 && (
                <div className="text-xs text-gray-500">No traces found for this client yet.</div>
              )}
              {!callTraceError && !isLoadingCallTraces && callTraces.length > 0 && (
                <div className="space-y-2">
                  {callTraces.map((row, idx) => {
                    const tsNum = Number(row.ts || 0);
                    const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
                    return (
                      <div key={`${row.session_id || "trace"}-${idx}`} className="rounded border border-gray-700 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-amber-300">{row.event || "event"}</span>
                          <span className="text-gray-500">{tsMs > 0 ? new Date(tsMs).toLocaleString() : "-"}</span>
                        </div>
                        <div className="mt-1 text-gray-300">
                          session: {row.session_id || "-"} | intent: {row.previous_intent || "-"} → {row.intent || "-"} | node: {row.previous_node_id || "-"} → {row.current_node_id || "-"}
                        </div>
                        {row.input_text && <div className="mt-1 text-gray-400">in: {String(row.input_text)}</div>}
                        {row.output_text && <div className="mt-1 text-gray-400">out: {String(row.output_text)}</div>}
                        {row.error && <div className="mt-1 text-red-400">error: {String(row.error)}</div>}
                        <div className="mt-1 text-gray-500">
                          handoff: {row.handoff ? "yes" : "no"} | latency: {row.latency_ms ?? "-"} ms
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setCallTraceOpen(false)}
                className="px-4 py-2 text-gray-400 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {testCallOpen && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 p-6 rounded shadow-xl w-[32rem]">
            <h3 className="text-lg font-bold mb-4 text-white">Start Test Call</h3>
            <div className="space-y-3">
              <div className="text-xs text-gray-400">
                Client: <span className="text-white">{selectedClient || "-"}</span> / Industry: <span className="text-white">{selectedIndustry || "-"}</span>
              </div>
              <div className="text-xs text-gray-400">
                Workflow: <span className="text-white">{selectedWorkflowKey || "first_response"}</span>
              </div>
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                placeholder="To number (e.g. +447xxxxxxxxx)"
                value={testCallTo}
                onChange={(e) => setTestCallTo(e.target.value)}
              />
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                placeholder="From number (Twilio number)"
                value={testCallFrom}
                onChange={(e) => setTestCallFrom(e.target.value)}
              />
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                placeholder="Voice webhook base URL (e.g. https://app-voice-agent.example.com)"
                value={testCallWebhookBaseUrl}
                onChange={(e) => setTestCallWebhookBaseUrl(e.target.value)}
              />
              <div className="text-[11px] text-gray-500">
                This will place a real Twilio outbound call and force routing to the selected workflow.
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setTestCallOpen(false)}
                className="px-4 py-2 text-gray-400 hover:text-white"
                disabled={isStartingTestCall}
              >
                Cancel
              </button>
              <button
                onClick={startTestCall}
                disabled={isStartingTestCall}
                className={`px-4 py-2 rounded text-white ${isStartingTestCall ? "bg-gray-700 cursor-not-allowed" : "bg-teal-600 hover:bg-teal-500"}`}
              >
                {isStartingTestCall ? "Starting..." : "Start Call"}
              </button>
            </div>
          </div>
        </div>
      )}

      {simulateCallOpen && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 p-6 rounded shadow-xl w-[36rem] max-h-[85vh] overflow-hidden flex flex-col">
            <h3 className="text-lg font-bold mb-4 text-white">Simulate Call (Browser Mic)</h3>
            <div className="space-y-3">
              <div className="text-xs text-gray-400">
                Client: <span className="text-white">{selectedClient || "-"}</span> / Industry: <span className="text-white">{selectedIndustry || "-"}</span>
              </div>
              <div className="text-xs text-gray-400">
                Workflow: <span className="text-white">{selectedWorkflowKey || "first_response"}</span>
              </div>
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                placeholder="Voice webhook base URL (e.g. https://app-voice-agent.example.com)"
                value={testCallWebhookBaseUrl}
                onChange={(e) => setTestCallWebhookBaseUrl(e.target.value)}
                disabled={isSimulatingCall}
              />
              <div className="text-[11px] text-gray-500">
                Uses your microphone and routes directly to the selected workflow in test mode.
              </div>
            </div>

            <div className="mt-3 flex-1 min-h-0 rounded border border-gray-700 bg-gray-900/60 p-2 overflow-y-auto">
              {simCallLogs.length === 0 ? (
                <div className="text-xs text-gray-500">No simulation events yet.</div>
              ) : (
                <div className="space-y-1">
                  {simCallLogs.map((log, i) => (
                    <div key={`${log.ts}-${i}`} className="text-xs">
                      <span className="text-gray-500">[{log.ts}]</span>{" "}
                      <span className="text-gray-300">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  if (isSimulatingCall) stopSimulatedCall();
                  setSimulateCallOpen(false);
                }}
                className="px-4 py-2 text-gray-400 hover:text-white"
              >
                Close
              </button>
              {!isSimulatingCall ? (
                <button
                  onClick={startSimulatedCall}
                  className="px-4 py-2 rounded text-white bg-cyan-600 hover:bg-cyan-500"
                >
                  Start Simulation
                </button>
              ) : (
                <button
                  onClick={() => stopSimulatedCall()}
                  className="px-4 py-2 rounded text-white bg-red-600 hover:bg-red-500"
                >
                  Stop Simulation
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}


function isValidJson(str: string) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}
