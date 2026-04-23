"use client";

import { useState, useEffect, useRef } from "react";

type ClientConfig = {
    client_id?: string;
    brand_name?: string;
    assistant_name?: string;
    agent_name?: string;
    opening_hours?: string;
    brand_phone?: string;
    tone?: string;
    voice_name?: string;
    tts_provider?: string;
    azure_voice_name?: string;
    azure_speech_region?: string;
    azure_ssml_lang?: string;
    azure_voice_style?: string;
    azure_voice_style_degree?: number;
    elevenlabs_voice_id?: string;
    language?: string;
    industry?: string;
    enable_caller_memory?: boolean;
    barge_in_threshold_ms?: number;
    whisper_target_number?: string;
    intents?: string[];
    workflows?: Record<string, any>;
    warranty_period_months?: number;
    enable_warranty?: boolean;
    enable_sales?: boolean;
    enable_service?: boolean;
    enable_finance?: boolean;
    booking_config?: {
        notification_email?: string;
        email_subject_prefix?: string;
    };
    warranty_completion?: {
        mode?: string;
        target_intent?: string;
        transition_message?: string;
    };
    workflow_behavior?: Record<string, {
        question_mode: string;
        max_follow_ups: number;
    }>;
    database_connections?: Record<string, {
        type?: string;
        host?: string;
        port?: number | string;
        database?: string;
        username?: string;
        password?: string;
        password_env?: string;
        connection_string?: string;
        sqlite_path?: string;
        sslmode?: string;
        sslrootcert?: string;
        sslcert?: string;
        sslkey?: string;
        supabase_url?: string;
        supabase_key?: string;
        supabase_key_env?: string;
    }>;
    knowledge_base_connections?: Record<string, {
        type?: string;
        endpoint?: string;
        endpoint_path?: string;
        index_name?: string;
        api_version?: string;
        api_key?: string;
        api_key_env?: string;
        supabase_url?: string;
        supabase_key?: string;
        supabase_key_env?: string;
        host?: string;
        port?: number | string;
        database?: string;
        username?: string;
        password?: string;
        password_env?: string;
        connection_string?: string;
        schema?: string;
        sslmode?: string;
        sslrootcert?: string;
        sslcert?: string;
        sslkey?: string;
        query_sql?: string;
        http_method?: string;
        body_template?: string;
        content_field?: string;
        title_field?: string;
    }>;
    [key: string]: any;
};

type Props = {
    jsonContent: ClientConfig;
    onChange: (newJson: any) => void;
    assignedPhoneNumber?: string;
    canManageVoiceLibrary?: boolean;
    canManageIntentLibrary?: boolean;
};

