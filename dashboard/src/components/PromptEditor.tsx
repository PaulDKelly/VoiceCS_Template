"use client";

import { useState, useEffect } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";

interface PromptEditorProps {
    jsonContent: any;
    onChange: (newContent: any) => void;
    globalPrompts?: Record<string, string>;
    canManagePromptLibrary?: boolean;
}

export default function PromptEditor({ jsonContent, onChange, globalPrompts, canManagePromptLibrary }: PromptEditorProps) {
    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [selectedTab, setSelectedTab] = useState("all");
    const [intents, setIntents] = useState<string[]>([]);

    // Combine Local + Global for display
    const allKeys = Array.from(new Set([...Object.keys(prompts), ...Object.keys(globalPrompts || {})]));
    const effectivePrompts: Record<string, { val: string, isGlobal: boolean, isOverride: boolean }> = {};

    allKeys.forEach(key => {
        const local = prompts[key];
        const global = globalPrompts?.[key];

        if (local !== undefined) {
            effectivePrompts[key] = { val: local, isGlobal: false, isOverride: !!global };
        } else if (global !== undefined) {
            effectivePrompts[key] = { val: global, isGlobal: true, isOverride: false };
        }
    });

    const [library, setLibrary] = useState<{ name: string, category: string, subcategory?: string, text: string, suggested_key?: string }[]>([]);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [librarySearch, setLibrarySearch] = useState("");
    const [libraryTab, setLibraryTab] = useState<'all' | 'persona' | 'interaction' | 'workflow' | 'instruction'>('all');
    const [workflowFilter, setWorkflowFilter] = useState("all");
    const [isLibraryManagerOpen, setIsLibraryManagerOpen] = useState(false);
    const [libraryJson, setLibraryJson] = useState<string>("");
    const [librarySaveError, setLibrarySaveError] = useState<string>("");

    useEffect(() => {
        setPrompts(jsonContent.prompts || {});
        setIntents((jsonContent.intents || []).filter((intent: string) => intent !== "general"));
    }, [jsonContent]);

    useEffect(() => {
        fetch(`/api/config?type=prompt_library&_t=${Date.now()}`)
            .then(res => res.json())
            .then(data => {
                setLibrary(data.prompts || []);
                setLibraryJson(JSON.stringify(data, null, 2));
            })
            .catch(err => console.error("Failed to load library", err));
    }, []);

    const handleUpdate = (key: string, val: string) => {
        const updated = { ...prompts, [key]: val };
        setPrompts(updated);
        onChange({ ...jsonContent, prompts: updated });
    };

    const handleAdd = () => {
        const prefix = selectedTab !== 'all' ? `${selectedTab}_` : '';
        const key = prompt(`Enter new prompt key (will correspond to ${prefix}...):`, prefix);
        if (key && !prompts[key]) {
            handleUpdate(key, "New prompt text...");
        }
    };

    const addFromLibrary = (item: { name: string, text: string, suggested_key?: string }) => {
        const prefix = selectedTab !== 'all' ? `${selectedTab}_` : '';

        // Use suggested key if available, otherwise derive from name
        let defaultKey = item.suggested_key || (prefix + item.name.toLowerCase().replace(/\s+/g, '_'));

        // If we represent a specific intent tab and the suggested key doesn't have it, maybe pre-pend?
        // Actually, suggested_key usually implies a specific system function (like 'ask_intent_retry_giveup'), so we should trust it.
        // But if it's a generic persona without a key, we might want to respect the tab prefix.
        if (!item.suggested_key && prefix) {
            defaultKey = prefix + item.name.toLowerCase().replace(/\s+/g, '_');
        }

        const key = prompt(`Confirm prompt key for "${item.name}":`, defaultKey);

        if (key) {
            // Confirm override if exists
            if (prompts[key] && !confirm(`Prompt "${key}" already exists. Overwrite?`)) return;
            handleUpdate(key, item.text);
            setIsLibraryOpen(false);
        }
    };

    const handleDelete = (key: string) => {
        const { [key]: _, ...rest } = prompts;
        setPrompts(rest);
        onChange({ ...jsonContent, prompts: rest });
    };

    // Filter prompts based on selected tab
    const filteredPrompts = Object.entries(effectivePrompts).filter(([key]) => {
        if (selectedTab === 'all') return true;

        // Check if key starts with any intent name OR equals it
        const matchedIntent = intents.find(intent => key === intent || key.startsWith(`${intent}_`));
        if (selectedTab === 'first_response') {
            // Back-compat: include legacy unscoped/general prompts in Initial Response.
            return key === selectedTab || key.startsWith(`${selectedTab}_`) || !matchedIntent;
        }

        return key === selectedTab || key.startsWith(`${selectedTab}_`);
    });

    return (
        <div className="p-6 bg-gray-900 h-full overflow-y-auto relative">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-blue-400 flex items-center gap-2">
                    <MessageSquare size={20} />
                    Prompt Manager
                </h3>
                <div className="flex gap-2">
                    <button onClick={() => setIsLibraryOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition">
                        <span className="text-yellow-400">★</span> Library
                    </button>
                    {canManagePromptLibrary && (
                        <button onClick={() => setIsLibraryManagerOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-sm transition">
                            Manage Library
                        </button>
                    )}
                    <button onClick={handleAdd} className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition">
                        <Plus size={16} /> Add Prompt
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 flex-wrap border-b border-gray-700 pb-2">
                <button
                    onClick={() => setSelectedTab('all')}
                    className={`px-3 py-1 rounded text-sm ${selectedTab === 'all' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                    All
                </button>
                {intents.map(intent => (
                    <button
                        key={intent}
                        onClick={() => setSelectedTab(intent)}
                        className={`px-3 py-1 rounded text-sm ${selectedTab === intent ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                        {intent === 'first_response' ? 'Initial Response' : intent.charAt(0).toUpperCase() + intent.slice(1)}
                    </button>
                ))}
                <button
                    onClick={() => setSelectedTab('behaviors')}
                    className={`px-3 py-1 rounded text-sm ${selectedTab === 'behaviors' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                    Behaviors
                </button>
            </div>

            <div className="space-y-4">
                {filteredPrompts.sort().map(([key, data]) => (
                    <div key={key} className={`p-4 rounded border ${data.isGlobal && !data.isOverride ? 'bg-gray-800 border-gray-700 opacity-75' : 'bg-gray-800 border-blue-900'}`}>
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                                <label className="text-sm font-mono text-yellow-500 font-bold block">{key}</label>
                                {data.isGlobal && !data.isOverride && <span className="text-[10px] bg-gray-600 text-white px-1 rounded">GLOBAL</span>}
                                {data.isOverride && <span className="text-[10px] bg-blue-900 text-blue-200 px-1 rounded">OVERRIDE</span>}
                            </div>
                            <button onClick={() => handleDelete(key)} className="text-gray-500 hover:text-red-400">
                                <Trash2 size={16} />
                            </button>
                        </div>
                        <textarea
                            className={`w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm text-gray-200 focus:border-blue-500 outline-none resize-none h-24 ${data.isGlobal && !data.isOverride ? 'italic text-gray-400' : ''}`}
                            value={data.val}
                            onChange={(e) => handleUpdate(key, e.target.value)}
                            placeholder="Enter prompt text..."
                        />
                    </div>
                ))}

                {selectedTab === 'behaviors' && (
                    <div className="p-4 rounded border bg-gray-800 border-purple-900">
                        <div className="flex justify-between items-start mb-2">
                            <label className="text-sm font-mono text-purple-400 font-bold block">System Instructions / Behaviors</label>
                        </div>
                        <p className="text-xs text-gray-400 mb-2 italic">
                            These instructions guide the overall behavior of the agent (e.g., how to handle dates, when to be concise).
                        </p>
                        <textarea
                            className="w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm text-gray-200 focus:border-purple-500 outline-none resize-none h-48"
                            value={jsonContent.system_instructions || ""}
                            onChange={(e) => onChange({ ...jsonContent, system_instructions: e.target.value })}
                            placeholder="e.g., Always confirm dates by day of week. Be concise but warm..."
                        />
                    </div>
                )}

                {selectedTab !== 'behaviors' && filteredPrompts.length === 0 && (
                    <div className="text-gray-500 text-center py-10 italic">
                        No prompts found for this filter.
                    </div>
                )}
            </div>

            {/* Library Modal */}
            {isLibraryOpen && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-gray-800 border border-gray-600 rounded-lg w-[700px] max-h-[85vh] flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900 rounded-t-lg">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <span className="text-yellow-400">★</span> Prompt Library
                                </h3>
                                <p className="text-xs text-gray-400">Select a prompt to insert it into your configuration.</p>
                            </div>
                            <button onClick={() => setIsLibraryOpen(false)} className="text-gray-400 hover:text-white transition">✕</button>
                        </div>

                        {/* Library Controls */}
                        <div className="p-4 border-b border-gray-700 bg-gray-800 space-y-3">
                            {/* Search */}
                            <input
                                type="text"
                                placeholder="Search library..."
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:border-blue-500 outline-none"
                                value={librarySearch}
                                onChange={(e) => setLibrarySearch(e.target.value)}
                                autoFocus
                            />

                            {/* Tabs */}
                            <div className="flex gap-1 bg-gray-900 p-1 rounded">
                                {[
                                    { id: 'all', label: 'All' },
                                    { id: 'persona', label: 'Personas' },
                                    { id: 'interaction', label: 'General' },
                                    { id: 'workflow', label: 'Specific' },
                                    { id: 'instruction', label: 'Instructions' }
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            setLibraryTab(tab.id as any);
                                            setWorkflowFilter('all'); // Reset sub-filter when changing tabs
                                        }}
                                        className={`flex-1 py-1.5 text-sm font-medium rounded transition ${libraryTab === tab.id ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Sub-filter for Workflows */}
                            {libraryTab === 'workflow' && (
                                <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-700">
                                    {['all', ...Array.from(new Set(library.filter(i => i.category === 'Workflow').map(i => i.subcategory || 'Other')))].map(sub => (
                                        <button
                                            key={sub}
                                            onClick={() => setWorkflowFilter(sub)}
                                            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap border ${workflowFilter === sub ? 'bg-blue-900/50 border-blue-500 text-blue-200' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'}`}
                                        >
                                            {sub === 'all' ? 'All Types' : sub}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-900">
                            {library.filter(item => {
                                const matchesSearch = item.name.toLowerCase().includes(librarySearch.toLowerCase()) ||
                                    item.category.toLowerCase().includes(librarySearch.toLowerCase()) ||
                                    (item.suggested_key && item.suggested_key.toLowerCase().includes(librarySearch.toLowerCase()));

                                if (!matchesSearch) return false;

                                if (libraryTab === 'persona') return item.category === 'Persona';
                                if (libraryTab === 'interaction') return item.category === 'Standard Interaction' || item.category === 'Utility';
                                if (libraryTab === 'workflow') return item.category === 'Specific' || item.category === 'Workflow';
                                if (libraryTab === 'instruction') return item.category === 'Standard Instruction' || item.category === 'Instruction';

                                // 'all' returns everything
                                return true;
                            }).map((item, idx) => (
                                <div key={idx} className="bg-gray-800 border border-gray-700 p-4 rounded hover:border-blue-500 hover:ring-1 hover:ring-blue-500 cursor-pointer group transition" onClick={() => addFromLibrary(item)}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-blue-400 group-hover:text-blue-300 text-base">{item.name}</span>
                                            {item.suggested_key && (
                                                <code className="text-xs text-yellow-600 bg-yellow-900/20 px-1 py-0.5 rounded mt-1 w-fit">
                                                    Key: {item.suggested_key}
                                                </code>
                                            )}
                                        </div>
                                        <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${item.category === 'Persona' ? 'bg-purple-900 text-purple-200' : 'bg-gray-700 text-gray-300'}`}>
                                            {item.category}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-300 line-clamp-3 bg-gray-900/50 p-2 rounded border border-gray-700/50 italic">
                                        "{item.text}"
                                    </p>
                                </div>
                            ))}
                            {library.length === 0 && <p className="text-gray-500 text-center">Loading library...</p>}
                        </div>
                    </div>
                </div>
            )}

            {isLibraryManagerOpen && canManagePromptLibrary && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-gray-800 border border-gray-600 rounded-lg w-[720px] max-h-[85vh] flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900 rounded-t-lg">
                            <div>
                                <h3 className="text-lg font-bold text-white">Prompt Library Manager</h3>
                                <p className="text-xs text-gray-400">Edit the shared prompt library JSON.</p>
                            </div>
                            <button onClick={() => setIsLibraryManagerOpen(false)} className="text-gray-400 hover:text-white transition">✕</button>
                        </div>
                        <div className="p-4 bg-gray-900 flex-1 overflow-y-auto">
                            <textarea
                                className="w-full h-[50vh] bg-gray-900 border border-gray-700 p-3 rounded text-sm text-gray-200 font-mono focus:border-purple-500 outline-none resize-none"
                                value={libraryJson}
                                onChange={(e) => setLibraryJson(e.target.value)}
                            />
                            {librarySaveError && (
                                <div className="mt-2 text-xs text-red-400">{librarySaveError}</div>
                            )}
                        </div>
                        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
                            <button
                                onClick={() => setIsLibraryManagerOpen(false)}
                                className="px-4 py-2 text-gray-400 hover:text-white transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    setLibrarySaveError("");
                                    try {
                                        const parsed = JSON.parse(libraryJson);
                                        const res = await fetch("/api/config", {
                                            method: "POST",
                                            body: JSON.stringify({ action: "save", type: "prompt_library", content: parsed })
                                        });
                                        if (!res.ok) {
                                            const err = await res.json().catch(() => null);
                                            throw new Error(err?.error || "Failed to save library");
                                        }
                                        setIsLibraryManagerOpen(false);
                                        setLibrary(parsed.prompts || []);
                                    } catch (e: any) {
                                        setLibrarySaveError(e?.message || "Invalid JSON");
                                    }
                                }}
                                className="px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded"
                            >
                                Save Library
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
