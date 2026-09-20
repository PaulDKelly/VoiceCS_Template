export type UserPermissions = {
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

const GLOBAL_ADMIN_PERMISSIONS: UserPermissions = {
    can_edit_clients: true,
    can_edit_industries: true,
    can_view_phone_mappings: true,
    can_edit_phone_mappings: true,
    can_manage_users: true,
    can_manage_prompt_library: true,
    can_manage_voice_library: true,
    can_view_history: true,
    can_revert_history: true
};

const ADMIN_PERMISSIONS: UserPermissions = {
    can_edit_clients: true,
    can_edit_industries: false,
    can_view_phone_mappings: false,
    can_edit_phone_mappings: false,
    can_manage_users: false,
    can_manage_prompt_library: true,
    can_manage_voice_library: false,
    can_view_history: true,
    can_revert_history: false
};

const DEFAULT_USER_PERMISSIONS: UserPermissions = {
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

function normalizeList(values?: string[]) {
    if (!Array.isArray(values)) return [];
    return values.map(v => String(v).trim()).filter(Boolean);
}

function hasWildcard(values: string[]) {
    return values.includes("*");
}

export function normalizePermissions(role: string, permissions?: Partial<UserPermissions>): UserPermissions {
    if (role === "global_admin") return { ...GLOBAL_ADMIN_PERMISSIONS };
    if (role === "admin") return { ...ADMIN_PERMISSIONS, ...(permissions || {}) };
    return { ...DEFAULT_USER_PERMISSIONS, ...(permissions || {}) };
}

export function isGlobalAdmin(user: any) {
    if (user?.role === "global_admin") return true;
    // Legacy compatibility: treat old wildcard admin records as global admin.
    if (user?.role !== "admin") return false;
    const allowedIndustries = normalizeList(user?.allowed_industries);
    const allowedClients = normalizeList(user?.allowed_clients);
    return hasWildcard(allowedIndustries) || hasWildcard(allowedClients);
}

export function isAdminUser(user: any) {
    return user?.role === "admin" || isGlobalAdmin(user);
}

export function isSuperAdmin(user: any) {
    return isGlobalAdmin(user);
}

export function getUserPermissions(user: any): UserPermissions {
    if (isGlobalAdmin(user)) return { ...GLOBAL_ADMIN_PERMISSIONS };
    if (user?.role === "admin") return { ...ADMIN_PERMISSIONS, ...(user?.permissions || {}) };
    return { ...DEFAULT_USER_PERMISSIONS, ...(user?.permissions || {}) };
}

export function hasClientAccess(user: any, industry: string, client: string) {
    if (isSuperAdmin(user)) return true;

    const allowedIndustries = normalizeList(user?.allowed_industries);
    const allowedClients = normalizeList(user?.allowed_clients);

    if (hasWildcard(allowedIndustries)) return true;
    if (allowedIndustries.includes(industry)) return true;

    if (hasWildcard(allowedClients)) {
        return allowedIndustries.length === 0 || allowedIndustries.includes(industry);
    }

    if (allowedClients.includes(client)) return true;
    if (allowedClients.includes(`${industry}:${client}`)) return true;

    return false;
}

export function hasIndustryAccess(user: any, industry: string, clientsInIndustry: string[] = []) {
    if (isSuperAdmin(user)) return true;

    const allowedIndustries = normalizeList(user?.allowed_industries);
    const allowedClients = normalizeList(user?.allowed_clients);

    if (hasWildcard(allowedIndustries)) return true;
    if (allowedIndustries.includes(industry)) return true;

    if (hasWildcard(allowedClients)) {
        return allowedIndustries.length === 0 || allowedIndustries.includes(industry);
    }

    return clientsInIndustry.some(client => hasClientAccess(user, industry, client));
}

export function filterConfigListForUser(user: any, data: { industries: string[]; clients: Record<string, string[]> }) {
    if (isSuperAdmin(user)) return data;

    const allowedIndustries = normalizeList(user?.allowed_industries);
    const allowedClients = normalizeList(user?.allowed_clients);
    const restrictByIndustry = allowedIndustries.length > 0 && !hasWildcard(allowedIndustries);
    const allowAllClients = hasWildcard(allowedClients);

    const filteredClients: Record<string, string[]> = {};
    const filteredIndustries = data.industries.filter(industry => {
        const clientsInIndustry = data.clients[industry] || [];

        if (hasWildcard(allowedIndustries)) return true;
        if (allowedIndustries.includes(industry)) return true;

        if (allowAllClients) {
            return !restrictByIndustry || allowedIndustries.includes(industry);
        }

        return clientsInIndustry.some(client => hasClientAccess(user, industry, client));
    });

    filteredIndustries.forEach(industry => {
        const clientsInIndustry = data.clients[industry] || [];

        if (hasWildcard(allowedIndustries) || allowedIndustries.includes(industry)) {
            filteredClients[industry] = clientsInIndustry;
            return;
        }

        if (allowAllClients && (!restrictByIndustry || allowedIndustries.includes(industry))) {
            filteredClients[industry] = clientsInIndustry;
            return;
        }

        filteredClients[industry] = clientsInIndustry.filter(client => hasClientAccess(user, industry, client));
    });

    return { industries: filteredIndustries, clients: filteredClients };
}