type VoiceEntry = {
    name: string;
    provider: "elevenlabs" | "azure_neural";
    voice_id?: string;
    voice_name?: string;
    locale?: string;
    gender?: string;
    default: boolean;
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

type IntentEntry = {
    name: string;
    label?: string;
    workflow_template?: any;
};

type WorkflowTemplateEntry = {
    key: string;
    label: string;
    workflow: any;
};

export default function ClientConfigForm({ jsonContent, onChange, assignedPhoneNumber, canManageVoiceLibrary, canManageIntentLibrary }: Props) {
    const [config, setConfig] = useState<ClientConfig>(jsonContent);
    const [industryDefaults, setIndustryDefaults] = useState<any>(null);
    const [ttsTestStatus, setTtsTestStatus] = useState<"idle" | "loading" | "playing">("idle");
    const [ttsTestError, setTtsTestError] = useState<string | null>(null);
    const [ttsTestText, setTtsTestText] = useState<string>("Hello, this is a short voice test for your assistant.");
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [whisperTestStatus, setWhisperTestStatus] = useState<"idle" | "loading" | "sent">("idle");
    const [whisperTestError, setWhisperTestError] = useState<string | null>(null);
    const [voiceLibrary, setVoiceLibrary] = useState<VoiceEntry[]>([]);
    const [voiceLibraryError, setVoiceLibraryError] = useState<string | null>(null);
    const [intentLibrary, setIntentLibrary] = useState<IntentEntry[]>([]);
    const [intentLibraryError, setIntentLibraryError] = useState<string | null>(null);
    const [globalTemplateMap, setGlobalTemplateMap] = useState<Record<string, any>>({});
    const [selectedLibraryIntent, setSelectedLibraryIntent] = useState<string>("");
    const [newIntentName, setNewIntentName] = useState<string>("");
    const [newIntentLabel, setNewIntentLabel] = useState<string>("");
    const autoMigratedFirstResponseRef = useRef(false);
    const [dbTestStatus, setDbTestStatus] = useState<Record<string, "idle" | "loading" | "ok" | "error">>({});
    const [dbTestMessage, setDbTestMessage] = useState<Record<string, string>>({});
    const [kbTestStatus, setKbTestStatus] = useState<Record<string, "idle" | "loading" | "ok" | "error">>({});
    const [kbTestMessage, setKbTestMessage] = useState<Record<string, string>>({});
    const [importingProvider, setImportingProvider] = useState<"" | "azure" | "elevenlabs">("");
    const [newVoice, setNewVoice] = useState<VoiceEntry>({
        name: "",
        provider: "elevenlabs",
        voice_id: "",
        voice_name: "",
        locale: "",
        default: false
    });

    useEffect(() => {
        setConfig(jsonContent);
    }, [jsonContent]);

    function normalizeTtsProvider(p?: string): "elevenlabs" | "azure_neural" {
        const v = String(p || "").trim().toLowerCase();
        if (v === "azure_neural") return "azure_neural";
        if (v === "azure" || v === "azure_tts") return "azure_neural";
        return "elevenlabs";
    }

    function getVoiceDisplay(v: VoiceEntry): string {
        if (v.provider === "elevenlabs") {
            const id = v.voice_id || "";
            const label = (v.name || "").trim();
            if (label && id && label !== id) return `${label} (${id})`;
            return id || label;
        }
        const label = v.name || v.voice_name || "";
        const locale = getVoiceLocale(v);
        return locale ? `${label} (${locale})` : label;
    }

    function getVoiceLocale(v: VoiceEntry): string {
        if (v.locale) return v.locale;
        const source = v.voice_name || "";
        const match = source.match(/^([a-z]{2,3}-[A-Z]{2,4})-/);
        return match ? match[1] : "";
    }

    function getSelectedLanguage(): string {
        return (config.language || "en-GB").trim() || "en-GB";
    }

    function getAvailableVoices(provider: "elevenlabs" | "azure_neural", language = getSelectedLanguage()): VoiceEntry[] {
        const selectedLanguage = language.toLowerCase();
        return voiceLibrary.filter((v) => {
            if (v.provider !== provider) return false;
            const locale = getVoiceLocale(v).toLowerCase();
            return !locale || locale === selectedLanguage;
        });
    }

    function selectBestVoice(provider: "elevenlabs" | "azure_neural", language: string): VoiceEntry | null {
        const available = getAvailableVoices(provider, language);
        return available.find((v) => v.default) || available[0] || null;
    }

    function applyVoiceSelection(nextConfig: ClientConfig, provider: "elevenlabs" | "azure_neural", language: string): ClientConfig {
        if (voiceLibrary.length === 0) return nextConfig;
        const available = getAvailableVoices(provider, language);
        if (provider === "elevenlabs") {
            const current = nextConfig.elevenlabs_voice_id || "";
            if (!current || !available.some((v) => v.voice_id === current)) {
                const selected = selectBestVoice(provider, language);
                return {
                    ...nextConfig,
                    elevenlabs_voice_id: selected?.voice_id || "",
                };
            }
            return nextConfig;
        }

        const current = nextConfig.azure_voice_name || "";
        if (!current || !available.some((v) => v.voice_name === current)) {
            const selected = selectBestVoice(provider, language);
            return {
                ...nextConfig,
                azure_voice_name: selected?.voice_name || "",
                voice_name: selected?.voice_name || nextConfig.voice_name || "",
            };
        }
        return nextConfig;
    }

    function handleLanguageChange(language: string) {
        const provider = normalizeTtsProvider(config.tts_provider);
        const newConfig = applyVoiceSelection({
            ...config,
            language,
            azure_ssml_lang: language,
        }, provider, language);
        setConfig(newConfig);
        onChange(newConfig);
    }

    function handleTtsProviderChange(provider: "elevenlabs" | "azure_neural") {
        const language = getSelectedLanguage();
        const newConfig = applyVoiceSelection({
            ...config,
            tts_provider: provider,
        }, provider, language);
        setConfig(newConfig);
        onChange(newConfig);
    }

    const saveVoiceLibrary = async (nextVoices: VoiceEntry[]) => {
        const res = await fetch("/api/config", {
            method: "POST",
            body: JSON.stringify({ action: "save", type: "voice_library", content: { voices: nextVoices } })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            setVoiceLibraryError(err?.error || "Failed to save voice library.");
            return false;
        }
        setVoiceLibrary(nextVoices);
        setVoiceLibraryError(null);
        return true;
    };

    const importVoices = async (provider: "azure" | "elevenlabs") => {
        try {
            setImportingProvider(provider);
            setVoiceLibraryError(null);
            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "import_voices",
                    type: "voice_library",
                    provider: provider === "azure" ? "azure_neural" : provider,
                    locale: provider === "azure" ? getSelectedLanguage() : undefined,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setVoiceLibraryError(data?.error || "Failed to import voices.");
                return;
            }
            const normalized = ((data?.voices || []) as VoiceEntry[]).map(v => ({ ...v, default: !!v.default }));
            setVoiceLibrary(normalized);
            if (data?.fallback) {
                setVoiceLibraryError("Azure Speech is not configured locally, so sample Azure voices were imported for dropdown testing. Add AZURE_SPEECH_KEY to test audio.");
            }
        } catch (err) {
            setVoiceLibraryError("Failed to import voices.");
        } finally {
            setImportingProvider("");
        }
    };

    // Load industry defaults to get workflow templates
    useEffect(() => {
        const loadIndustryDefaults = async () => {
            const industry = jsonContent.industry;
            if (!industry) return;

            try {
                const res = await fetch(`/api/config?action=load&type=industry&industry=${industry}`);
                if (res.ok) {
                    const data = await res.json();
                    setIndustryDefaults(data);
                    console.log('[Industry Defaults Loaded]', data);

                    const baseConfig = jsonContent;
                    if (!baseConfig || Object.keys(baseConfig).length === 0) return;

                    // Migration: Ensure first_response is always in the intents list
                    if (!baseConfig.intents?.includes('first_response')) {
                        console.log('[Migrating] Adding first_response to intents');
                        const updatedIntents = ['first_response', ...(baseConfig.intents || [])];
                        const newConfig = { ...baseConfig, intents: updatedIntents };

                        // Also auto-create workflow if missing
                        if (!newConfig.workflows?.first_response && data.workflows?.first_response) {
                            newConfig.workflows = {
                                ...(newConfig.workflows || {}),
                                first_response: data.workflows.first_response
                            };
                        }

                        setConfig(newConfig);
                        onChange(newConfig);
                    }
                }
            } catch (e) {
                console.error('[Failed to load industry defaults]', e);
            }
        };

        loadIndustryDefaults();
    }, [jsonContent.industry, jsonContent.intents, jsonContent.workflows]);

    useEffect(() => {
        const load = async () => {
            try {
                setVoiceLibraryError(null);
                const res = await fetch(`/api/config?type=voice_library&_t=${Date.now()}`);
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    const msg = (data && typeof data.error === "string" && data.error) ? data.error : `HTTP ${res.status}`;
                    setVoiceLibraryError(`Failed to load voice library: ${msg}`);
                    setVoiceLibrary([]);
                    return;
                }
                const normalized = ((data && data.voices) || []).map((v: any) => ({
                    ...v,
                    default: !!v.default,
                })) as VoiceEntry[];
                setVoiceLibrary(normalized);
            } catch (err) {
                console.error("Failed to load voice library", err);
                setVoiceLibraryError("Failed to load voice library");
                setVoiceLibrary([]);
            }
        };
        load();
    }, []);

    const normalizeIntentLibrary = (raw: any): IntentEntry[] => {
        const source = Array.isArray(raw?.intents) ? raw.intents : [];
        return source
            .map((entry: any) => {
                if (typeof entry === "string") {
                    const name = normalizeIntentName(entry);
                    if (name === "general") return null;
                    return { name, label: name };
                }
                if (entry && typeof entry === "object") {
                    const name = normalizeIntentName(String(entry.name || ""));
                    if (!name || name === "general") return null;
                    return {
                        name,
                        label: String(entry.label || "").trim() || name,
                        workflow_template: entry.workflow_template
                    };
                }
                return null;
            })
            .filter((x: IntentEntry | null): x is IntentEntry => !!x);
    };

    const toIntentLabel = (name: string): string =>
        name
            .replace(/_/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase());

    const mergeKnownIntents = (base: IntentEntry[]): IntentEntry[] => {
        const known = new Set<string>();
        (config.intents || []).forEach((i) => { if (i !== "general") known.add(i); });
        Object.keys(config.workflows || {}).forEach((i) => { if (i !== "general") known.add(i); });
        (industryDefaults?.intents || []).forEach((i: string) => { if (i !== "general") known.add(i); });
        Object.keys(industryDefaults?.workflows || {}).forEach((i) => { if (i !== "general") known.add(i); });
        Object.keys(globalTemplateMap || {}).forEach((i) => { if (i !== "general") known.add(i); });

        const map = new Map<string, IntentEntry>();
        base.forEach((entry) => map.set(entry.name, entry));
        Array.from(known).forEach((name) => {
            const intentName = normalizeIntentName(String(name));
            if (!intentName) return;
            if (!map.has(intentName)) {
                map.set(intentName, {
                    name: intentName,
                    label: toIntentLabel(intentName),
                    workflow_template: industryDefaults?.workflows?.[intentName] || globalTemplateMap?.[intentName]
                });
            }
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    };

    const loadGlobalWorkflowTemplates = async () => {
        try {
            const res = await fetch(`/api/config?type=workflow_templates&_t=${Date.now()}`);
            const data = await res.json().catch(() => null);
            if (!res.ok) return;
            const templates = Array.isArray(data?.templates) ? (data.templates as WorkflowTemplateEntry[]) : [];
            const nextMap: Record<string, any> = {};
            for (const tpl of templates) {
                const keyPart = String(tpl?.key || "").split(":").pop() || "";
                const name = normalizeIntentName(keyPart || tpl?.label || "");
                if (!name || name === "general") continue;
                if (!nextMap[name]) nextMap[name] = cloneTemplate(tpl.workflow);
            }
            setGlobalTemplateMap(nextMap);
        } catch {
            // ignore
        }
    };

    const loadIntentLibrary = async () => {
        try {
            setIntentLibraryError(null);
            const res = await fetch(`/api/config?type=intent_library&_t=${Date.now()}`);
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const msg = (data && typeof data.error === "string" && data.error) ? data.error : `HTTP ${res.status}`;
                setIntentLibraryError(`Failed to load intent library: ${msg}`);
                setIntentLibrary([]);
                return;
            }
            setIntentLibrary(mergeKnownIntents(normalizeIntentLibrary(data)));
        } catch (err) {
            console.error("Failed to load intent library", err);
            setIntentLibraryError("Failed to load intent library");
            setIntentLibrary(mergeKnownIntents([]));
        }
    };

    const saveIntentLibrary = async (nextIntents: IntentEntry[]) => {
        const res = await fetch("/api/config", {
            method: "POST",
            body: JSON.stringify({ action: "save", type: "intent_library", content: { intents: nextIntents } })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            setIntentLibraryError(err?.error || "Failed to save intent library.");
            return false;
        }
        setIntentLibrary(nextIntents);
        setIntentLibraryError(null);
        return true;
    };

    useEffect(() => {
        loadIntentLibrary();
        loadGlobalWorkflowTemplates();
    }, []);

    useEffect(() => {
        setIntentLibrary((prev) => mergeKnownIntents(prev));
    }, [industryDefaults, config.intents, config.workflows, globalTemplateMap]);


    const handleChange = (field: string, value: any) => {
        const newConfig = { ...config, [field]: value };
        setConfig(newConfig);
        onChange(newConfig);
    };

    const handleNestedChange = (parent: string, field: string, value: any) => {
        const newConfig = {
            ...config,
            [parent]: {
                ...(config[parent] as any),
                [field]: value,
            },
        };
        setConfig(newConfig);
        onChange(newConfig);
    };

    const handleIntentsChange = (value: string) => {
        const intents = value.split(",").map((i) => i.trim()).filter(Boolean);
        handleChange("intents", intents);
    };

    const isIntentEnabled = (intent: string) => {
        const intents = config.intents || [];
        if (!intents.includes(intent)) return false;
        const rules = config.intent_routing_rules || {};
        if (rules[intent]?.enabled === false) return false;
        const legacyFlag = (config as any)[`enable_${intent}`];
        if (legacyFlag === false) return false;
        return true;
    };

    const normalizeIntentName = (raw: string): string =>
        raw.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

    const cloneTemplate = (value: any) => {
        if (value === undefined || value === null) return undefined;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return value;
        }
    };

    const collectPromptKeysFromWorkflow = (workflow: any): string[] => {
        const out = new Set<string>();
        const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
        nodes.forEach((node: any) => {
            const k1 = String(node?.data?.promptKey || "").trim();
            const k2 = String(node?.data?.promptKeyWithName || "").trim();
            if (k1) out.add(k1);
            if (k2) out.add(k2);
        });
        return Array.from(out);
    };

    const isFallbackFirstResponse = (workflow: any) => {
        const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
        const edges = Array.isArray(workflow?.edges) ? workflow.edges : [];
        if (nodes.length !== 1 || edges.length !== 0) return false;
        const label = String(nodes[0]?.data?.label || "").toLowerCase();
        return label.includes("start first response");
    };

    const addIntentToClient = (rawIntent: string, workflowTemplate?: any) => {
        const intentName = normalizeIntentName(rawIntent);
        if (!intentName) {
            alert("Please enter a valid intent name.");
            return false;
        }
        if (intentName === "general") {
            alert('The "general" workflow intent is disabled. Keep general prompts in Prompt Library.');
            return false;
        }
        if (config.intents?.includes(intentName)) {
            alert(`Intent "${intentName}" already exists.`);
            return false;
        }

        const nextConfig = { ...config };
        nextConfig.intents = [...(config.intents || []), intentName];

        const nextRules = { ...(config.intent_routing_rules || {}) };
        nextRules[intentName] = { keywords: [], enabled: true };
        nextConfig.intent_routing_rules = nextRules;

        const nextWorkflows = { ...(config.workflows || {}) };
        if (!nextWorkflows[intentName]) {
            nextWorkflows[intentName] = createWorkflowTemplate(intentName, workflowTemplate);
        }
        nextConfig.workflows = nextWorkflows;

        const intentPrompts = mergePromptsFromIndustry(intentName);
        if (Object.keys(intentPrompts).length > 0) {
            nextConfig.prompts = { ...(config.prompts || {}), ...intentPrompts };
        }

        setConfig(nextConfig);
        onChange(nextConfig);
        return true;
    };

    useEffect(() => {
        if (autoMigratedFirstResponseRef.current) return;
        const frLibrary = intentLibrary.find((entry) => entry.name === "first_response" && !!entry.workflow_template);
        if (!frLibrary?.workflow_template) return;
        const existing = config?.workflows?.first_response;
        if (!existing || !isFallbackFirstResponse(existing)) return;

        const nextConfig = { ...config };
        nextConfig.workflows = { ...(config.workflows || {}), first_response: cloneTemplate(frLibrary.workflow_template) };

        const nextPrompts = { ...(config.prompts || {}) };
        const templatePromptKeys = collectPromptKeysFromWorkflow(frLibrary.workflow_template);
        templatePromptKeys.forEach((key) => {
            if (!nextPrompts[key]) {
                nextPrompts[key] = industryDefaults?.prompts?.[key] || "...";
            }
        });
        nextConfig.prompts = nextPrompts;

        autoMigratedFirstResponseRef.current = true;
        setConfig(nextConfig);
        onChange(nextConfig);
    }, [intentLibrary, config, industryDefaults, onChange]);

    const runTtsTest = async () => {
        setTtsTestError(null);
        setTtsTestStatus("loading");

        try {
            const provider = normalizeTtsProvider(config.tts_provider);
            const res = await fetch("/api/tts/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    voiceId: config.elevenlabs_voice_id || "",
                    azureVoiceName: config.azure_voice_name || "",
                    azureRegion: config.azure_speech_region || "",
                    azureLang: config.azure_ssml_lang || config.language || "",
                    azureStyle: config.azure_voice_style || "",
                    azureStyleDegree: config.azure_voice_style_degree,
                    text: ttsTestText,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || "TTS test failed");
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = "";
            }

            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onended = () => {
                setTtsTestStatus("idle");
                URL.revokeObjectURL(url);
            };

            setTtsTestStatus("playing");
            await audio.play();
        } catch (err: any) {
            setTtsTestStatus("idle");
            setTtsTestError(err?.message || "TTS test failed");
        }
    };

    const runWhisperTest = async () => {
        setWhisperTestError(null);
        setWhisperTestStatus("loading");

        try {
            const to = config.whisper_target_number || "";
            const from = assignedPhoneNumber || "";
            if (!to || !from) {
                throw new Error("Whisper target number and assigned phone number are required.");
            }

            const res = await fetch("/api/whisper/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    to,
                    from,
                    message: `Whisper test for ${config.brand_name || "client"}.`,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || "Whisper test failed");
            }

            setWhisperTestStatus("sent");
            setTimeout(() => setWhisperTestStatus("idle"), 2000);
        } catch (err: any) {
            setWhisperTestStatus("idle");
            setWhisperTestError(err?.message || "Whisper test failed");
        }
    };

    const runDatabaseConnectionTest = async (connKey: string, conn: any) => {
        setDbTestStatus((prev) => ({ ...prev, [connKey]: "loading" }));
        setDbTestMessage((prev) => ({ ...prev, [connKey]: "" }));
        try {
            const res = await fetch("/api/database/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ connection: conn }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                setDbTestStatus((prev) => ({ ...prev, [connKey]: "error" }));
                setDbTestMessage((prev) => ({ ...prev, [connKey]: data?.error || "Connection test failed." }));
                return;
            }
            setDbTestStatus((prev) => ({ ...prev, [connKey]: "ok" }));
            setDbTestMessage((prev) => ({ ...prev, [connKey]: data?.message || "Connection successful." }));
        } catch (err: any) {
            setDbTestStatus((prev) => ({ ...prev, [connKey]: "error" }));
            setDbTestMessage((prev) => ({ ...prev, [connKey]: err?.message || "Connection test failed." }));
        }
    };

    const runKnowledgeBaseConnectionTest = async (connKey: string, conn: any) => {
        setKbTestStatus((prev) => ({ ...prev, [connKey]: "loading" }));
        setKbTestMessage((prev) => ({ ...prev, [connKey]: "" }));
        try {
            const res = await fetch("/api/knowledgebase/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ connection: conn }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                setKbTestStatus((prev) => ({ ...prev, [connKey]: "error" }));
                setKbTestMessage((prev) => ({ ...prev, [connKey]: data?.error || "Knowledge base connection test failed." }));
                return;
            }
            setKbTestStatus((prev) => ({ ...prev, [connKey]: "ok" }));
            setKbTestMessage((prev) => ({ ...prev, [connKey]: data?.message || "Knowledge base connection is reachable." }));
        } catch (err: any) {
            setKbTestStatus((prev) => ({ ...prev, [connKey]: "error" }));
            setKbTestMessage((prev) => ({ ...prev, [connKey]: err?.message || "Knowledge base connection test failed." }));
        }
    };

    // Helper: Create a workflow template from industry defaults or basic fallback
    const createWorkflowTemplate = (intent: string, preferredTemplate?: any) => {
        if (preferredTemplate) {
            console.log(`[Using intent library template for ${intent}]`);
            return cloneTemplate(preferredTemplate);
        }

        // Try to get from industry defaults first
        if (industryDefaults?.workflows?.[intent]) {
            console.log(`[Using industry template for ${intent}]`);
            return cloneTemplate(industryDefaults.workflows[intent]);
        }

        // Try global library templates
        if (globalTemplateMap?.[intent]) {
            console.log(`[Using global template for ${intent}]`);
            return cloneTemplate(globalTemplateMap[intent]);
        }

        // Fallback to basic template
        console.log(`[Using basic template for ${intent}]`);
        return {
            nodes: [
                {
                    id: "start",
                    type: "default",
                    data: {
                        label: `${intent.charAt(0).toUpperCase() + intent.slice(1)} Start`,
                        promptKey: `${intent}_start`
                    },
                    position: { x: 250, y: 0 }
                }
            ],
            edges: []
        };
    };

    // Helper: Merge prompts from industry defaults
    const mergePromptsFromIndustry = (intent: string) => {
        if (!industryDefaults?.prompts) return {};

        // Get all prompts that start with the intent name
        const intentPrompts: any = {};
        Object.keys(industryDefaults.prompts).forEach(key => {
            if (key.startsWith(intent + '_') || key === intent) {
                intentPrompts[key] = industryDefaults.prompts[key];
            }
        });

        return intentPrompts;
    };

    const visibleIntents = (config.intents || []).filter((intent) => intent !== "general");

    return (
        <div className="h-full overflow-y-auto bg-gray-900 p-6">
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Basic Information */}
                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Basic Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Client ID</label>
                            <input
                                type="text"
                                value={config.client_id || ""}
                                onChange={(e) => handleChange("client_id", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Brand Name</label>
                            <input
                                type="text"
                                value={config.brand_name || ""}
                                onChange={(e) => handleChange("brand_name", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Assistant Name</label>
                            <input
                                type="text"
                                value={config.assistant_name || ""}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    const newConfig = { ...config, assistant_name: value, agent_name: value };
                                    setConfig(newConfig);
                                    onChange(newConfig);
                                }}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">
                                This is used for {`{assistant}`} prompts. We also mirror it to {`agent_name`} for legacy configs.
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Twilio Number (Read-only)</label>
                            <div className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-blue-400 font-mono">
                                {assignedPhoneNumber || "Not Assigned"}
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Industry</label>
                            <input
                                type="text"
                                value={config.industry || ""}
                                onChange={(e) => handleChange("industry", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Language</label>
                            <select
                                value={getSelectedLanguage()}
                                onChange={(e) => handleLanguageChange(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            >
                                {!LANGUAGE_OPTIONS.some((language) => language.locale === getSelectedLanguage()) && (
                                    <option value={getSelectedLanguage()}>{getSelectedLanguage()}</option>
                                )}
                                {LANGUAGE_OPTIONS.map((language) => (
                                    <option key={language.locale} value={language.locale}>
                                        {language.label} ({language.locale})
                                    </option>
                                ))}
                            </select>
                            <p className="text-[10px] text-gray-500 mt-1">
                                Used for speech recognition and Azure SSML. Import Azure voices after changing this.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Contact Information */}
                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Contact Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Brand Phone</label>
                            <input
                                type="text"
                                value={config.brand_phone || ""}
                                onChange={(e) => handleChange("brand_phone", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Opening Hours</label>
                            <input
                                type="text"
                                value={config.opening_hours || ""}
                                onChange={(e) => handleChange("opening_hours", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                placeholder="e.g., Monday to Friday, 9am to 5pm"
                            />
                        </div>
                    </div>
                </section>

                {/* Voice & Tone */}
                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Voice & Tone</h3>
                    <div className="grid grid-cols-2 gap-4">
                        {voiceLibrary.length === 0 && !voiceLibraryError && (
                            <div className="col-span-2 text-xs text-gray-400">
                                Voice library loaded: 0 voices.
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">TTS Provider</label>
                            <select
                                value={normalizeTtsProvider(config.tts_provider)}
                                onChange={(e) => handleTtsProviderChange(normalizeTtsProvider(e.target.value))}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            >
                                <option value="elevenlabs">ElevenLabs</option>
                                <option value="azure_neural">Azure Neural TTS</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Voice Name</label>
                            <input
                                type="text"
                                value={config.voice_name || ""}
                                onChange={(e) => handleChange("voice_name", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                placeholder="e.g., en-GB-LibbyNeural"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">
                                Legacy field. Use Azure Voice Name or ElevenLabs Voice ID below.
                            </p>
                        </div>
                        {normalizeTtsProvider(config.tts_provider) === "elevenlabs" && (
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">ElevenLabs Voice</label>
                                <select
                                    value={config.elevenlabs_voice_id || ""}
                                    onChange={(e) => handleChange("elevenlabs_voice_id", e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                >
                                    <option value="">-- Select Voice --</option>
                                    {!!config.elevenlabs_voice_id &&
                                        getAvailableVoices("elevenlabs").every(v => (v.voice_id || "") !== config.elevenlabs_voice_id) && (
                                            <option value={config.elevenlabs_voice_id}>
                                                {`Current (not in library): ${config.elevenlabs_voice_id}`}
                                            </option>
                                        )}
                                    {getAvailableVoices("elevenlabs").map(v => (
                                        <option key={v.voice_id || v.name} value={v.voice_id || ""}>
                                            {getVoiceDisplay(v)}{v.default ? " (Default)" : ""}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-gray-500 mt-1">
                                    {selectBestVoice("elevenlabs", getSelectedLanguage()) && (
                                        <>Default for {getSelectedLanguage()}: {getVoiceDisplay(selectBestVoice("elevenlabs", getSelectedLanguage()) as VoiceEntry)}</>
                                    )}
                                    {getAvailableVoices("elevenlabs").length === 0 && (
                                        <>No ElevenLabs voices found for {getSelectedLanguage()}. Add a locale to matching voices or add one in Manage Voices.</>
                                    )}
                                </p>
                            </div>
                        )}
                        {normalizeTtsProvider(config.tts_provider) === "azure_neural" && (
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Azure Neural Voice</label>
                                <select
                                    value={config.azure_voice_name || ""}
                                    onChange={(e) => handleChange("azure_voice_name", e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                >
                                    <option value="">-- Select Voice --</option>
                                    {!!config.azure_voice_name &&
                                        getAvailableVoices("azure_neural").every(v => (v.voice_name || "") !== config.azure_voice_name) && (
                                            <option value={config.azure_voice_name}>
                                                {`Current (not in library): ${config.azure_voice_name}`}
                                            </option>
                                        )}
                                    {getAvailableVoices("azure_neural").map(v => (
                                        <option key={v.voice_name || v.name} value={v.voice_name || ""}>
                                            {getVoiceDisplay(v)}{v.default ? " (Default)" : ""}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-gray-500 mt-1">
                                    {selectBestVoice("azure_neural", getSelectedLanguage()) && (
                                        <>Default for {getSelectedLanguage()}: {getVoiceDisplay(selectBestVoice("azure_neural", getSelectedLanguage()) as VoiceEntry)}</>
                                    )}
                                    {getAvailableVoices("azure_neural").length === 0 && (
                                        <>No Azure voices found for {getSelectedLanguage()}. Use Manage Voices to import them.</>
                                    )}
                                </p>
                            </div>
                        )}
                        {normalizeTtsProvider(config.tts_provider) === "azure_neural" && (
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Azure Region Override</label>
                                <input
                                    type="text"
                                    value={config.azure_speech_region || ""}
                                    onChange={(e) => handleChange("azure_speech_region", e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    placeholder="e.g., westeurope"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">
                                    Optional. Use if HD voices require a different region.
                                </p>
                            </div>
                        )}
                        {normalizeTtsProvider(config.tts_provider) === "azure_neural" && (
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Azure SSML Language</label>
                                <input
                                    type="text"
                                    value={config.azure_ssml_lang || config.language || ""}
                                    onChange={(e) => handleChange("azure_ssml_lang", e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    placeholder="e.g., en-GB"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">
                                    Accent/language hint for multilingual voices. Example: en-GB.
                                </p>
                            </div>
                        )}
                        {normalizeTtsProvider(config.tts_provider) === "azure_neural" && (
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Azure Voice Style</label>
                                <input
                                    type="text"
                                    value={config.azure_voice_style || ""}
                                    onChange={(e) => handleChange("azure_voice_style", e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    placeholder="e.g., customerservice, assistant, friendly"
                                />
                            </div>
                        )}
                        {normalizeTtsProvider(config.tts_provider) === "azure_neural" && (
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Azure Style Degree</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0.5"
                                    max="2"
                                    value={config.azure_voice_style_degree ?? ""}
                                    onChange={(e) => handleChange("azure_voice_style_degree", e.target.value === "" ? undefined : Number(e.target.value))}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                    placeholder="1.0"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">
                                    Optional style strength (commonly 0.5 to 2.0).
                                </p>
                            </div>
                        )}
                        {canManageVoiceLibrary && (
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-300 mb-2">Voice Test Text (Admin)</label>
                                <textarea
                                    value={ttsTestText}
                                    onChange={(e) => setTtsTestText(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 min-h-[80px]"
                                />
                            </div>
                        )}
                        <div className="col-span-2 flex items-center gap-3">
                            <button
                                onClick={runTtsTest}
                                disabled={ttsTestStatus === "loading"}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium disabled:opacity-50"
                            >
                                {ttsTestStatus === "loading" ? "Testing..." : "Test Voice"}
                            </button>
                            {ttsTestStatus === "playing" && (
                                <span className="text-xs text-green-300">Playing test audio...</span>
                            )}
                            {ttsTestError && (
                                <span className="text-xs text-red-300">{ttsTestError}</span>
                            )}
                        </div>

                        {voiceLibraryError && (
                            <div className="col-span-2 text-xs text-red-400">{voiceLibraryError}</div>
                        )}

                        {canManageVoiceLibrary && (
                            <div className="col-span-2 mt-2 border-t border-gray-700 pt-4">
                                <h4 className="text-sm font-semibold text-purple-300 mb-3">Manage Voices (Admin)</h4>
                                <div className="flex gap-2 mb-3">
                                    <button
                                        type="button"
                                        onClick={async () => { await importVoices("azure"); }}
                                        disabled={importingProvider !== ""}
                                        className="px-3 py-1 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                                    >
                                        {importingProvider === "azure" ? "Importing..." : `Import Azure Voices for ${getSelectedLanguage()}`}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={async () => { await importVoices("elevenlabs"); }}
                                        disabled={importingProvider !== ""}
                                        className="px-3 py-1 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                                    >
                                        {importingProvider === "elevenlabs" ? "Importing..." : "Import ElevenLabs Voices"}
                                    </button>
                                </div>
                                <div className="space-y-2 mb-4">
                                    {voiceLibrary.map((v, idx) => (
                                        <div key={`${v.provider}-${v.voice_id || v.voice_name || idx}`} className="grid grid-cols-12 gap-2 items-center">
                                            <div className="col-span-3 text-xs text-gray-300 truncate">{getVoiceDisplay(v)}</div>
                                            <div className="col-span-3">
                                                <input
                                                    type="text"
                                                    value={v.name || ""}
                                                    onChange={(e) => {
                                                        const next = [...voiceLibrary];
                                                        next[idx] = { ...next[idx], name: e.target.value };
                                                        setVoiceLibrary(next);
                                                    }}
                                                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                                    placeholder="Optional label"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <input
                                                    type="text"
                                                    value={getVoiceLocale(v)}
                                                    onChange={(e) => {
                                                        const next = [...voiceLibrary];
                                                        next[idx] = { ...next[idx], locale: e.target.value };
                                                        setVoiceLibrary(next);
                                                    }}
                                                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                                    placeholder="Locale"
                                                />
                                            </div>
                                            <label className="col-span-2 text-xs text-gray-300 flex items-center gap-1">
                                                <input
                                                    type="checkbox"
                                                    checked={!!v.default}
                                                    onChange={(e) => {
                                                        const next = e.target.checked
                                                            ? voiceLibrary.map((x, i) => ({ ...x, default: i === idx }))
                                                            : voiceLibrary.map((x, i) => i === idx ? { ...x, default: false } : x);
                                                        setVoiceLibrary(next);
                                                    }}
                                                    className="accent-purple-500"
                                                />
                                                Default
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => setVoiceLibrary(voiceLibrary.filter((_, i) => i !== idx))}
                                                className="col-span-2 px-2 py-1 rounded text-xs bg-red-800 hover:bg-red-700 text-white"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    ))}
                                    <div>
                                        <button
                                            type="button"
                                            onClick={async () => { await saveVoiceLibrary(voiceLibrary); }}
                                            className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
                                        >
                                            Save Voice Changes
                                        </button>
                                    </div>
                                </div>

                                <h4 className="text-sm font-semibold text-purple-300 mb-3">Add Voice (Admin)</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Name</label>
                                        <input
                                            type="text"
                                            value={newVoice.name}
                                            onChange={(e) => setNewVoice({ ...newVoice, name: e.target.value })}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Provider</label>
                                        <select
                                            value={newVoice.provider}
                                            onChange={(e) => setNewVoice({ ...newVoice, provider: e.target.value as any })}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        >
                                            <option value="elevenlabs">ElevenLabs</option>
                                            <option value="azure_neural">Azure Neural</option>
                                        </select>
                                    </div>
                                    {newVoice.provider === "elevenlabs" && (
                                        <div className="col-span-2">
                                            <label className="block text-xs text-gray-400 mb-1">ElevenLabs Voice ID</label>
                                            <input
                                                type="text"
                                                value={newVoice.voice_id || ""}
                                                onChange={(e) => setNewVoice({ ...newVoice, voice_id: e.target.value })}
                                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                            />
                                        </div>
                                    )}
                                    {newVoice.provider === "azure_neural" && (
                                        <div className="col-span-2">
                                            <label className="block text-xs text-gray-400 mb-1">Azure Voice Name</label>
                                            <input
                                                type="text"
                                                value={newVoice.voice_name || ""}
                                                onChange={(e) => setNewVoice({ ...newVoice, voice_name: e.target.value })}
                                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                            />
                                        </div>
                                    )}
                                    <div className="col-span-2">
                                        <label className="block text-xs text-gray-400 mb-1">Language Locale</label>
                                        <select
                                            value={newVoice.locale || getSelectedLanguage()}
                                            onChange={(e) => setNewVoice({ ...newVoice, locale: e.target.value })}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        >
                                            {!LANGUAGE_OPTIONS.some((language) => language.locale === (newVoice.locale || getSelectedLanguage())) && (
                                                <option value={newVoice.locale || getSelectedLanguage()}>{newVoice.locale || getSelectedLanguage()}</option>
                                            )}
                                            {LANGUAGE_OPTIONS.map((language) => (
                                                <option key={language.locale} value={language.locale}>
                                                    {language.label} ({language.locale})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <label className="col-span-2 flex items-center gap-2 text-xs text-gray-300">
                                        <input
                                            type="checkbox"
                                            checked={!!newVoice.default}
                                            onChange={(e) => setNewVoice({ ...newVoice, default: e.target.checked })}
                                            className="accent-purple-500"
                                        />
                                        Set as default for new clients
                                    </label>
                                    <div className="col-span-2 flex gap-2">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if ((newVoice.provider === "elevenlabs" && !newVoice.voice_id) || (newVoice.provider === "azure_neural" && !newVoice.voice_name)) {
                                                    setVoiceLibraryError("Please fill in all required fields for the new voice.");
                                                    return;
                                                }
                                                const fallbackName = newVoice.provider === "elevenlabs" ? (newVoice.voice_id || "") : (newVoice.voice_name || "");
                                                const normalizedNewVoice: VoiceEntry = {
                                                    ...newVoice,
                                                    name: (newVoice.name || fallbackName).trim(),
                                                    locale: (newVoice.locale || getSelectedLanguage()).trim(),
                                                    default: !!newVoice.default
                                                };
                                                const nextVoices = normalizedNewVoice.default
                                                    ? voiceLibrary.map(v => ({ ...v, default: false })).concat(normalizedNewVoice)
                                                    : voiceLibrary.concat(normalizedNewVoice);
                                                const ok = await saveVoiceLibrary(nextVoices);
                                                if (!ok) return;
                                                setNewVoice({ name: "", provider: "elevenlabs", voice_id: "", voice_name: "", locale: "", default: false });
                                            }}
                                            className="px-3 py-1 rounded text-xs bg-purple-700 hover:bg-purple-600 text-white"
                                        >
                                            Add Voice
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-300 mb-2">Tone</label>
                            <input
                                type="text"
                                value={config.tone || ""}
                                onChange={(e) => handleChange("tone", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                placeholder="e.g., friendly, concise, helpful"
                            />
                        </div>
                    </div>
                </section>

                {/* General Features */}
                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">General Features</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={config.enable_caller_memory || false}
                                onChange={(e) => handleChange("enable_caller_memory", e.target.checked)}
                                className="w-5 h-5 bg-gray-900 border-gray-600 rounded focus:ring-blue-500"
                            />
                            <span className="text-gray-300">Enable Caller Memory</span>
                        </label>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Barge-in Threshold (ms)</label>
                            <input
                                type="number"
                                value={config.barge_in_threshold_ms ?? 0}
                                onChange={(e) => handleChange("barge_in_threshold_ms", parseInt(e.target.value) || 0)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                                min="0"
                                placeholder="1500"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">0 disables barge-in.</p>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Whisper Target Number</label>
                            <input
                                type="text"
                                value={config.whisper_target_number || ""}
                                onChange={(e) => handleChange("whisper_target_number", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                                placeholder="e.g., 07970809518"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">Used for manager whisper/handoff.</p>
                            <div className="flex items-center gap-2 mt-2">
                                <button
                                    type="button"
                                    onClick={runWhisperTest}
                                    disabled={whisperTestStatus === "loading"}
                                    className={`px-3 py-1 rounded text-xs font-medium ${whisperTestStatus === "loading" ? "bg-gray-700 text-gray-400" : "bg-purple-600 hover:bg-purple-500 text-white"}`}
                                >
                                    {whisperTestStatus === "loading" ? "Testing..." : "Test Whisper"}
                                </button>
                                {whisperTestStatus === "sent" && (
                                    <span className="text-xs text-green-400">Sent</span>
                                )}
                            </div>
                            {whisperTestError && (
                                <div className="text-xs text-red-400 mt-1">{whisperTestError}</div>
                            )}
                        </div>
                    </div>
                </section>

                {/* Workflow Behavior */}
                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Database Connections</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Create reusable database connections for Database Query action nodes.
                    </p>
                    <div className="space-y-4">
                        {Object.entries(config.database_connections || {}).map(([connKey, conn]: any) => (
                            <div key={`db-conn-${connKey}`} className="p-4 bg-gray-900 rounded border border-gray-700">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="text-sm font-semibold text-white">{connKey}</div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => runDatabaseConnectionTest(connKey, conn)}
                                            disabled={dbTestStatus[connKey] === "loading"}
                                            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                                        >
                                            {dbTestStatus[connKey] === "loading" ? "Testing..." : "Test Connection"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = { ...(config.database_connections || {}) };
                                                delete next[connKey];
                                                handleChange("database_connections", next);
                                            }}
                                            className="text-xs px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-white"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Type</label>
                                        <select
                                            value={conn.type || "postgres"}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), type: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        >
                                            <option value="postgres">PostgreSQL</option>
                                            <option value="mysql">MySQL</option>
                                            <option value="sqlserver">SQL Server</option>
                                            <option value="sqlite">SQLite</option>
                                            <option value="supabase_rest">Supabase REST</option>
                                            <option value="custom">Custom</option>
                                        </select>
                                    </div>
                                    {conn.type === "supabase_rest" && (
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Supabase URL</label>
                                            <input
                                                type="text"
                                                value={conn.supabase_url || ""}
                                                onChange={(e) => {
                                                    const next = {
                                                        ...(config.database_connections || {}),
                                                        [connKey]: { ...(conn || {}), supabase_url: e.target.value }
                                                    };
                                                    handleChange("database_connections", next);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                placeholder="https://<project-ref>.supabase.co"
                                            />
                                        </div>
                                    )}
                                    {conn.type === "supabase_rest" && (
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Supabase Key</label>
                                            <input
                                                type="password"
                                                value={conn.supabase_key || ""}
                                                onChange={(e) => {
                                                    const next = {
                                                        ...(config.database_connections || {}),
                                                        [connKey]: { ...(conn || {}), supabase_key: e.target.value }
                                                    };
                                                    handleChange("database_connections", next);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                placeholder="Prefer service role key"
                                            />
                                        </div>
                                    )}
                                    {conn.type === "supabase_rest" && (
                                        <div className="col-span-2">
                                            <label className="block text-xs text-gray-400 mb-1">Supabase Key Env Var</label>
                                            <input
                                                type="text"
                                                value={conn.supabase_key_env || ""}
                                                onChange={(e) => {
                                                    const next = {
                                                        ...(config.database_connections || {}),
                                                        [connKey]: { ...(conn || {}), supabase_key_env: e.target.value }
                                                    };
                                                    handleChange("database_connections", next);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                placeholder="Recommended (e.g. SUPABASE_SERVICE_ROLE_KEY)"
                                            />
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Connection String</label>
                                        <input
                                            type="text"
                                            value={conn.connection_string || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), connection_string: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                            placeholder="Optional DSN/ODBC/URI"
                                        />
                                    </div>
                                    {(conn.type || "postgres") === "postgres" && (
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">SSL Mode</label>
                                            <select
                                                value={conn.sslmode || ""}
                                                onChange={(e) => {
                                                    const next = {
                                                        ...(config.database_connections || {}),
                                                        [connKey]: { ...(conn || {}), sslmode: e.target.value }
                                                    };
                                                    handleChange("database_connections", next);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                            >
                                                <option value="">(default)</option>
                                                <option value="disable">disable</option>
                                                <option value="allow">allow</option>
                                                <option value="prefer">prefer</option>
                                                <option value="require">require</option>
                                                <option value="verify-ca">verify-ca</option>
                                                <option value="verify-full">verify-full</option>
                                            </select>
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Host</label>
                                        <input
                                            type="text"
                                            value={conn.host || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), host: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Port</label>
                                        <input
                                            type="text"
                                            value={conn.port || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), port: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Database</label>
                                        <input
                                            type="text"
                                            value={conn.database || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), database: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">SQLite Path</label>
                                        <input
                                            type="text"
                                            value={conn.sqlite_path || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), sqlite_path: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                            placeholder="For sqlite only"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Username</label>
                                        <input
                                            type="text"
                                            value={conn.username || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), username: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Password</label>
                                        <input
                                            type="password"
                                            value={conn.password || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), password: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                            placeholder="Optional; prefer Password Env"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs text-gray-400 mb-1">Password Env Var</label>
                                        <input
                                            type="text"
                                            value={conn.password_env || ""}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.database_connections || {}),
                                                    [connKey]: { ...(conn || {}), password_env: e.target.value }
                                                };
                                                handleChange("database_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                            placeholder="Recommended (e.g. DB_PASSWORD_MAIN)"
                                        />
                                    </div>
                                    {(conn.type || "postgres") === "postgres" && (
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">SSL Root Cert Path</label>
                                            <input
                                                type="text"
                                                value={conn.sslrootcert || ""}
                                                onChange={(e) => {
                                                    const next = {
                                                        ...(config.database_connections || {}),
                                                        [connKey]: { ...(conn || {}), sslrootcert: e.target.value }
                                                    };
                                                    handleChange("database_connections", next);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                placeholder="Optional filesystem path"
                                            />
                                        </div>
                                    )}
                                    {(conn.type || "postgres") === "postgres" && (
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">SSL Client Cert Path</label>
                                            <input
                                                type="text"
                                                value={conn.sslcert || ""}
                                                onChange={(e) => {
                                                    const next = {
                                                        ...(config.database_connections || {}),
                                                        [connKey]: { ...(conn || {}), sslcert: e.target.value }
                                                    };
                                                    handleChange("database_connections", next);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                placeholder="Optional filesystem path"
                                            />
                                        </div>
                                    )}
                                    {(conn.type || "postgres") === "postgres" && (
                                        <div className="col-span-2">
                                            <label className="block text-xs text-gray-400 mb-1">SSL Client Key Path</label>
                                            <input
                                                type="text"
                                                value={conn.sslkey || ""}
                                                onChange={(e) => {
                                                    const next = {
                                                        ...(config.database_connections || {}),
                                                        [connKey]: { ...(conn || {}), sslkey: e.target.value }
                                                    };
                                                    handleChange("database_connections", next);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                placeholder="Optional filesystem path"
                                            />
                                        </div>
                                    )}
                                </div>
                                {dbTestStatus[connKey] === "ok" && dbTestMessage[connKey] && (
                                    <p className="text-xs text-green-400 mt-3">{dbTestMessage[connKey]}</p>
                                )}
                                {dbTestStatus[connKey] === "error" && dbTestMessage[connKey] && (
                                    <p className="text-xs text-red-400 mt-3">{dbTestMessage[connKey]}</p>
                                )}
                            </div>
                        ))}
                        <div>
                            <button
                                type="button"
                                onClick={() => {
                                    const key = prompt("Connection key (e.g. crm_main):")?.trim();
                                    if (!key) return;
                                    const existing = config.database_connections || {};
                                    if (existing[key]) {
                                        alert(`Connection '${key}' already exists.`);
                                        return;
                                    }
                                    handleChange("database_connections", {
                                        ...existing,
                                        [key]: { type: "postgres" }
                                    });
                                }}
                                className="px-3 py-2 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
                            >
                                + Add Database Connection
                            </button>
                        </div>
                    </div>
                </section>

                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Knowledge Base Connections</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Create reusable KB/search connections for Knowledge Search action nodes.
                    </p>
                    <div className="space-y-4">
                        {Object.entries(config.knowledge_base_connections || {}).map(([connKey, conn]: any) => (
                            <div key={`kb-conn-${connKey}`} className="p-4 bg-gray-900 rounded border border-gray-700">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="text-sm font-semibold text-white">{connKey}</div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => runKnowledgeBaseConnectionTest(connKey, conn)}
                                            disabled={kbTestStatus[connKey] === "loading"}
                                            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                                        >
                                            {kbTestStatus[connKey] === "loading" ? "Testing..." : "Test Connection"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = { ...(config.knowledge_base_connections || {}) };
                                                delete next[connKey];
                                                handleChange("knowledge_base_connections", next);
                                            }}
                                            className="text-xs px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-white"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Provider</label>
                                        <select
                                            value={conn.type || "azure_search"}
                                            onChange={(e) => {
                                                const next = {
                                                    ...(config.knowledge_base_connections || {}),
                                                    [connKey]: { ...(conn || {}), type: e.target.value }
                                                };
                                                handleChange("knowledge_base_connections", next);
                                            }}
                                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                        >
                                            <option value="azure_search">Azure AI Search</option>
                                            <option value="supabase_rest">Supabase REST/RPC</option>
                                            <option value="postgres">PostgreSQL (incl. Supabase pooled DB)</option>
                                        </select>
                                    </div>

                                    {(conn.type || "azure_search") === "supabase_rest" ? (
                                        <>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Supabase URL</label>
                                                <input
                                                    type="text"
                                                    value={conn.supabase_url || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), supabase_url: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="https://<project-ref>.supabase.co"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Endpoint Path</label>
                                                <input
                                                    type="text"
                                                    value={conn.endpoint_path || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), endpoint_path: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="/rest/v1/rpc/match_documents"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">HTTP Method</label>
                                                <input
                                                    type="text"
                                                    value={conn.http_method || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), http_method: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="POST"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Supabase Key Env Var</label>
                                                <input
                                                    type="text"
                                                    value={conn.supabase_key_env || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), supabase_key_env: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="SUPABASE_SERVICE_ROLE_KEY"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">Supabase Key (optional)</label>
                                                <input
                                                    type="password"
                                                    value={conn.supabase_key || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), supabase_key: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="Prefer env var in production"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">Body Template (optional JSON)</label>
                                                <textarea
                                                    value={conn.body_template || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), body_template: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder='{"query_text":"{_last_user_input}","match_count":3}'
                                                    rows={2}
                                                />
                                            </div>
                                        </>
                                    ) : (conn.type || "azure_search") === "postgres" ? (
                                        <>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Host</label>
                                                <input
                                                    type="text"
                                                    value={conn.host || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), host: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="aws-1-eu-west-1.pooler.supabase.com"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Port</label>
                                                <input
                                                    type="text"
                                                    value={conn.port || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), port: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="5432"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Database</label>
                                                <input
                                                    type="text"
                                                    value={conn.database || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), database: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="postgres"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Schema</label>
                                                <input
                                                    type="text"
                                                    value={conn.schema || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), schema: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="public"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">SSL Mode</label>
                                                <select
                                                    value={conn.sslmode || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), sslmode: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                >
                                                    <option value="">(default)</option>
                                                    <option value="disable">disable</option>
                                                    <option value="allow">allow</option>
                                                    <option value="prefer">prefer</option>
                                                    <option value="require">require</option>
                                                    <option value="verify-ca">verify-ca</option>
                                                    <option value="verify-full">verify-full</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Username</label>
                                                <input
                                                    type="text"
                                                    value={conn.username || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), username: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="postgres.xxxxx"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Password Env Var</label>
                                                <input
                                                    type="text"
                                                    value={conn.password_env || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), password_env: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="SUPABASE_DB_PASSWORD"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">Password (optional)</label>
                                                <input
                                                    type="password"
                                                    value={conn.password || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), password: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="Prefer env var in production"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">SSL Root Cert Path</label>
                                                <input
                                                    type="text"
                                                    value={conn.sslrootcert || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), sslrootcert: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="Optional filesystem path"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">SSL Client Cert Path</label>
                                                <input
                                                    type="text"
                                                    value={conn.sslcert || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), sslcert: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="Optional filesystem path"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">SSL Client Key Path</label>
                                                <input
                                                    type="text"
                                                    value={conn.sslkey || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), sslkey: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="Optional filesystem path"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">Connection String (optional)</label>
                                                <input
                                                    type="text"
                                                    value={conn.connection_string || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), connection_string: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="postgresql://user:pass@host:5432/postgres?sslmode=require"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">SQL Query Template</label>
                                                <textarea
                                                    value={conn.query_sql || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), query_sql: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="SELECT title, content, similarity FROM kb_chunks WHERE content ILIKE '%' || {query_text} || '%' ORDER BY similarity DESC LIMIT {top_k}"
                                                    rows={3}
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Endpoint</label>
                                                <input
                                                    type="text"
                                                    value={conn.endpoint || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), endpoint: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="https://<service>.search.windows.net"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Index Name</label>
                                                <input
                                                    type="text"
                                                    value={conn.index_name || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), index_name: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">API Version</label>
                                                <input
                                                    type="text"
                                                    value={conn.api_version || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), api_version: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="2023-11-01"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">API Key Env Var</label>
                                                <input
                                                    type="text"
                                                    value={conn.api_key_env || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), api_key_env: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="AZURE_SEARCH_API_KEY"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">API Key (optional)</label>
                                                <input
                                                    type="password"
                                                    value={conn.api_key || ""}
                                                    onChange={(e) => {
                                                        const next = {
                                                            ...(config.knowledge_base_connections || {}),
                                                            [connKey]: { ...(conn || {}), api_key: e.target.value }
                                                        };
                                                        handleChange("knowledge_base_connections", next);
                                                    }}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
                                                    placeholder="Prefer env var in production"
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                                {kbTestStatus[connKey] === "ok" && kbTestMessage[connKey] && (
                                    <p className="text-xs text-green-400 mt-3">{kbTestMessage[connKey]}</p>
                                )}
                                {kbTestStatus[connKey] === "error" && kbTestMessage[connKey] && (
                                    <p className="text-xs text-red-400 mt-3">{kbTestMessage[connKey]}</p>
                                )}
                            </div>
                        ))}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    const key = prompt("KB connection key (e.g. azure_search_main):")?.trim();
                                    if (!key) return;
                                    const existing = config.knowledge_base_connections || {};
                                    if (existing[key]) {
                                        alert(`Knowledge base connection '${key}' already exists.`);
                                        return;
                                    }
                                    handleChange("knowledge_base_connections", {
                                        ...existing,
                                        [key]: { type: "azure_search", api_version: "2023-11-01" }
                                    });
                                }}
                                className="px-3 py-2 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
                            >
                                + Add Knowledge Base Connection
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const existing = config.knowledge_base_connections || {};
                                    let key = "test_kb";
                                    if (existing[key]) {
                                        let i = 2;
                                        while (existing[`test_kb_${i}`]) i += 1;
                                        key = `test_kb_${i}`;
                                    }
                                    handleChange("knowledge_base_connections", {
                                        ...existing,
                                        [key]: {
                                            type: "postgres",
                                            host: "aws-1-eu-west-1.pooler.supabase.com",
                                            port: 5432,
                                            database: "postgres",
                                            schema: "public",
                                            username: "postgres.<project_ref>",
                                            password_env: "SUPABASE_DB_PASSWORD",
                                            sslmode: "require",
                                            query_sql: "SELECT content FROM kb_chunks WHERE content ILIKE '%' || {query_text} || '%' LIMIT {top_k}"
                                        }
                                    });
                                }}
                                className="px-3 py-2 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white"
                                title="Adds a prefilled Supabase PostgreSQL test KB connection"
                            >
                                + Add Test KB Connection
                            </button>
                        </div>
                    </div>
                </section>

                {/* Workflow Behavior */}
                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Workflow Behavior</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Control how the agent asks questions for each workflow.
                    </p>

                    <div className="space-y-6">
                        {visibleIntents.map((intent) => {
                            const behavior = (config.workflow_behavior || {})[intent] || {
                                question_mode: "single_turn",
                                max_follow_ups: 0
                            };

                            return (
                                <div key={`behavior-${intent}`} className="p-4 bg-gray-900 rounded border border-gray-700">
                                    <h4 className="text-md font-medium text-white capitalize mb-4">{intent} Workflow</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Question Mode</label>
                                            <select
                                                value={behavior.question_mode}
                                                onChange={(e) => {
                                                    const newBehavior = { ...(config.workflow_behavior || {}) };
                                                    newBehavior[intent] = { ...behavior, question_mode: e.target.value };
                                                    handleChange("workflow_behavior", newBehavior);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                                            >
                                                <option value="single_turn">Single Turn (Ask Once)</option>
                                                <option value="multi_turn">Multi Turn (LLM Clarification)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Max Follow-ups</label>
                                            <input
                                                type="number"
                                                value={behavior.max_follow_ups}
                                                onChange={(e) => {
                                                    const newBehavior = { ...(config.workflow_behavior || {}) };
                                                    newBehavior[intent] = { ...behavior, max_follow_ups: parseInt(e.target.value) || 0 };
                                                    handleChange("workflow_behavior", newBehavior);
                                                }}
                                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-blue-500"
                                                min="-1"
                                                max="10"
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Warranty Settings */}
                {isIntentEnabled("warranty") && (
                    <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                        <h3 className="text-lg font-semibold text-blue-400 mb-4">Warranty Settings</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Warranty Period (months)</label>
                                <input
                                    type="number"
                                    value={config.warranty_period_months || 0}
                                    onChange={(e) => handleChange("warranty_period_months", parseInt(e.target.value) || 0)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            {config.warranty_completion && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">Completion Mode</label>
                                        <select
                                            value={config.warranty_completion.mode || "handoff"}
                                            onChange={(e) => handleNestedChange("warranty_completion", "mode", e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                        >
                                            <option value="handoff">Handoff</option>
                                            <option value="complete">Complete</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">Target Intent</label>
                                        <input
                                            type="text"
                                            value={config.warranty_completion.target_intent || ""}
                                            onChange={(e) => handleNestedChange("warranty_completion", "target_intent", e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">Transition Message</label>
                                        <textarea
                                            value={config.warranty_completion.transition_message || ""}
                                            onChange={(e) => handleNestedChange("warranty_completion", "transition_message", e.target.value)}
                                            rows={3}
                                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </section>
                )}

                {/* Booking Configuration */}
                {config.booking_config && (
                    <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                        <h3 className="text-lg font-semibold text-blue-400 mb-4">Booking Configuration</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Notification Email</label>
                                <input
                                    type="email"
                                    value={config.booking_config.notification_email || ""}
                                    onChange={(e) => handleNestedChange("booking_config", "notification_email", e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Email Subject Prefix</label>
                                <input
                                    type="text"
                                    value={config.booking_config.email_subject_prefix || ""}
                                    onChange={(e) => handleNestedChange("booking_config", "email_subject_prefix", e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>
                        </div>
                    </section>
                )}

                {/* Intent Routing Rules */}
                <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Intent Routing</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Configure how the agent detects customer intents. The checkbox only enables/disables routing; "Remove" deletes the workflow intent from this client.
                    </p>

                    {visibleIntents.map((intent) => {
                        const rules = config.intent_routing_rules || {};
                        const intentRule = rules[intent] || { keywords: [], enabled: true };
                        const isEnabled = intentRule.enabled !== false;

                        return (
                            <div key={intent} className="mb-4 p-4 bg-gray-900 rounded border border-gray-700">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={isEnabled}
                                            onChange={(e) => {
                                                const newRules = { ...rules };
                                                if (!newRules[intent]) newRules[intent] = { keywords: [], enabled: true };
                                                newRules[intent].enabled = e.target.checked;
                                                handleChange("intent_routing_rules", newRules);
                                            }}
                                            className="w-5 h-5 bg-gray-900 border-gray-600 rounded focus:ring-blue-500"
                                        />
                                        <span className="text-lg font-semibold text-white capitalize">{intent}</span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const normalize = (v: string) => String(v || "").trim().toLowerCase();
                                            const target = normalize(intent);

                                            const newIntents = (config.intents || []).filter((i) => normalize(i) !== target);

                                            const newRules = Object.fromEntries(
                                                Object.entries(rules).filter(([k]) => normalize(k) !== target)
                                            );
                                            const newWorkflows = Object.fromEntries(
                                                Object.entries(config.workflows || {}).filter(([k]) => normalize(k) !== target)
                                            );
                                            const newBehavior = Object.fromEntries(
                                                Object.entries(config.workflow_behavior || {}).filter(([k]) => normalize(k) !== target)
                                            );

                                            const nextConfig = {
                                                ...config,
                                                intents: newIntents,
                                                intent_routing_rules: newRules,
                                                workflows: newWorkflows,
                                                workflow_behavior: newBehavior
                                            };
                                            setConfig(nextConfig);
                                            onChange(nextConfig);
                                        }}
                                        className="text-red-400 hover:text-red-300 text-sm"
                                    >
                                        Remove Intent
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Keywords (comma-separated)
                                    </label>
                                    <input
                                        type="text"
                                        disabled={!isEnabled}
                                        key={`keywords-${intent}`}
                                        defaultValue={intentRule.keywords?.join(", ") || ""}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.currentTarget.blur();
                                            }
                                        }}
                                        onBlur={(e) => {
                                            const keywords = e.target.value.split(",").map(k => k.trim()).filter(Boolean);
                                            const newRules = { ...rules };
                                            if (!newRules[intent]) newRules[intent] = { keywords: [], enabled: true };
                                            newRules[intent].keywords = keywords;
                                            handleChange("intent_routing_rules", newRules);
                                        }}
                                        className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                                        placeholder={`e.g., ${intent === 'sales' ? 'order, buy, purchase' : intent === 'warranty' ? 'warranty, guarantee, cover' : 'help, support'}`}
                                    />
                                </div>
                            </div>
                        );
                    })}

                    <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                            <select
                                value={selectedLibraryIntent}
                                onChange={(e) => setSelectedLibraryIntent(e.target.value)}
                                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                            >
                                <option value="">Select intent from library...</option>
                                {intentLibrary
                                    .filter((entry) => !(config.intents || []).includes(entry.name))
                                    .map((entry) => (
                                        <option key={entry.name} value={entry.name}>
                                            {entry.label || entry.name} ({entry.name})
                                        </option>
                                    ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!selectedLibraryIntent) return;
                                    const selectedEntry = intentLibrary.find((entry) => entry.name === selectedLibraryIntent);
                                    const ok = addIntentToClient(
                                        selectedLibraryIntent,
                                        selectedEntry?.workflow_template || globalTemplateMap?.[selectedLibraryIntent]
                                    );
                                    if (ok) {
                                        setSelectedLibraryIntent("");
                                        alert(`Intent "${selectedLibraryIntent}" added with starter workflow. Click Save at the top.`);
                                    }
                                }}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
                            >
                                Add From Library
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                            <input
                                type="text"
                                value={newIntentName}
                                onChange={(e) => setNewIntentName(e.target.value)}
                                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                                placeholder="New intent id (e.g., address_lookup)"
                            />
                            <input
                                type="text"
                                value={newIntentLabel}
                                onChange={(e) => setNewIntentLabel(e.target.value)}
                                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                                placeholder="Label (optional)"
                            />
                            <button
                                type="button"
                                onClick={async () => {
                                    const normalizedName = normalizeIntentName(newIntentName);
                                    const currentTemplate = config.workflows?.[normalizedName] || industryDefaults?.workflows?.[normalizedName];
                                    const ok = addIntentToClient(newIntentName, currentTemplate);
                                    if (!ok) return;
                                    if (canManageIntentLibrary) {
                                        const exists = intentLibrary.some((entry) => entry.name === normalizedName);
                                        if (!exists) {
                                            const nextIntents = intentLibrary.concat({
                                                name: normalizedName,
                                                label: newIntentLabel.trim() || normalizedName,
                                                workflow_template: cloneTemplate(currentTemplate)
                                            });
                                            await saveIntentLibrary(nextIntents);
                                        }
                                    }
                                    setNewIntentName("");
                                    setNewIntentLabel("");
                                    alert(`Intent "${normalizedName}" added with starter workflow. Click Save at the top.`);
                                }}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium"
                            >
                                Add Custom Intent
                            </button>
                        </div>

                        {intentLibraryError && (
                            <div className="text-xs text-red-400">{intentLibraryError}</div>
                        )}

                        {canManageIntentLibrary && (
                            <div className="mt-2 border-t border-gray-700 pt-3">
                                <h4 className="text-sm font-semibold text-purple-300 mb-2">Manage Intent Library (Admin)</h4>
                                <p className="text-xs text-gray-400 mb-3">
                                    Save workflow templates here so "Add From Library" creates full node flows.
                                </p>
                                <div className="flex gap-2 mb-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const next = intentLibrary.map((entry) => {
                                                const source = config.workflows?.[entry.name];
                                                if (!source) return entry;
                                                return { ...entry, workflow_template: cloneTemplate(source) };
                                            });
                                            setIntentLibrary(next);
                                        }}
                                        className="px-3 py-1 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white"
                                    >
                                        Capture All From Current Client
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const next = intentLibrary.map((entry) => {
                                                if (entry.workflow_template) return entry;
                                                const source = industryDefaults?.workflows?.[entry.name];
                                                if (!source) return entry;
                                                return { ...entry, workflow_template: cloneTemplate(source) };
                                            });
                                            setIntentLibrary(next);
                                        }}
                                        className="px-3 py-1 rounded text-xs bg-indigo-700 hover:bg-indigo-600 text-white"
                                    >
                                        Fill Missing From Industry
                                    </button>
                                </div>
                                <div className="space-y-2 mb-3">
                                    {intentLibrary.map((entry, idx) => (
                                        <div key={`${entry.name}-${idx}`} className="p-2 border border-gray-700 rounded bg-gray-900/30">
                                            <div className="grid grid-cols-12 gap-2 items-center mb-2">
                                                <div className="col-span-4 text-xs text-gray-300">{entry.name}</div>
                                                <div className="col-span-4">
                                                    <input
                                                        type="text"
                                                        value={entry.label || ""}
                                                        onChange={(e) => {
                                                            const next = [...intentLibrary];
                                                            next[idx] = { ...next[idx], label: e.target.value };
                                                            setIntentLibrary(next);
                                                        }}
                                                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-xs"
                                                        placeholder="Display label"
                                                    />
                                                </div>
                                                <div className="col-span-3 text-[11px] text-gray-400">
                                                    {entry.workflow_template ? "Template: Yes" : "Template: No"}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setIntentLibrary(intentLibrary.filter((_, i) => i !== idx))}
                                                    className="col-span-1 px-2 py-1 rounded text-xs bg-red-800 hover:bg-red-700 text-white"
                                                >
                                                    Delete
                                                </button>
                                            </div>

                                            <div className="flex gap-2 mb-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const source = config.workflows?.[entry.name];
                                                        if (!source) {
                                                            alert(`No current client workflow found for "${entry.name}".`);
                                                            return;
                                                        }
                                                        const next = [...intentLibrary];
                                                        next[idx] = { ...next[idx], workflow_template: cloneTemplate(source) };
                                                        setIntentLibrary(next);
                                                    }}
                                                    className="px-2 py-1 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white"
                                                >
                                                    Capture Current Workflow
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const source = industryDefaults?.workflows?.[entry.name];
                                                        if (!source) {
                                                            alert(`No industry workflow found for "${entry.name}".`);
                                                            return;
                                                        }
                                                        const next = [...intentLibrary];
                                                        next[idx] = { ...next[idx], workflow_template: cloneTemplate(source) };
                                                        setIntentLibrary(next);
                                                    }}
                                                    className="px-2 py-1 rounded text-xs bg-indigo-700 hover:bg-indigo-600 text-white"
                                                >
                                                    Use Industry Template
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const next = [...intentLibrary];
                                                        next[idx] = { ...next[idx], workflow_template: undefined };
                                                        setIntentLibrary(next);
                                                    }}
                                                    className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-white"
                                                >
                                                    Clear Template
                                                </button>
                                            </div>

                                            <textarea
                                                key={`intent-template-${entry.name}-${idx}`}
                                                defaultValue={entry.workflow_template ? JSON.stringify(entry.workflow_template, null, 2) : ""}
                                                onBlur={(e) => {
                                                    const raw = e.target.value.trim();
                                                    const next = [...intentLibrary];
                                                    if (!raw) {
                                                        next[idx] = { ...next[idx], workflow_template: undefined };
                                                        setIntentLibrary(next);
                                                        return;
                                                    }
                                                    try {
                                                        const parsed = JSON.parse(raw);
                                                        next[idx] = { ...next[idx], workflow_template: parsed };
                                                        setIntentLibrary(next);
                                                    } catch {
                                                        alert(`Invalid JSON for template "${entry.name}".`);
                                                    }
                                                }}
                                                className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-white text-[11px] min-h-[80px]"
                                                placeholder="Workflow template JSON (optional)"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={async () => { await saveIntentLibrary(intentLibrary); }}
                                    className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
                                >
                                    Save Intent Library
                                </button>
                            </div>
                        )}
                    </div>
                </section>

                {/* Info Note */}
                <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
                    <p className="text-sm text-blue-300">
                        <strong>Note:</strong> This form shows the main configuration fields. Advanced settings like prompts, workflows, and intent routing rules can be edited in the "Prompts", "Workflows", and "Raw JSON" tabs.
                    </p>
                </div>
            </div>
        </div>
    );
}
