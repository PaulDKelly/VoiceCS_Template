import { NextRequest, NextResponse } from 'next/server';
import { listConfigurations, getClientConfigPath, getIndustryConfigPath, getGlobalPromptsPath, getConfigPath } from '@/lib/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getAuthenticatedUser } from "@/lib/auth";
import { filterConfigListForUser, getUserPermissions, hasClientAccess, hasIndustryAccess, isSuperAdmin } from "@/lib/rbac";

export const dynamic = 'force-dynamic';

type VoiceEntry = {
    name: string;
    provider: "elevenlabs" | "azure_neural";
    voice_id?: string;
    voice_name?: string;
    default?: boolean;
};

function getVoiceLibraryPath() {
    return path.join(getConfigPath(), 'voice_library.json');
}

function voiceKey(v: VoiceEntry) {
    const id = v.provider === "elevenlabs" ? (v.voice_id || "") : (v.voice_name || "");
    return `${v.provider}:${id}`;
}

function normalizeVoice(v: VoiceEntry): VoiceEntry | null {
    if (!v || !v.provider) return null;
    if (v.provider === "elevenlabs") {
        const id = (v.voice_id || "").trim();
        if (!id) return null;
        return {
            provider: "elevenlabs",
            voice_id: id,
            name: (v.name || id).trim(),
            default: !!v.default,
        };
    }
    const shortName = (v.voice_name || "").trim();
    if (!shortName) return null;
    return {
        provider: "azure_neural",
        voice_name: shortName,
        name: (v.name || shortName).trim(),
        default: !!v.default,
    };
}

function loadVoiceLibrary(): { voices: VoiceEntry[] } {
    const p = getVoiceLibraryPath();
    if (!fs.existsSync(p)) return { voices: [] };
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const voices = Array.isArray(parsed?.voices) ? parsed.voices : [];
    const normalized = voices
        .map((v: VoiceEntry) => normalizeVoice(v))
        .filter((v: VoiceEntry | null): v is VoiceEntry => !!v);
    return { voices: normalized };
}

function saveVoiceLibrary(lib: { voices: VoiceEntry[] }) {
    const p = getVoiceLibraryPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(lib, null, 2));
    return p;
}

function upsertVoices(existing: VoiceEntry[], incoming: VoiceEntry[]) {
    const map = new Map<string, VoiceEntry>();

    for (const raw of existing) {
        const v = normalizeVoice(raw);
        if (!v) continue;
        const k = voiceKey(v);
        if (!map.has(k)) map.set(k, v);
    }

    for (const raw of incoming) {
        const imported = normalizeVoice(raw);
        if (!imported) continue;
        const k = voiceKey(imported);
        const prev = map.get(k);
        if (!prev) {
            map.set(k, imported);
            continue;
        }
        // Preserve user-managed fields (name/default), but fill missing identifiers from import.
        map.set(k, {
            ...imported,
            ...prev,
            voice_id: prev.voice_id || imported.voice_id,
            voice_name: prev.voice_name || imported.voice_name,
        });
    }

    return Array.from(map.values());
}

