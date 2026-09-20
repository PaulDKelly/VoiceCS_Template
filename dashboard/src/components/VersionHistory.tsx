"use client";

import { useState, useEffect } from "react";
import { History, RotateCcw, Clock, User, CheckCircle2 } from "lucide-react";

type Revision = {
    hash: string;
    timestamp: number;
    author: string;
    message: string;
};

type Props = {
    industry: string;
    client: string;
    canRevert: boolean;
    onRevert: () => void;
};

export default function VersionHistory({ industry, client, canRevert, onRevert }: Props) {
    const [history, setHistory] = useState<Revision[]>([]);
    const [loading, setLoading] = useState(true);
    const [reverting, setReverting] = useState<string | null>(null);

    useEffect(() => {
        fetchHistory();
    }, [industry, client]);

    async function fetchHistory() {
        setLoading(true);
        try {
            const res = await fetch(`/api/config?type=history&industry=${industry}&client=${client}`);
            if (res.ok) {
                const data = await res.json();
                setHistory(data);
            }
        } catch (e) {
            console.error("Failed to fetch history", e);
        } finally {
            setLoading(false);
        }
    }

    async function handleRevert(hash: string) {
        if (!confirm("Are you sure you want to revert to this version? Current changes will be lost.")) return;

        setReverting(hash);
        try {
            const res = await fetch("/api/config", {
                method: "POST",
                body: JSON.stringify({
                    action: "revert",
                    industry,
                    client,
                    hash,
                }),
            });

            if (res.ok) {
                onRevert(); // Callback to reload the main editor
            } else {
                const err = await res.json();
                alert("Revert failed: " + err.error);
            }
        } catch (e) {
            alert("Error reverting: " + String(e));
        } finally {
            setReverting(null);
        }
    }

    if (loading) return <div className="p-4 text-gray-500 italic">Loading history...</div>;

    return (
        <div className="bg-gray-800 border-l border-gray-700 w-80 flex flex-col h-full animate-in slide-in-from-right duration-300">
            <div className="p-4 border-b border-gray-700 bg-gray-900 flex items-center gap-2">
                <History size={18} className="text-blue-400" />
                <h3 className="font-semibold text-white text-sm">Version History</h3>
            </div>

            <div className="flex-1 overflow-y-auto">
                {history.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">
                        <Clock className="mx-auto mb-2 opacity-20" size={32} />
                        No history found for this client.
                    </div>
                ) : (
                    <div className="divide-y divide-gray-750">
                        {history.map((rev, idx) => (
                            <div key={rev.hash} className="p-4 hover:bg-gray-750 transition group">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-[10px] font-mono text-gray-500 uppercase">
                                        {rev.hash.substring(0, 7)}
                                    </span>
                                    {idx === 0 && (
                                        <span className="bg-green-900/30 text-green-400 text-[10px] px-1.5 py-0.5 rounded border border-green-800/50 flex items-center gap-1">
                                            <CheckCircle2 size={10} /> Active
                                        </span>
                                    )}
                                </div>

                                <p className="text-sm text-gray-200 line-clamp-2 leading-relaxed mb-2">
                                    {rev.message.replace("Dashboard update:", "").trim()}
                                </p>

                                <div className="flex items-center justify-between text-[11px] text-gray-500">
                                    <div className="flex flex-col gap-1">
                                        <span className="flex items-center gap-1">
                                            <User size={10} /> {rev.author}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Clock size={10} /> {new Date(rev.timestamp * 1000).toLocaleString()}
                                        </span>
                                    </div>

                                    {idx !== 0 && canRevert && (
                                        <button
                                            onClick={() => handleRevert(rev.hash)}
                                            disabled={!!reverting}
                                            className="opacity-0 group-hover:opacity-100 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-2 py-1 rounded border border-blue-500/30 transition flex items-center gap-1 disabled:opacity-50"
                                        >
                                            <RotateCcw size={12} />
                                            {reverting === rev.hash ? "..." : "Revert"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="p-4 bg-gray-900/50 border-t border-gray-700">
                <p className="text-[10px] text-gray-500 italic">
                    Every time you save, a new revision is created automatically using Git.
                </p>
            </div>
        </div>
    );
}
