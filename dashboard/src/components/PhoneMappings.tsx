"use client";

import { useState, useEffect } from "react";
import { Phone, Plus, Trash2, Edit2, Save, X } from "lucide-react";

type Mapping = {
    client_id: string;
    industry: string;
};

type PhoneMappingsData = {
    mappings: Record<string, Mapping>;
};

type Props = {
    industries: string[];
    clients: Record<string, string[]>;
    onSave: (data: PhoneMappingsData) => void;
    readOnly?: boolean;
};

export default function PhoneMappings({ industries, clients, onSave, readOnly = false }: Props) {
    const [mappings, setMappings] = useState<Record<string, Mapping>>({});
    const [loading, setLoading] = useState(true);

    // Form State
    const [phoneNumber, setPhoneNumber] = useState("");
    const [industry, setIndustry] = useState("");
    const [client, setClient] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [originalNumber, setOriginalNumber] = useState(""); // Track number being edited

    useEffect(() => {
        fetchMappings();
    }, []);

    async function fetchMappings() {
        try {
            // Added timestamp to prevent browser caching
            const res = await fetch(`/api/config?type=phone_mappings&_t=${Date.now()}`, {
                cache: 'no-store'
            });
            const data = await res.json();
            setMappings(data.mappings || {});
        } catch (e) {
            console.error("Failed to fetch mappings", e);
        } finally {
            setLoading(false);
        }
    }

    const handleAddOrUpdate = () => {
        if (readOnly) return;
        if (!phoneNumber || !industry || !client) return;

        // Simple E.164 validation (starts with +)
        if (!phoneNumber.startsWith("+")) {
            alert("Phone number should be in E.164 format (e.g., +44123456789)");
            return;
        }

        const updated = { ...mappings };

        // If editing and the number changed, delete the old key
        if (isEditing && originalNumber !== phoneNumber) {
            delete updated[originalNumber];
        }

        updated[phoneNumber] = {
            client_id: client,
            industry: industry,
        };

        setMappings(updated);
        onSave({ mappings: updated });

        resetForm();
    };

    const handleEdit = (number: string) => {
        if (readOnly) return;
        const data = mappings[number];
        if (!data) return;

        setPhoneNumber(number);
        setOriginalNumber(number);
        setIndustry(data.industry);
        setClient(data.client_id);
        setIsEditing(true);

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleRemove = (number: string) => {
        if (readOnly) return;
        if (!confirm(`Are you sure you want to delete the mapping for ${number}?`)) return;

        const updated = { ...mappings };
        delete updated[number];
        setMappings(updated);
        onSave({ mappings: updated });

        if (isEditing && originalNumber === number) {
            resetForm();
        }
    };

    const resetForm = () => {
        setPhoneNumber("");
        setIndustry("");
        setClient("");
        setOriginalNumber("");
        setIsEditing(false);
    };

    if (loading) return <div className="p-10 text-gray-400">Loading mappings...</div>;

    return (
        <div className="h-full overflow-y-auto bg-gray-900 p-6">
            <div className="max-w-4xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Phone className="text-blue-400" />
                        Phone Number Routing
                    </h2>
                </div>

                <p className="text-gray-400 text-sm italic">
                    Map incoming Twilio phone numbers to specific client configurations.
                    Numbers should be in E.164 format (e.g. +447123456789).
                </p>
                {readOnly && (
                    <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-300">
                        Read-only mode. You can view mappings but cannot edit them.
                    </div>
                )}

                {/* Add/Edit Section */}
                <section className={`rounded-lg p-6 border ${isEditing ? 'bg-blue-900/10 border-blue-500' : 'bg-gray-800 border-gray-700'}`}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className={`text-lg font-semibold ${isEditing ? 'text-blue-300' : 'text-blue-400'}`}>
                            {isEditing ? 'Edit Mapping' : 'Add New Mapping'}
                        </h3>
                        {isEditing && (
                            <button onClick={resetForm} className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
                                <X size={14} /> Cancel Edit
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-4 gap-4 items-end">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                            <input
                                type="text"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                placeholder="+44..."
                                disabled={readOnly}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Industry</label>
                            <select
                                value={industry}
                                onChange={(e) => {
                                    setIndustry(e.target.value);
                                    setClient("");
                                }}
                                disabled={readOnly}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                            >
                                <option value="">Select Industry...</option>
                                {industries.map(ind => (
                                    <option key={ind} value={ind}>{ind}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">Client</label>
                            <select
                                value={client}
                                disabled={!industry || readOnly}
                                onChange={(e) => setClient(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                            >
                                <option value="">Select Client...</option>
                                {industry && clients[industry]?.map(cli => (
                                    <option key={cli} value={cli}>{cli}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={handleAddOrUpdate}
                            disabled={readOnly || !phoneNumber || !industry || !client}
                            className={`flex items-center justify-center gap-2 px-4 py-2 rounded font-medium transition text-white ${isEditing
                                    ? 'bg-green-600 hover:bg-green-500 disabled:bg-gray-700'
                                    : 'bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700'
                                } disabled:text-gray-500`}
                        >
                            {isEditing ? <><Save size={18} /> Update</> : <><Plus size={18} /> Add</>}
                        </button>
                    </div>
                </section>

                {/* Existing Mappings */}
                <section className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                    <table className="w-full text-left">
                        <thead className="bg-gray-700 text-gray-300 text-sm font-semibold">
                            <tr>
                                <th className="px-6 py-3">Phone Number</th>
                                <th className="px-6 py-3">Client Configuration</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {Object.entries(mappings).length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-6 py-10 text-center text-gray-500 italic">No phone mappings defined yet</td>
                                </tr>
                            ) : (
                                Object.entries(mappings).map(([number, data]) => (
                                    <tr key={number} className={`hover:bg-gray-750/50 group ${isEditing && originalNumber === number ? 'bg-blue-900/20' : ''}`}>
                                        <td className="px-6 py-4 font-mono text-blue-400">{number}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className="text-gray-300">{data.client_id}</span>
                                                <span className="text-gray-500 text-xs px-1.5 py-0.5 bg-gray-900 rounded border border-gray-700">{data.industry}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleEdit(number)}
                                                    className={`text-gray-500 transition ${readOnly ? 'opacity-40 cursor-not-allowed' : 'hover:text-blue-400'}`}
                                                    title="Edit Mapping"
                                                    disabled={readOnly}
                                                >
                                                    <Edit2 size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleRemove(number)}
                                                    className={`text-gray-500 transition ${readOnly ? 'opacity-40 cursor-not-allowed' : 'hover:text-red-400'}`}
                                                    title="Remove Mapping"
                                                    disabled={readOnly}
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </section>

                <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
                    <p className="text-sm text-blue-300">
                        <strong>Important:</strong> Changes made here are synced to the local `phone_mappings.json` file.
                        Ensure your Twilio webhooks are pointing to your server's `/api/incoming-call` endpoint for these mappings to take effect.
                    </p>
                </div>
            </div>
        </div>
    );
}
