"use client";

import { useEffect, useRef, useState } from "react";
import { Folder, FileJson, Save, Plus, Phone, Trash2, History, LogOut, Settings } from "lucide-react";
import PromptEditor from "@/components/PromptEditor";
import WorkflowVisualizer from "@/components/WorkflowVisualizer";
import ClientConfigForm from "@/components/ClientConfigForm";
import PhoneMappings from "@/components/PhoneMappings";
import VersionHistory from "@/components/VersionHistory";
import UserManagement from "@/components/UserManagement";

import { signIn, signOut, useSession } from "next-auth/react";

type ConfigList = {
  industries: string[];
  clients: Record<string, string[]>;
};

export default function Home() {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<any | null>(null);

  const [list, setList] = useState<ConfigList | null>(null);
  const [phoneMappings, setPhoneMappings] = useState<Record<string, { client_id: string, industry: string }>>({});
  const [selectedType, setSelectedType] = useState<"industry" | "client" | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<"prompts" | "workflows" | "config" | "phone_mappings" | "json" | "users">("prompts");

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

  useEffect(() => {
    if (status === "authenticated") {
      fetchList();
      fetchMe();
    }
  }, [status]);

  async function fetchMe() {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
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

  if (status === "loading") {
    return <div className="flex items-center justify-center h-screen bg-gray-900 text-white">Loading session...</div>;
  }
  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <button
          onClick={() => signIn()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
        >
          Sign in
        </button>
      </div>
    );
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
    } catch (e) {
      console.error("Failed to load initial data", e);
    }
  }

  async function loadConfig(type: "industry" | "client", industry: string, client?: string) {
    if (activeTab === 'phone_mappings' || activeTab === 'users') {
      setActiveTab(type === "client" ? "config" : "prompts");
    }

    setSelectedType(type);
    setSelectedIndustry(industry);
    setSelectedClient(client || null);
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
    if (activeTab === 'phone_mappings') {
      try {
        const content = JSON.parse(editorContent);
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


  if (!list || !user) return <div className="p-10 bg-gray-900 text-white min-h-screen">Loading configuration...</div>;
  const permissions = user?.permissions || {};
  const isSuperAdmin = user.role === "admin" && (
    (user.allowed_industries || []).includes("*") || (user.allowed_clients || []).includes("*")
  );
  const canViewPhoneMappings = isSuperAdmin || permissions.can_view_phone_mappings;
  const canEditPhoneMappings = isSuperAdmin || permissions.can_edit_phone_mappings;
  const canEditClients = isSuperAdmin || permissions.can_edit_clients;
  const canEditIndustries = isSuperAdmin;
  const canManageUsers = isSuperAdmin || permissions.can_manage_users;
  const canManagePromptLibrary = isSuperAdmin || permissions.can_manage_prompt_library;
  const canManageIntentLibrary = isSuperAdmin || permissions.can_manage_prompt_library;
  // Voice library modifications are Admin-only (per product requirement), regardless of per-user flags.
  const canManageVoiceLibrary = user.role === "admin" && (isSuperAdmin || permissions.can_manage_voice_library);
  const canViewHistory = isSuperAdmin || permissions.can_view_history;
  const canRevertHistory = isSuperAdmin || permissions.can_revert_history;
  const canSave = (() => {
    if (activeTab === "phone_mappings") return canEditPhoneMappings;
    if (selectedType === "client") return canEditClients;
    if (selectedType === "industry") return canEditIndustries;
    return false;
  })();

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans relative">
      {/* Sidebar */}
      <div className="w-1/4 bg-gray-800 border-r border-gray-700 overflow-y-auto flex flex-col">
        {/* User Header */}
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-col">
              <span className="font-bold text-white">{user.name}</span>
              <span className="text-xs text-gray-400 capitalize">{user.role}</span>
            </div>
            <div className="flex items-center gap-2 relative">
              {canManageUsers && (
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
          {user.role === 'admin' && (
            <button onClick={openCreateIndustry} className="text-green-400 hover:text-green-300" title="Add Industry">
              <Plus size={20} />
            </button>
          )}
        </div>

        {canViewPhoneMappings && (
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Global Settings</h3>
            <button
              onClick={() => {
                setSelectedType(null);
                setSelectedIndustry(null);
                setActiveTab("phone_mappings");
              }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm rounded transition ${activeTab === "phone_mappings" ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
            >
              <Phone size={14} />
              Phone Routing
            </button>
          </div>
        )}

        <div className="p-2 flex-1">
          {list.industries.map((ind) => (
            <div key={ind} className="mb-4">
              <div className="flex justify-between items-center px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700 rounded cursor-pointer group">
                <div className="flex items-center gap-2" onClick={() => loadConfig("industry", ind)}>
                  <Folder size={16} className="text-yellow-500" />
                  {ind}
                </div>
                {user.role === 'admin' && (
                  <div className="flex items-center gap-1 group-hover:opacity-100 opacity-0 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); openCreateClient(ind); }}
                      className="text-gray-500 hover:text-green-400"
                      title="Add Client"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConfig("industry", ind); }}
                      className="text-gray-500 hover:text-red-400"
                      title="Delete Industry"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              <div className="ml-4 border-l-2 border-gray-700 pl-2 mt-1 space-y-1">
                {list.clients[ind]?.map((cli) => (
                  <div
                    key={cli}
                    className="flex justify-between items-center px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded cursor-pointer transition group"
                    onClick={() => loadConfig("client", ind, cli)}
                  >
                    <div className="flex items-center gap-2">
                      <FileJson size={14} className="text-blue-400" />
                      {cli}
                    </div>
                    {user.role === 'admin' && (
                      <div className="flex items-center gap-2 group-hover:opacity-100 opacity-0 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); openCopyClient(ind, cli); }}
                          className="text-gray-600 hover:text-blue-400"
                          title="Copy Client"
                        >
                          <span className="text-xs font-mono">CPY</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteConfig("client", ind, cli); }}
                          className="text-gray-600 hover:text-red-400"
                          title="Delete Client"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Editor */}
      <div className="flex-1 flex flex-col">
        {selectedIndustry || activeTab === 'phone_mappings' || activeTab === 'users' ? (
          <>
            <div className="h-16 flex items-center justify-between px-6 bg-gray-800 border-b border-gray-700">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {activeTab === 'phone_mappings' ? "Phone Number Routing" :
                    activeTab === 'users' ? "User Management" :
                      selectedType === 'industry' ? `${selectedIndustry} / defaults.json` :
                        selectedType === 'client' ? `${selectedIndustry} / ${selectedClient}.json` : "Dashboard"}
                </h2>
                {message && <span className={`text-sm ${message.includes('Error') || message.includes('Invalid') ? 'text-red-400' : 'text-green-400'}`}>{message}</span>}
                {!canSave && (selectedIndustry || activeTab === "phone_mappings") && (
                  <span className="text-xs text-yellow-400 block">Read-only access</span>
                )}
              </div>

              {selectedIndustry && (
                <div className="flex bg-gray-700 rounded p-1 gap-1">
                  <button
                    onClick={() => setActiveTab("prompts")}
                    className={`px-3 py-1 text-sm rounded transition ${activeTab === "prompts" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                  >
                    Prompts
                  </button>
                  <button
                    onClick={() => setActiveTab("workflows")}
                    className={`px-3 py-1 text-sm rounded transition ${activeTab === "workflows" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                  >
                    Workflows
                  </button>

                  {selectedType === "client" && (
                    <button
                      onClick={() => setActiveTab("config")}
                      className={`px-3 py-1 text-sm rounded transition ${activeTab === "config" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                    >
                      Client Config
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab("json")}
                    className={`px-3 py-1 text-sm rounded transition ${activeTab === "json" ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                  >
                    Raw JSON
                  </button>
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
              {activeTab === "json" && (
                <textarea
                  className="w-full h-full bg-gray-900 p-6 font-mono text-sm resize-none outline-none text-gray-300"
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  spellCheck={false}
                  readOnly={!canSave}
                />
              )}

              {activeTab === "prompts" && (
                <PromptEditor
                  jsonContent={isValidJson(editorContent) ? JSON.parse(editorContent) : {}}
                  onChange={(newJson) => setEditorContent(JSON.stringify(newJson, null, 2))}
                  canManagePromptLibrary={canManagePromptLibrary}
                />
              )}

              {activeTab === "workflows" && (
                <WorkflowVisualizer
                  key={`${selectedType}-${selectedIndustry}-${selectedClient}`}
                  jsonContent={isValidJson(editorContent) ? JSON.parse(editorContent) : {}}
                  onChange={(newJson) => setEditorContent(JSON.stringify(newJson, null, 2))}
                  onOpenPrompts={() => setActiveTab("prompts")}
                />
              )}

              {activeTab === "config" && selectedType === "client" && (
                <ClientConfigForm
                  key={`client-config-${selectedType}-${selectedIndustry}-${selectedClient}`}
                  jsonContent={isValidJson(editorContent) ? JSON.parse(editorContent) : {}}
                  onChange={(newJson) => setEditorContent(JSON.stringify(newJson, null, 2))}
                  assignedPhoneNumber={Object.entries(phoneMappings).find(
                    ([_, val]) => val.client_id?.trim().toLowerCase() === selectedClient?.trim().toLowerCase() && val.industry?.trim().toLowerCase() === selectedIndustry?.trim().toLowerCase()
                  )?.[0]}
                  canManageVoiceLibrary={canManageVoiceLibrary}
                  canManageIntentLibrary={canManageIntentLibrary}
                />
              )}

              {activeTab === "phone_mappings" && (
                <PhoneMappings
                  industries={list.industries}
                  clients={list.clients}
                  onSave={(data) => {
                    setEditorContent(JSON.stringify(data, null, 2));
                  }}
                  readOnly={!canEditPhoneMappings}
                />
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
