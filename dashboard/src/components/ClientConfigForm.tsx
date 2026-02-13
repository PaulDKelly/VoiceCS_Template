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
    [key: string]: any;
};

type Props = {
    jsonContent: ClientConfig;
    onChange: (newJson: any) => void;
    assignedPhoneNumber?: string;
    canManageVoiceLibrary?: boolean;
};

type VoiceEntry = {
    name: string;
    provider: "elevenlabs" | "azure_neural";
    voice_id?: string;
    voice_name?: string;
    default?: boolean;
};

export default function ClientConfigForm({ jsonContent, onChange, assignedPhoneNumber, canManageVoiceLibrary }: Props) {
    const [config, setConfig] = useState<ClientConfig>(jsonContent);
    const [industryDefaults, setIndustryDefaults] = useState<any>(null);
    const [ttsTestStatus, setTtsTestStatus] = useState<"idle" | "loading" | "playing">("idle");
    const [ttsTestError, setTtsTestError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [whisperTestStatus, setWhisperTestStatus] = useState<"idle" | "loading" | "sent">("idle");
    const [whisperTestError, setWhisperTestError] = useState<string | null>(null);
    const [voiceLibrary, setVoiceLibrary] = useState<VoiceEntry[]>([]);
    const [voiceLibraryError, setVoiceLibraryError] = useState<string | null>(null);
    const [newVoice, setNewVoice] = useState<VoiceEntry>({
        name: "",
        provider: "elevenlabs",
        voice_id: "",
        voice_name: "",
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
                setVoiceLibrary((data && data.voices) || []);
            } catch (err) {
                console.error("Failed to load voice library", err);
                setVoiceLibraryError("Failed to load voice library");
                setVoiceLibrary([]);
            }
        };
        load();
    }, []);


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
                    text: "Hello, this is a short voice test for your assistant.",
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

    // Helper: Create a workflow template from industry defaults or basic fallback
    const createWorkflowTemplate = (intent: string) => {
        // Try to get from industry defaults first
        if (industryDefaults?.workflows?.[intent]) {
            console.log(`[Using industry template for ${intent}]`);
            return industryDefaults.workflows[intent];
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
                            <input
                                type="text"
                                value={config.language || ""}
                                onChange={(e) => handleChange("language", e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                placeholder="e.g., en-GB"
                            />
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
                                onChange={(e) => handleChange("tts_provider", normalizeTtsProvider(e.target.value))}
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
                                        voiceLibrary.filter(v => v.provider === "elevenlabs").every(v => (v.voice_id || "") !== config.elevenlabs_voice_id) && (
                                            <option value={config.elevenlabs_voice_id}>
                                                {`Current (not in library): ${config.elevenlabs_voice_id}`}
                                            </option>
                                        )}
                                    {voiceLibrary.filter(v => v.provider === "elevenlabs").map(v => (
                                        <option key={v.voice_id || v.name} value={v.voice_id || ""}>
                                            {v.name}{v.default ? " (Default)" : ""}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-gray-500 mt-1">
                                    {voiceLibrary.find(v => v.provider === "elevenlabs" && v.default)?.name && (
                                        <>Default for new clients: {voiceLibrary.find(v => v.provider === "elevenlabs" && v.default)?.name}</>
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
                                        voiceLibrary.filter(v => v.provider === "azure_neural").every(v => (v.voice_name || "") !== config.azure_voice_name) && (
                                            <option value={config.azure_voice_name}>
                                                {`Current (not in library): ${config.azure_voice_name}`}
                                            </option>
                                        )}
                                    {voiceLibrary.filter(v => v.provider === "azure_neural").map(v => (
                                        <option key={v.voice_name || v.name} value={v.voice_name || ""}>
                                            {v.name}{v.default ? " (Default)" : ""}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-gray-500 mt-1">
                                    {voiceLibrary.find(v => v.provider === "azure_neural" && v.default)?.name && (
                                        <>Default for new clients: {voiceLibrary.find(v => v.provider === "azure_neural" && v.default)?.name}</>
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
                                                if (!newVoice.name || (newVoice.provider === "elevenlabs" && !newVoice.voice_id) || (newVoice.provider === "azure_neural" && !newVoice.voice_name)) {
                                                    setVoiceLibraryError("Please fill in all required fields for the new voice.");
                                                    return;
                                                }
                                                const nextVoices = newVoice.default
                                                    ? voiceLibrary.map(v => ({ ...v, default: false })).concat(newVoice)
                                                    : voiceLibrary.concat(newVoice);
                                                const res = await fetch("/api/config", {
                                                    method: "POST",
                                                    body: JSON.stringify({ action: "save", type: "voice_library", content: { voices: nextVoices } })
                                                });
                                                if (!res.ok) {
                                                    const err = await res.json().catch(() => null);
                                                    setVoiceLibraryError(err?.error || "Failed to save voice library.");
                                                    return;
                                                }
                                                setVoiceLibrary(nextVoices);
                                                setNewVoice({ name: "", provider: "elevenlabs", voice_id: "", voice_name: "", default: false });
                                                setVoiceLibraryError(null);
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
                    <h3 className="text-lg font-semibold text-blue-400 mb-4">Workflow Behavior</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Control how the agent asks questions for each workflow.
                    </p>

                    <div className="space-y-6">
                        {config.intents?.map((intent) => {
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
                        Configure how the agent detects customer intents. Add keywords that trigger each workflow.
                    </p>

                    {config.intents?.map((intent) => {
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
                                            const newIntents = config.intents?.filter(i => i !== intent) || [];
                                            handleChange("intents", newIntents);
                                            const newRules = { ...rules };
                                            delete newRules[intent];
                                            handleChange("intent_routing_rules", newRules);
                                        }}
                                        className="text-red-400 hover:text-red-300 text-sm"
                                    >
                                        Remove
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

                    <button
                        onClick={() => {
                            const newIntent = prompt("Enter new intent name (e.g., sales, support):");
                            if (newIntent && newIntent.trim()) {
                                const intentName = newIntent.toLowerCase().trim();
                                if (!config.intents?.includes(intentName)) {
                                    // Add to intents list
                                    handleChange("intents", [...(config.intents || []), intentName]);

                                    // Add to routing rules
                                    const newRules = { ...(config.intent_routing_rules || {}) };
                                    newRules[intentName] = { keywords: [], enabled: true };
                                    handleChange("intent_routing_rules", newRules);

                                    // Auto-create workflow template
                                    const newWorkflows = { ...(config.workflows || {}) };
                                    if (!newWorkflows[intentName]) {
                                        newWorkflows[intentName] = createWorkflowTemplate(intentName);
                                        handleChange("workflows", newWorkflows);
                                        console.log(`[Auto-created workflow for new intent: ${intentName}]`);

                                        // Also merge prompts from industry defaults
                                        const intentPrompts = mergePromptsFromIndustry(intentName);
                                        if (Object.keys(intentPrompts).length > 0) {
                                            const newPrompts = { ...(config.prompts || {}), ...intentPrompts };
                                            handleChange("prompts", newPrompts);
                                            console.log(`[Merged ${Object.keys(intentPrompts).length} prompts for ${intentName}]`);
                                        }
                                    }

                                    alert(`Intent "${intentName}" added with starter workflow! Don't forget to click Save at the top.`);
                                } else {
                                    alert(`Intent "${intentName}" already exists.`);
                                }
                            }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
                    >
                        + Add Intent
                    </button>
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
