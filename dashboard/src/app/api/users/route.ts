
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser } from "@/lib/auth";
import { getConfigPath } from '@/lib/config';
import { getUserPermissions, isGlobalAdmin, isSuperAdmin } from "@/lib/rbac";

export const dynamic = 'force-dynamic';

function getUsersPath() {
    return path.join(getConfigPath(), 'users.json');
}

function readUsers() {
    const p = getUsersPath();
    if (!fs.existsSync(p)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return data.users || [];
    } catch (e) {
        return [];
    }
}

function saveUsers(users: any[]) {
    const p = getUsersPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(p, JSON.stringify({ users }, null, 2));
}

function normalizeEmail(email: string) {
    return String(email || "").trim().toLowerCase();
}

function normalizeRole(role: any): "global_admin" | "admin" | "user" {
    const r = String(role || "user").trim().toLowerCase();
    if (r === "global_admin" || r === "admin" || r === "user") return r as any;
    return "user";
}

// Audit Log Helper (Shared logic, effectively)
function logAudit(user: any, action: string, details: any) {
    try {
        const auditPath = path.join(getConfigPath(), 'audit_log.json');
        let logs = [];
        if (fs.existsSync(auditPath)) {
            logs = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
        }
        logs.push({
            timestamp: new Date().toISOString(),
            userId: user.id,
            username: user.name,
            action,
            details
        });
        if (logs.length > 1000) logs = logs.slice(logs.length - 1000);
        fs.writeFileSync(auditPath, JSON.stringify(logs, null, 2));
    } catch (e) {
        console.error("Audit log failed", e);
    }
}

export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGlobalAdmin(user)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = readUsers();
    // Return sanitized users (no hash)
    const sanitized = users.map((u: any) => ({
        id: u.id,
        username: u.username,
        email: u.email || u.username,
        name: u.name,
        role: u.role,
        allowed_clients: u.allowed_clients,
        allowed_industries: u.allowed_industries || [],
        permissions: getUserPermissions(u)
    }));

    return NextResponse.json(sanitized);
}

export async function POST(req: NextRequest) {
    const requestingUser = await getAuthenticatedUser();
    if (!requestingUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGlobalAdmin(requestingUser)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { action, userData } = body;
        // userData: { id?, email, password?, name, role, allowed_clients, allowed_industries, permissions }

        const users = readUsers();

        if (action === 'create') {
            const email = normalizeEmail(userData.email);
            if (!email || !userData.password) {
                return NextResponse.json({ error: 'Email and Password required' }, { status: 400 });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
            }
            if (users.find((u: any) => normalizeEmail(u.email || u.username) === email)) {
                return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
            }

            const role = normalizeRole(userData.role);
            const allowedClients = userData.allowed_clients || [];
            const allowedIndustries = userData.allowed_industries || [];
            if (role === "admin" && (allowedClients.includes("*") || allowedIndustries.includes("*"))) {
                return NextResponse.json({ error: 'Admin role cannot have global wildcard access' }, { status: 400 });
            }
            const hash = await bcrypt.hash(userData.password, 10);
            const newUser = {
                id: Date.now().toString(),
                username: email,
                email,
                password_hash: hash,
                name: userData.name || email,
                role,
                allowed_clients: role === "global_admin" ? ["*"] : allowedClients,
                allowed_industries: role === "global_admin" ? ["*"] : allowedIndustries,
                permissions: userData.permissions || {}
            };

            users.push(newUser);
            saveUsers(users);
            logAudit(requestingUser, 'create_user', { username: newUser.username });
            return NextResponse.json({ success: true, user: newUser });
        }

        if (action === 'update') {
            if (!userData.id) return NextResponse.json({ error: 'User ID required' }, { status: 400 });

            const index = users.findIndex((u: any) => u.id === userData.id);
            if (index === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

            const targetUser = users[index];

            // Update fields if provided
            if (Object.prototype.hasOwnProperty.call(userData, "email")) {
                const email = normalizeEmail(userData.email);
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
                }
                const conflict = users.find((u: any) => u.id !== userData.id && normalizeEmail(u.email || u.username) === email);
                if (conflict) {
                    return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
                }
                targetUser.email = email;
                targetUser.username = email;
            }
            if (userData.name) targetUser.name = userData.name;
            if (userData.role) targetUser.role = normalizeRole(userData.role);
            if (Object.prototype.hasOwnProperty.call(userData, "allowed_clients")) {
                targetUser.allowed_clients = userData.allowed_clients;
            }
            if (Object.prototype.hasOwnProperty.call(userData, "allowed_industries")) {
                targetUser.allowed_industries = userData.allowed_industries;
            }
            if (Object.prototype.hasOwnProperty.call(userData, "permissions")) {
                targetUser.permissions = userData.permissions || {};
            }
            if (targetUser.role === "global_admin") {
                targetUser.allowed_clients = ["*"];
                targetUser.allowed_industries = ["*"];
                targetUser.permissions = {};
            } else if (targetUser.role === "admin" && ((targetUser.allowed_clients || []).includes("*") || (targetUser.allowed_industries || []).includes("*"))) {
                return NextResponse.json({ error: 'Admin role cannot have global wildcard access' }, { status: 400 });
            }

            if (!Object.prototype.hasOwnProperty.call(userData, "permissions") && userData.role && isSuperAdmin(targetUser)) {
                targetUser.permissions = {};
            }

            // Password update (only if provided)
            if (userData.password && userData.password.trim() !== '') {
                targetUser.password_hash = await bcrypt.hash(userData.password, 10);
            }

            users[index] = targetUser;
            saveUsers(users);
            logAudit(requestingUser, 'update_user', { username: targetUser.username, updates: userData });
            return NextResponse.json({ success: true });
        }

        if (action === 'delete') {
            if (!userData.id) return NextResponse.json({ error: 'User ID required' }, { status: 400 });
            if (userData.id === requestingUser.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });

            const newUsers = users.filter((u: any) => u.id !== userData.id);
            saveUsers(newUsers);
            logAudit(requestingUser, 'delete_user', { userId: userData.id });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (error) {
        console.error("User API Error", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
