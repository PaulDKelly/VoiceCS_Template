"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Edit2, User, Save, X } from "lucide-react";

type UserType = {
    id: string;
    username: string;
    email?: string;
    name: string;
    role: "global_admin" | "admin" | "user";
    allowed_clients: string[];
    allowed_industries: string[];
    permissions: {
        can_edit_clients: boolean;
        can_edit_industries: boolean;
        can_view_phone_mappings: boolean;
        can_edit_phone_mappings: boolean;
        can_manage_users: boolean;
        can_manage_prompt_library: boolean;
        can_manage_voice_library: boolean;
        can_view_history: boolean;
        can_revert_history: boolean;
    };
};

const defaultUserPermissions = {
    can_edit_clients: true,
    can_edit_industries: false,
    can_view_phone_mappings: false,
    can_edit_phone_mappings: false,
    can_manage_users: false,
    can_manage_prompt_library: false,
    can_manage_voice_library: false,
    can_view_history: true,
    can_revert_history: false
};

const permissionLabels: Record<string, string> = {
    can_edit_clients: "edit clients",
    can_view_phone_mappings: "view phone",
    can_edit_phone_mappings: "edit phone",
    can_manage_users: "manage users",
    can_manage_prompt_library: "manage library",
    can_manage_voice_library: "manage voices",
    can_view_history: "view history",
    can_revert_history: "revert"
};

const roleLabel: Record<UserType["role"], string> = {
    global_admin: "Global Admin",
    admin: "Admin",
    user: "User"
};