async function importAzureGbVoices() {
    const region = (process.env.AZURE_SPEECH_REGION || "uksouth").trim();
    const key = process.env.AZURE_SPEECH_KEY;
    if (!key) {
        throw new Error("AZURE_SPEECH_KEY is not configured on the server.");
    }

    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
    const res = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": key },
        cache: "no-store",
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Azure voices import failed (${res.status}): ${txt || res.statusText}`);
    }

    const voices = await res.json().catch(() => []);
    const imported = (Array.isArray(voices) ? voices : [])
        .filter((v: any) => {
            const locale = String(v?.Locale || "");
            const shortName = String(v?.ShortName || "");
            const voiceType = String(v?.VoiceType || "");
            return (
                locale === "en-GB" &&
                (voiceType.toLowerCase() === "neural" || shortName.toLowerCase().includes("neural"))
            );
        })
        .map((v: any) => {
            const shortName = String(v?.ShortName || "").trim();
            return {
                provider: "azure_neural" as const,
                voice_name: shortName,
                name: shortName,
                default: false,
            };
        });

    return imported;
}

async function importElevenLabsVoices() {
    const importFromClientConfigs = () => {
        const root = path.join(getConfigPath(), "clients");
        const ids = new Set<string>();
        const walk = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const p = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(p);
                    continue;
                }
                if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
                try {
                    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
                    const id = String(parsed?.elevenlabs_voice_id || "").trim();
                    if (id) ids.add(id);
                } catch {
                    // skip unreadable client config
                }
            }
        };
        walk(root);
        return Array.from(ids).map((id) => ({
            provider: "elevenlabs" as const,
            voice_id: id,
            name: id,
            default: false,
        }));
    };

    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) {
        throw new Error("ELEVENLABS_API_KEY is not configured on the server.");
    }

    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": key },
        cache: "no-store",
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        // Common in production where key can synthesize but lacks voices_read permission.
        if (res.status === 401 && txt.includes("missing_permissions") && txt.includes("voices_read")) {
            const fallback = importFromClientConfigs();
            if (fallback.length > 0) return fallback;
        }
        throw new Error(`ElevenLabs voices import failed (${res.status}): ${txt || res.statusText}`);
    }

    const data = await res.json().catch(() => ({}));
    const voices = Array.isArray(data?.voices) ? data.voices : [];
    return voices
        .map((v: any) => {
            const id = String(v?.voice_id || "").trim();
            if (!id) return null;
            return {
                provider: "elevenlabs" as const,
                voice_id: id,
                // Keep label neutral; Admin can rename in UI.
                name: id,
                default: false,
            };
        })
        .filter((v: any) => !!v);
}

// Audit Log Helper
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
        // Keep last 1000 logs
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
    const permissions = getUserPermissions(user);

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type'); // 'list' | 'client' | 'industry'
    const industry = searchParams.get('industry');
    const client = searchParams.get('client');

    const userLabel = user.name || user.email || "unknown";
    console.log(`[API] GET type=${type}, industry=${industry}, client=${client}, user=${userLabel}`);

    try {
        if (type === 'list' || !type) {
            const data = await listConfigurations();
            const filtered = filterConfigListForUser(user, data);
            return NextResponse.json(filtered);
        }

        if (type === 'industry' && industry) {
            const data = await listConfigurations();
            const clientsInIndustry = data.clients[industry] || [];
            if (!hasIndustryAccess(user, industry, clientsInIndustry)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            const p = getIndustryConfigPath(industry);
            if (fs.existsSync(p)) {
                const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
                return NextResponse.json(content);
            }
            return NextResponse.json({}, { status: 404 });
        }

        if (type === 'client' && industry && client) {
            if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

            const p = getClientConfigPath(industry, client);
            if (fs.existsSync(p)) {
                const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
                return NextResponse.json(content);
            }
            return NextResponse.json({}, { status: 404 });
        }

        if (type === 'global_prompts') {
            // Admin only read?
            // if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            // Actually workflows might need it. Allow read.
            const p = getGlobalPromptsPath();
            if (fs.existsSync(p)) {
                const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
                return NextResponse.json(content);
            }
            return NextResponse.json({});
        }

        if (type === 'phone_mappings') {
            if (!permissions.can_view_phone_mappings && !isSuperAdmin(user)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            const p = path.join(getConfigPath(), 'phone_mappings.json');
            if (fs.existsSync(p)) {
                const content = JSON.parse(fs.readFileSync(p, 'utf-8'));

                if (isSuperAdmin(user)) {
                    return NextResponse.json(content);
                }

                const filteredMappings: Record<string, any> = {};
                Object.entries(content.mappings || {}).forEach(([number, mapping]) => {
                    const typed = mapping as { client_id: string; industry: string };
                    if (hasClientAccess(user, typed.industry, typed.client_id)) {
                        filteredMappings[number] = mapping;
                    }
                });
                return NextResponse.json({ mappings: filteredMappings });
            }
            return NextResponse.json({ mappings: {} });
        }

        if (type === 'prompt_library') {
            const p = path.join(getConfigPath(), 'prompt_library.json');
            if (fs.existsSync(p)) {
                const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
                return NextResponse.json(content);
            }
            return NextResponse.json({ prompts: [] });
        }

        if (type === 'voice_library') {
            const p = path.join(getConfigPath(), 'voice_library.json');
            if (fs.existsSync(p)) {
                const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
                return NextResponse.json(content);
            }
            return NextResponse.json({ voices: [] });
        }

        if (type === 'history' && industry && client) {
            if (!permissions.can_view_history && !isSuperAdmin(user)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            const p = getClientConfigPath(industry, client);
            if (!fs.existsSync(p)) return NextResponse.json([], { status: 404 });

            try {
                // Get git log for the specific file
                const output = execSync(`git log --pretty=format:"%H|%at|%an|%s" -- "${p}"`, { encoding: 'utf-8' });
                const history = output.split('\n').filter(Boolean).map(line => {
                    const [hash, timestamp, author, message] = line.split('|');
                    return { hash, timestamp: parseInt(timestamp), author, message };
                });
                return NextResponse.json(history);
            } catch (e) {
                console.error("Git log failed", e);
                return NextResponse.json([]);
            }
        }

        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });

    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = await getAuthenticatedUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getUserPermissions(user);

    try {
        const body = await req.json();
        const { action = 'save', type, industry, client, content, newName } = body;

        const userLabel = user.name || user.email || "unknown";
        console.log(`[API] POST action=${action} type=${type} industry=${industry} client=${client} user=${userLabel}`);

        // SAFEGUARD: Basic Validation
        if (action !== 'create_industry' && action !== 'import_voices' && type !== 'phone_mappings' && type !== 'prompt_library' && type !== 'voice_library' && !industry) {
            return NextResponse.json({ error: 'Industry is required' }, { status: 400 });
        }

        // RBAC Check
        if (action === 'save') {
            if (type === 'client' && client) {
                if (!permissions.can_edit_clients && !isSuperAdmin(user)) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
                if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            } else if (type === 'industry' || type === 'phone_mappings' || type === 'global_prompts' || type === 'prompt_library' || type === 'voice_library') {
                if (type === 'industry' && isSuperAdmin(user)) {
                    // admin only
                } else if (type === 'phone_mappings' && (permissions.can_edit_phone_mappings || isSuperAdmin(user))) {
                    // allowed
                } else if (type === 'prompt_library' && (permissions.can_manage_prompt_library || isSuperAdmin(user))) {
                    // allowed
                } else if (type === 'voice_library') {
                    // Admin-only (product requirement): do not allow non-admins even if permission flags are present.
                    if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                    if (!(permissions.can_manage_voice_library || isSuperAdmin(user))) {
                        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                    }
                } else if (type === 'global_prompts' && isSuperAdmin(user)) {
                    // allowed
                } else {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
            }
        } else {
            // Create/Delete actions restricted to Admin usually, 
            // but maybe creating a client is allowed if you have access to that industry? 
            // Implementing strict admin-only for creat/delete for now as per plan
            if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden: Admin Only' }, { status: 403 });
        }

        if (action === 'save') {
            let targetPath = '';
            if (type === 'industry') {
                targetPath = getIndustryConfigPath(industry);
            } else if (type === 'client' && client) {
                targetPath = getClientConfigPath(industry, client);
            } else if (type === 'phone_mappings') {
                targetPath = path.join(getConfigPath(), 'phone_mappings.json');
            } else if (type === 'prompt_library') {
                targetPath = path.join(getConfigPath(), 'prompt_library.json');
            } else if (type === 'voice_library') {
                targetPath = path.join(getConfigPath(), 'voice_library.json');
            } else {
                return NextResponse.json({ error: 'Invalid parameters for save' }, { status: 400 });
            }

            // Ensure dir exists
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            try {
                fs.writeFileSync(targetPath, JSON.stringify(content, null, 2));

                // AUDIT LOG
                logAudit(user, 'save', { type, industry, client, targetPath });

            } catch (e) {
                console.error(`[API] Failed to write file: ${targetPath}`, e);
                return NextResponse.json({ error: 'Failed to write file' }, { status: 500 });
            }

            // Revision System: Auto-commit to Git
            try {
                const relPath = path.relative(process.cwd(), targetPath);
                // Check if git is initialized
                if (fs.existsSync(path.join(process.cwd(), '.git'))) {
                    // Set author
                    const authorName = user.name || user.email || "unknown";
                    const authorSlug = authorName.replace(' ', '.');
                    const author = `${authorName} <${authorSlug}@voiceagent.local>`;

                    execSync(`git add "${relPath}"`);
                    // Use --author flag to attribute commit to the user
                    execSync(`git commit -m "Dashboard update: ${type} config for ${client || industry}" --author="${author}"`);
                    console.log(`[Revision] Committed ${relPath} by ${author}`);
                }
            } catch (e) {
                console.warn("[Revision] Git commit failed:", String(e));
            }

            return NextResponse.json({ success: true });
        }

        if (action === 'import_voices') {
            if (type !== 'voice_library') {
                return NextResponse.json({ error: 'Invalid type for import_voices' }, { status: 400 });
            }
            if (user.role !== 'admin') {
                return NextResponse.json({ error: 'Forbidden: Admin Only' }, { status: 403 });
            }
            if (!(permissions.can_manage_voice_library || isSuperAdmin(user))) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            const provider = String(body?.provider || "").toLowerCase();
            let imported: VoiceEntry[] = [];
            if (provider === 'azure_gb' || provider === 'azure_neural_gb') {
                imported = await importAzureGbVoices();
            } else if (provider === 'elevenlabs') {
                imported = await importElevenLabsVoices();
            } else {
                return NextResponse.json({ error: 'Invalid provider for import_voices' }, { status: 400 });
            }

            const existing = loadVoiceLibrary();
            const merged = upsertVoices(existing.voices || [], imported || []);
            const saved = { voices: merged };
            const targetPath = saveVoiceLibrary(saved);

            logAudit(user, 'import_voices', { provider, importedCount: imported.length, totalVoices: merged.length, targetPath });

            try {
                const relPath = path.relative(process.cwd(), targetPath);
                if (fs.existsSync(path.join(process.cwd(), '.git'))) {
                    const authorName = user.name || user.email || "unknown";
                    const authorSlug = authorName.replace(' ', '.');
                    const author = `${authorName} <${authorSlug}@voiceagent.local>`;
                    execSync(`git add "${relPath}"`);
                    execSync(`git commit -m "Dashboard import voices: ${provider}" --author="${author}"`);
                }
            } catch (e) {
                console.warn("[Revision] Git commit failed:", String(e));
            }

            return NextResponse.json({ success: true, provider, importedCount: imported.length, totalVoices: merged.length, voices: merged });
        }

        // ... (Create/Delete logic remains similar but protected by admin check above) ...
        // Re-implementing with fs calls and Audit Logs

        if (action === 'create_industry') {
            // Admin only (checked above)
            if (!newName) return NextResponse.json({ error: 'New Name required' }, { status: 400 });
            const defaultsPath = getIndustryConfigPath(newName);
            const dir = path.dirname(defaultsPath);
            if (fs.existsSync(dir)) return NextResponse.json({ error: 'Industry already exists' }, { status: 409 });
            fs.mkdirSync(dir, { recursive: true });

            const initialDefaults = { industry: newName, intents: ["general"], prompts: { "general": "..." }, workflows: {} };
            fs.writeFileSync(defaultsPath, JSON.stringify(initialDefaults, null, 2));
            logAudit(user, 'create_industry', { industry: newName });
            return NextResponse.json({ success: true });
        }

        if (action === 'create_client') {
            // Admin only (checked above)
            if (!newName) return NextResponse.json({ error: 'New Name required' }, { status: 400 });
            const targetPath = getClientConfigPath(industry, newName);
            if (fs.existsSync(targetPath)) return NextResponse.json({ error: 'Client already exists' }, { status: 409 });

            // Default content
            let initialContent: Record<string, any> = { client_id: newName, industry };
            try {
                const defaultsPath = getIndustryConfigPath(industry);
                if (fs.existsSync(defaultsPath)) {
                    initialContent = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8')) as Record<string, any>;
                    initialContent.client_id = newName;
                }
            } catch (e) { }

            // Set default voice from library if available
            let appliedDefaultVoice = false;
            try {
                const voiceLibPath = path.join(getConfigPath(), 'voice_library.json');
                if (fs.existsSync(voiceLibPath)) {
                    const lib = JSON.parse(fs.readFileSync(voiceLibPath, 'utf-8'));
                    const defaults = (lib.voices || []).filter((v: any) => v.default);
                    const defaultVoice = defaults[0];
                    if (defaultVoice) {
                        initialContent.tts_provider = defaultVoice.provider || initialContent.tts_provider || "elevenlabs";
                        if (defaultVoice.provider === "elevenlabs") {
                            initialContent.elevenlabs_voice_id = defaultVoice.voice_id || initialContent.elevenlabs_voice_id;
                        }
                        if (defaultVoice.provider === "azure_neural") {
                            initialContent.azure_voice_name = defaultVoice.voice_name || initialContent.azure_voice_name;
                        }
                        appliedDefaultVoice = true;
                    }
                }
            } catch (e) { }

            // Fallback: if the voice library isn't present/configured, default new clients to the ElevenLabs voice
            // currently used by "Thirsty Work" (as requested).
            if (!appliedDefaultVoice) {
                try {
                    const twPaths = [
                        // Current selected config root (bundled or shared)
                        getClientConfigPath('sales', 'Thirsty Work'),
                        // Explicit shared_code fallback (useful if bundled config lacks Thirsty Work)
                        path.resolve(process.cwd(), '../shared_code/config/clients/sales/Thirsty Work.json'),
                    ];
                    for (const p of twPaths) {
                        if (!fs.existsSync(p)) continue;
                        const tw = JSON.parse(fs.readFileSync(p, 'utf-8'));
                        const voiceId = (tw?.elevenlabs_voice_id as string) || "";
                        if (voiceId) {
                            initialContent.tts_provider = "elevenlabs";
                            initialContent.elevenlabs_voice_id = voiceId;
                            break;
                        }
                    }
                } catch (e) { }
            }

            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(targetPath, JSON.stringify(initialContent, null, 2));

            logAudit(user, 'create_client', { industry, client: newName });
            return NextResponse.json({ success: true });
        }

        if (action === 'delete_client') {
            // Admin only (checked above)
            if (!industry || !client) return NextResponse.json({ error: 'Industry and Client required' }, { status: 400 });
            const targetPath = getClientConfigPath(industry, client);
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
                logAudit(user, 'delete_client', { industry, client });
                return NextResponse.json({ success: true });
            }
            return NextResponse.json({ error: 'Client file not found' }, { status: 404 });
        }

        if (action === 'delete_industry') {
            // Admin only
            if (!industry) return NextResponse.json({ error: 'Industry required' }, { status: 400 });
            const defaultsPath = getIndustryConfigPath(industry);
            const dir = path.dirname(defaultsPath);
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
                logAudit(user, 'delete_industry', { industry });
                return NextResponse.json({ success: true });
            }
            return NextResponse.json({ error: 'Industry folder not found' }, { status: 404 });
        }

        // Revert action
        if (action === 'revert') {
            // Check access
            if (!permissions.can_revert_history && !isSuperAdmin(user)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

            if (!industry || !client || !body.hash) return NextResponse.json({ error: 'Industry, Client, and Hash required' }, { status: 400 });
            const targetPath = getClientConfigPath(industry, client);
            const relPath = path.relative(process.cwd(), targetPath);

            try {
                execSync(`git checkout ${body.hash} -- "${relPath}"`);
                // Commit the revert
                const authorName = user.name || user.email || "unknown";
                const authorSlug = authorName.replace(' ', '.');
                const author = `${authorName} <${authorSlug}@voiceagent.local>`;
                execSync(`git commit -m "Reverted ${client} to ${body.hash}" --author="${author}"`);

                logAudit(user, 'revert', { industry, client, hash: body.hash });
                return NextResponse.json({ success: true });
            } catch (e) {
                return NextResponse.json({ error: 'Failed to revert: ' + String(e) }, { status: 500 });
            }
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
