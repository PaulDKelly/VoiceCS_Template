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

type NodePickerAction = {
  type: "prompt" | "action" | "condition" | "knowledge" | "handoff";
  nonce: number;
};
type LeftEditorTab = "none" | "prompts" | "config" | "json" | "phone_routing";

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

  useEffect(() => {
    if (status === "authenticated") {
      fetchList();
      fetchMe();
    }
  }, [status]);

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
    } catch (e) {
      console.error("Failed to load user profile", e);
    }
  }

  async function fetchList() {
    try {
      const [resList, resMappings] = await Promise.all([
        fetch("/api/config?type=list", { cache: "no-store" }),
        fetch("/api/config?type=phone_mappings&_t=" + Date.now(), { cache: "no-store" }) // Cache bust
      ]);
      const dataList = await resList.json();
      const dataMappings = resMappings.ok ? await resMappings.json() : { mappings: {} };

      setList(dataList);
      setPhoneMappings(dataMappings.mappings || {});
      setPhoneMappingsContent(JSON.stringify(dataMappings, null, 2));
    } catch (e) {
      console.error("Failed to load initial data", e);
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
    setModalOpen(true);
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
      payload.industry = modalData.industry;
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
      ? parsed.intents.filter((k: string) => k !== "general" && rules?.[k]?.enabled !== false)
      : [];
    const workflows: string[] = parsed?.workflows ? Object.keys(parsed.workflows).filter((k) => k !== "general") : [];
    const base: string[] = intents.length ? intents : workflows;
    return Array.from(new Set<string>(base));
  })();
  const filteredWorkflowKeys = workflowKeys.filter((k) => k.toLowerCase().includes(workflowFilter.trim().toLowerCase()));

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
    if (!list || !session || initialConfigLoaded) return;
    if (selectedIndustry || isLoadingConfig) return;

    let loaded = false;
    try {
      const saved = localStorage.getItem("dashboard:lastConfig");
      if (saved) {
        const [industry, client] = saved.split("::");
        if (industry && list.industries.includes(industry)) {
          if (client && (list.clients[industry] || []).includes(client)) {
            loadConfig("client", industry, client);
            loaded = true;
          } else {
            loadConfig("industry", industry);
            loaded = true;
          }
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
        loadConfig("industry", firstIndustry);
      }
    }
    setInitialConfigLoaded(true);
  }, [list, session, initialConfigLoaded, selectedIndustry, isLoadingConfig]);

  const toggleSection = (section: "context" | "workflows" | "picker") => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };
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
      <div className={`${isSidebarCompact ? "w-[15%] min-w-[190px]" : "w-[18.75%] min-w-[220px]"} bg-gray-800 border-r border-gray-700 overflow-y-auto flex flex-col transition-all duration-200`}>
        {/* User Header */}
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
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

        <div className="p-4 bg-gray-900 sticky top-0 border-b border-gray-700 flex justify-between items-center">
          <h1 className="text-xl font-bold text-blue-400">Configurations</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSidebarCompact((v) => !v)}
              className="text-gray-400 hover:text-white"
              title={isSidebarCompact ? "Expand sidebar" : "Compact sidebar"}
            >
              {isSidebarCompact ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            {isGlobalAdmin && (
              <button onClick={openCreateIndustry} className="text-green-400 hover:text-green-300" title="Add Industry">
                <Plus size={20} />
              </button>
            )}
          </div>
        </div>

        {list && (
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Client Picker</h3>
            <div className="space-y-2">
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
                value={pickerIndustry}
                onChange={(e) => {
                  const nextIndustry = e.target.value;
                  setPickerIndustry(nextIndustry);
                  setPickerClientKey("");
                  setPickerClientSearch("");
                  if (nextIndustry) {
                    loadConfig("industry", nextIndustry);
                  }
                }}
              >
                <option value="">Select industry...</option>
                {list.industries.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </select>

              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
                placeholder={pickerIndustry ? "Search clients..." : "Search clients or industries..."}
                value={pickerClientSearch}
                onChange={(e) => setPickerClientSearch(e.target.value)}
              />

              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white disabled:opacity-50"
                value={pickerClientKey}
                onChange={(e) => {
                  const nextKey = e.target.value;
                  setPickerClientKey(nextKey);
                  if (!nextKey) {
                    if (pickerIndustry) loadConfig("industry", pickerIndustry);
                    return;
                  }
                  const [industry, client] = nextKey.split("::");
                  setPickerIndustry(industry || "");
                  if (industry && client) loadConfig("client", industry, client);
                }}
              >
                <option value="">Industry defaults...</option>
                {(
                  pickerIndustry
                    ? (list.clients[pickerIndustry] || []).map((cli) => ({ industry: pickerIndustry, client: cli }))
                    : Object.entries(list.clients).flatMap(([industry, clients]) =>
                      (clients || []).map((client) => ({ industry, client }))
                    )
                ).filter(({ industry, client }) => {
                  const q = pickerClientSearch.trim().toLowerCase();
                  if (!q) return true;
                  const clientMatch = client.toLowerCase().includes(q);
                  const industryMatch = industry.toLowerCase().includes(q);
                  return pickerIndustry ? clientMatch : (clientMatch || industryMatch);
                }).map(({ industry, client }) => {
                  const key = `${industry}::${client}`;
                  return (
                    <option key={key} value={key}>
                      {pickerIndustry ? client : `${client} / ${industry}`}
                    </option>
                  );
                })}
                {(
                  (
                    pickerIndustry
                      ? (list.clients[pickerIndustry] || []).map((cli) => ({ industry: pickerIndustry, client: cli }))
                      : Object.entries(list.clients).flatMap(([industry, clients]) =>
                        (clients || []).map((client) => ({ industry, client }))
                      )
                  ).filter(({ industry, client }) => {
                    const q = pickerClientSearch.trim().toLowerCase();
                    if (!q) return true;
                    const clientMatch = client.toLowerCase().includes(q);
                    const industryMatch = industry.toLowerCase().includes(q);
                    return pickerIndustry ? clientMatch : (clientMatch || industryMatch);
                  }).length === 0
                ) && (
                    <option value="" disabled>No matching clients</option>
                  )}
              </select>
              {isAdmin && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const industryForCreate = pickerIndustry || selectedIndustry;
                      if (!industryForCreate) {
                        alert("Select an industry first.");
                        return;
                      }
                      openCreateClient(industryForCreate);
                    }}
                    className="px-2 py-1.5 text-xs rounded border border-gray-600 text-gray-300 hover:text-white hover:border-blue-500"
                    title="Create a new client in selected industry"
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

        {(selectedIndustry || selectedClient || canViewPhoneMappings) && (
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Left Panel Tabs</h3>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => {
                  setActiveTab("workflows");
                  setLeftEditorTab("none");
                }}
                className={`w-full text-left px-2 py-1.5 text-xs rounded transition ${leftEditorTab === "none" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
              >
                Workflow Only
              </button>
              <button
                onClick={() => {
                  setActiveTab("workflows");
                  setLeftEditorTab("prompts");
                }}
                className={`w-full text-left px-2 py-1.5 text-xs rounded transition ${leftEditorTab === "prompts" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
              >
                Prompt Library
              </button>
              {selectedType === "client" && (
                <button
                  onClick={() => {
                    setActiveTab("workflows");
                    setLeftEditorTab("config");
                  }}
                  className={`w-full text-left px-2 py-1.5 text-xs rounded transition ${leftEditorTab === "config" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
                >
                  Client Config
                </button>
              )}
              <button
                onClick={() => {
                  setActiveTab("workflows");
                  setLeftEditorTab("json");
                }}
                className={`w-full text-left px-2 py-1.5 text-xs rounded transition ${leftEditorTab === "json" ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
              >
                Raw JSON
              </button>
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
            <div className="h-16 flex items-center justify-between px-6 bg-gray-800 border-b border-gray-700">
              <div>
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
              </div>

              {selectedIndustry && (
                <div className="text-sm text-gray-400">
                  Active View: <span className="text-white">{leftTabLabel}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                {selectedType === 'client' && canViewHistory && (
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className={`flex items-center gap-2 px-3 py-2 text-sm rounded font-medium transition border ${showHistory ? "bg-blue-600 border-blue-500 text-white" : "border-gray-600 text-gray-400 hover:text-white"}`}
                  >
                    <History size={16} /> {showHistory ? "Hide History" : "History"}
                  </button>
                )}
                {selectedType === 'client' && canSave && (
                  <button
                    onClick={saveVariant}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded font-medium transition border border-gray-600 text-gray-300 hover:text-white"
                  >
                    Save Variant
                  </button>
                )}
                {selectedType === 'client' && canSave && (
                  <button
                    onClick={loadVariant}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded font-medium transition border border-gray-600 text-gray-300 hover:text-white"
                  >
                    Load Variant
                  </button>
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
          <div className="bg-gray-800 border border-gray-600 p-6 rounded shadow-xl w-96">
            <h3 className="text-lg font-bold mb-4 text-white">
              {modalType === 'create_industry' && "New Industry"}
              {modalType === 'create_client' && "New Client"}
              {modalType === 'copy_client' && "Copy Client"}
            </h3>

            <input
              type="text"
              className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white mb-4"
              placeholder="Enter name..."
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
              autoFocus
            />

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleModalSubmit} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded">Confirm</button>
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