export default function UserManagement() {
    const [users, setUsers] = useState<UserType[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editUser, setEditUser] = useState<UserType | null>(null); // Null = Create Mode

    // Form State
    const [formData, setFormData] = useState({
        email: "",
        name: "",
        password: "",
        role: "user" as "global_admin" | "admin" | "user",
        allowed_clients: "", // Comma separated string for input
        allowed_industries: "",
        permissions: { ...defaultUserPermissions }
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    async function fetchUsers() {
        try {
            setLoading(true);
            const res = await fetch("/api/users");
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
            } else {
                setError("Failed to load users");
            }
        } catch (e) {
            setError("Network error");
        } finally {
            setLoading(false);
        }
    }

    function openCreateModal() {
        setEditUser(null);
        setFormData({
            email: "",
            name: "",
            password: "", // Required for create
            role: "user",
            allowed_clients: "",
            allowed_industries: "",
            permissions: { ...defaultUserPermissions }
        });
        setIsModalOpen(true);
        setError("");
    }

    function openEditModal(user: UserType) {
        setEditUser(user);
        setFormData({
            email: user.email || user.username,
            name: user.name,
            password: "", // Optional for update
            role: user.role,
            allowed_clients: user.allowed_clients.join(", "),
            allowed_industries: (user.allowed_industries || []).join(", "),
            permissions: user.permissions || { ...defaultUserPermissions }
        });
        setIsModalOpen(true);
        setError("");
    }

    async function handleSubmit() {
        if (!formData.email) {
            setError("Email is required");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
            setError("Valid email is required");
            return;
        }
        if (!editUser && !formData.password) {
            setError("Password is required for new users");
            return;
        }

        const payload = {
            userData: {
                id: editUser?.id, // Undefined for create
                email: formData.email,
                name: formData.name,
                password: formData.password,
                role: formData.role,
                allowed_clients: formData.allowed_clients.split(",").map(c => c.trim()).filter(Boolean),
                allowed_industries: formData.allowed_industries.split(",").map(c => c.trim()).filter(Boolean),
                permissions: formData.permissions
            },
            action: editUser ? 'update' : 'create'
        };

        try {
            const res = await fetch("/api/users", {
                method: "POST",
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setIsModalOpen(false);
                fetchUsers();
            } else {
                const err = await res.json();
                setError(err.error || "Operation failed");
            }
        } catch (e) {
            setError("Network error");
        }
    }

    const permissionsLockedForGlobalAdmin = formData.role === "global_admin";

    async function deleteUser(id: string) {
        if (!confirm("Are you sure you want to delete this user?")) return;

        const res = await fetch("/api/users", {
            method: "POST",
            body: JSON.stringify({ action: 'delete', userData: { id } })
        });

        if (res.ok) {
            fetchUsers();
        } else {
            alert("Failed to delete");
        }
    }

    if (loading) return <div className="text-gray-400">Loading users...</div>;

    return (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <User size={20} className="text-blue-400" />
                    User Management
                </h3>
                <button onClick={openCreateModal} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded text-sm transition">
                    <Plus size={16} /> Add User
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-400">
                    <thead className="bg-gray-900/50 uppercase text-xs text-gray-500 font-semibold">
                        <tr>
                            <th className="px-4 py-3">User</th>
                            <th className="px-4 py-3">Role</th>
                            <th className="px-4 py-3">Access</th>
                            <th className="px-4 py-3">Permissions</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => (
                            <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition">
                                <td className="px-4 py-3 text-white">
                                    <div className="font-medium">{u.email || u.username}</div>
                                    <div className="text-xs text-gray-500">{u.name}</div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-0.5 rounded text-xs border ${
                                        u.role === 'global_admin'
                                            ? 'bg-red-900/30 border-red-800 text-red-300'
                                            : u.role === 'admin'
                                                ? 'bg-orange-900/30 border-orange-800 text-orange-300'
                                                : 'bg-blue-900/30 border-blue-800 text-blue-300'
                                        }`}>
                                        {roleLabel[u.role]}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="space-y-1">
                                        {u.allowed_industries?.includes("*") ? (
                                            <div className="text-green-400 font-mono text-xs">ALL INDUSTRIES</div>
                                        ) : (
                                            <div className="flex flex-wrap gap-1">
                                                {(u.allowed_industries || []).map(c => (
                                                    <span key={c} className="bg-gray-700 px-1.5 rounded text-xs font-mono">{c}</span>
                                                ))}
                                            </div>
                                        )}
                                        {u.allowed_clients.includes("*") ? (
                                            <div className="text-green-400 font-mono text-xs">ALL CLIENTS</div>
                                        ) : (
                                            <div className="flex flex-wrap gap-1">
                                                {u.allowed_clients.map(c => (
                                                    <span key={c} className="bg-gray-700 px-1.5 rounded text-xs font-mono">{c}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1 text-xs">
                                        {Object.entries(permissionLabels).map(([key, label]) => {
                                            const enabled = u.permissions?.[key as keyof typeof u.permissions];
                                            if (!enabled) return null;
                                            return (
                                                <span key={key} className="bg-blue-900/30 border border-blue-800 text-blue-300 px-1.5 rounded">{label}</span>
                                            );
                                        })}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => openEditModal(u)} className="text-gray-400 hover:text-white p-1" title="Edit">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => deleteUser(u.id)} className="text-gray-400 hover:text-red-400 p-1" title="Delete">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-full max-w-md p-6">
                        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            {editUser ? <Edit2 size={24} className="text-blue-400" /> : <Plus size={24} className="text-green-400" />}
                            {editUser ? "Edit User" : "Create User"}
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                />
                                <div className="text-[10px] text-gray-500 mt-1">
                                    This email is used to sign in.
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Display Name</label>
                                <input
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Password {editUser && <span className="text-xs text-gray-500">(Leave blank to keep current)</span>}</label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                    placeholder={editUser ? "********" : "New Password"}
                                />
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm text-gray-400 mb-1">Role</label>
                                    <select
                                        value={formData.role}
                                        onChange={e => {
                                            const role = e.target.value as "global_admin" | "admin" | "user";
                                            setFormData({
                                                ...formData,
                                                role,
                                                permissions: role === "global_admin"
                                                    ? {
                                                        can_edit_clients: true,
                                                        can_edit_industries: true,
                                                        can_view_phone_mappings: true,
                                                        can_edit_phone_mappings: true,
                                                        can_manage_users: true,
                                                        can_manage_prompt_library: true,
                                                        can_manage_voice_library: true,
                                                        can_view_history: true,
                                                        can_revert_history: true
                                                    }
                                                    : role === "admin"
                                                        ? { ...defaultUserPermissions, can_edit_clients: true, can_manage_prompt_library: true }
                                                        : { ...defaultUserPermissions }
                                            });
                                        }}
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                    >
                                        <option value="global_admin">Global Admin</option>
                                        <option value="admin">Admin (Client Scoped)</option>
                                        <option value="user">User</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Allowed Clients <span className="text-xs text-gray-500">(Comma separated, use * for all)</span></label>
                                <input
                                    value={formData.allowed_clients}
                                    onChange={e => setFormData({ ...formData, allowed_clients: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white font-mono text-sm"
                                    placeholder="autonova, client_b"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Allowed Industries <span className="text-xs text-gray-500">(Comma separated, use * for all)</span></label>
                                <input
                                    value={formData.allowed_industries}
                                    onChange={e => setFormData({ ...formData, allowed_industries: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white font-mono text-sm"
                                    placeholder="Automotive, Retail"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">Permissions</label>
                                <div className="grid grid-cols-2 gap-2 text-sm text-gray-300">
                                    {Object.entries(permissionLabels).map(([key, label]) => (
                                        <label key={key} className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={formData.permissions[key as keyof typeof formData.permissions] as boolean}
                                                disabled={permissionsLockedForGlobalAdmin}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    permissions: { ...formData.permissions, [key]: e.target.checked }
                                                })}
                                                className="accent-blue-500 disabled:opacity-50"
                                            />
                                            <span className="font-mono text-xs">{label}</span>
                                        </label>
                                    ))}
                                </div>
                                {permissionsLockedForGlobalAdmin && (
                                    <div className="text-xs text-gray-500 mt-2">
                                        Global admin always has full permissions.
                                    </div>
                                )}
                            </div>
                        </div>

                        {error && <div className="mt-4 p-2 bg-red-900/30 border border-red-800 text-red-300 text-sm rounded">{error}</div>}

                        <div className="mt-6 flex justify-end gap-3">
                            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-400 hover:text-white transition">Cancel</button>
                            <button onClick={handleSubmit} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition flex items-center gap-2">
                                <Save size={18} /> Save User
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
