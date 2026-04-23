import { NextRequest, NextResponse } from 'next/server';
import { listConfigurations, getClientConfigPath, getIndustryConfigPath, getGlobalPromptsPath, getConfigPath } from '@/lib/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getAuthenticatedUser } from "@/lib/auth";
import { filterConfigListForUser, getUserPermissions, hasClientAccess, hasIndustryAccess, isAdminUser, isSuperAdmin } from "@/lib/rbac";

export const dynamic = 'force-dynamic';

type VoiceEntry = {
    name: string;
    provider: "elevenlabs" | "azure_neural";
    voice_id?: string;
    voice_name?: string;
    locale?: string;
    gender?: string;
    default?: boolean;
};

type IntentLibraryEntry = {
    name: string;
    label?: string;
    workflow_template?: any;
};

function getVoiceLibraryPath() {
    return path.join(getConfigPath(), 'voice_library.json');
}

function getIntentLibraryPath() {
    return path.join(getConfigPath(), 'intent_library.json');
}

function getPromptLibraryPath() {
    return path.join(getConfigPath(), 'prompt_library.json');
}

function getVariantDir(industry: string, client: string) {
    return path.join(getConfigPath(), 'variants', industry, client);
}

function readJsonFileSafe(filePath: string) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(cleaned);
}

function sanitizeClientList(data: { industries: string[]; clients: Record<string, string[]> }) {
    const skipClientBasenames = new Set([
        "intents",
        "prompts",
        "intent_routing_rules",
    ]);

    const sanitizedClients: Record<string, string[]> = {};
    for (const industry of data.industries || []) {
        const candidates = data.clients?.[industry] || [];
        const clean = candidates.filter((client) => {
            const normalized = String(client || "").trim().toLowerCase();
            if (!normalized) return false;
            if (skipClientBasenames.has(normalized)) return false;
            if (normalized.startsWith("workflow_")) return false;
            if (normalized.endsWith("_template")) return false;

            try {
                const p = getClientConfigPath(industry, client);
                if (!fs.existsSync(p)) return false;
                const parsed = readJsonFileSafe(p);
                const clientId = String(parsed?.client_id || "").trim();
                const fileIndustry = String(parsed?.industry || "").trim();
                const isTemplate = parsed?.is_template === true;
                if (!clientId || isTemplate) return false;
                if (clientId.toLowerCase() !== normalized) return false;
                if (fileIndustry && fileIndustry.toLowerCase() !== industry.toLowerCase()) return false;
                return true;
            } catch {
                return false;
            }
        });
        sanitizedClients[industry] = clean;
    }

    return { industries: data.industries || [], clients: sanitizedClients };
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
            locale: (v.locale || "").trim() || undefined,
            gender: (v.gender || "").trim() || undefined,
            default: !!v.default,
        };
    }
    const shortName = (v.voice_name || "").trim();
    if (!shortName) return null;
    return {
        provider: "azure_neural",
        voice_name: shortName,
        name: (v.name || shortName).trim(),
        locale: (v.locale || inferAzureLocale(shortName)).trim() || undefined,
        gender: (v.gender || "").trim() || undefined,
        default: !!v.default,
    };
}

function inferAzureLocale(shortName: string) {
    const match = String(shortName || "").match(/^([a-z]{2,3}-[A-Z]{2,4})-/);
    return match ? match[1] : "";
}

function isValidLocale(value: string) {
    return /^[a-z]{2,3}-[A-Za-z]{2,4}$/.test(String(value || "").trim());
}

const FALLBACK_AZURE_VOICES: VoiceEntry[] = [
    { provider: "azure_neural", voice_name: "en-GB-LibbyNeural", name: "Libby", locale: "en-GB", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "en-GB-RyanNeural", name: "Ryan", locale: "en-GB", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "en-US-JennyNeural", name: "Jenny", locale: "en-US", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "en-US-GuyNeural", name: "Guy", locale: "en-US", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "pt-PT-RaquelNeural", name: "Raquel", locale: "pt-PT", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "pt-PT-DuarteNeural", name: "Duarte", locale: "pt-PT", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "pt-BR-FranciscaNeural", name: "Francisca", locale: "pt-BR", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "pt-BR-AntonioNeural", name: "Antonio", locale: "pt-BR", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "es-ES-ElviraNeural", name: "Elvira", locale: "es-ES", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "es-ES-AlvaroNeural", name: "Alvaro", locale: "es-ES", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "es-MX-DaliaNeural", name: "Dalia", locale: "es-MX", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "es-MX-JorgeNeural", name: "Jorge", locale: "es-MX", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "fr-FR-DeniseNeural", name: "Denise", locale: "fr-FR", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "fr-FR-HenriNeural", name: "Henri", locale: "fr-FR", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "de-DE-KatjaNeural", name: "Katja", locale: "de-DE", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "de-DE-ConradNeural", name: "Conrad", locale: "de-DE", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "it-IT-ElsaNeural", name: "Elsa", locale: "it-IT", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "it-IT-DiegoNeural", name: "Diego", locale: "it-IT", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "nl-NL-ColetteNeural", name: "Colette", locale: "nl-NL", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "nl-NL-MaartenNeural", name: "Maarten", locale: "nl-NL", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "pl-PL-ZofiaNeural", name: "Zofia", locale: "pl-PL", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "pl-PL-MarekNeural", name: "Marek", locale: "pl-PL", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "ar-SA-ZariyahNeural", name: "Zariyah", locale: "ar-SA", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "ar-SA-HamedNeural", name: "Hamed", locale: "ar-SA", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "hi-IN-SwaraNeural", name: "Swara", locale: "hi-IN", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "hi-IN-MadhurNeural", name: "Madhur", locale: "hi-IN", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "ja-JP-NanamiNeural", name: "Nanami", locale: "ja-JP", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "ja-JP-KeitaNeural", name: "Keita", locale: "ja-JP", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "ko-KR-SunHiNeural", name: "SunHi", locale: "ko-KR", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "ko-KR-InJoonNeural", name: "InJoon", locale: "ko-KR", gender: "Male", default: false },
    { provider: "azure_neural", voice_name: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao", locale: "zh-CN", gender: "Female", default: false },
    { provider: "azure_neural", voice_name: "zh-CN-YunxiNeural", name: "Yunxi", locale: "zh-CN", gender: "Male", default: false },
];

function loadVoiceLibrary(): { voices: VoiceEntry[] } {
    const p = getVoiceLibraryPath();
    if (!fs.existsSync(p)) return { voices: [] };
    const parsed = readJsonFileSafe(p);
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

function cloneDeep<T>(value: T): T {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function loadGlobalWorkflowTemplates(includeExtended = false) {
    const templates: Array<{ key: string; label: string; workflow: any }> = [];
    const seen = new Set<string>();
    const normalizedNameToKey = new Map<string, string>();

    const toDisplayName = (raw: string) => {
        const text = String(raw || "").trim().replace(/[_\-]+/g, " ");
        return text ? text.replace(/\b\w/g, (c) => c.toUpperCase()) : raw;
    };

    const addTemplate = (key: string, label: string, workflow: any, workflowName?: string) => {
        if (!key || !workflow || seen.has(key)) return;
        const normalized = normalizeIntentName(String(workflowName || "").trim());
        if (normalized) {
            if (normalizedNameToKey.has(normalized)) return;
            normalizedNameToKey.set(normalized, key);
        }
        seen.add(key);
        templates.push({ key, label, workflow: cloneDeep(workflow) });
    };

    // 0) Intent library workflow templates (global by design).
    const intentLib = loadIntentLibrary();
    for (const entry of intentLib.intents || []) {
        if (!entry?.name || !entry?.workflow_template) continue;
        addTemplate(
            `library:intent:${entry.name}`,
            `${toDisplayName(entry.label || entry.name)}`,
            entry.workflow_template,
            entry.name
        );
    }

    for (const root of getConfigRootCandidates()) {
        // 1) Industry defaults workflows as fallback source, deduped by workflow name.
        const industriesDir = path.join(root, "industries");
        if (fs.existsSync(industriesDir)) {
            const industryEntries = fs.readdirSync(industriesDir, { withFileTypes: true });
            for (const entry of industryEntries) {
                if (!entry.isDirectory()) continue;
                const industry = entry.name;
                const defaultsPath = path.join(industriesDir, industry, "defaults.json");
                if (!fs.existsSync(defaultsPath)) continue;
                try {
                    const parsed = readJsonFileSafe(defaultsPath);
                    const workflows = parsed?.workflows && typeof parsed.workflows === "object" ? parsed.workflows : {};
                    for (const [wfName, wf] of Object.entries(workflows as Record<string, any>)) {
                        if (wfName === "general") continue;
                        addTemplate(
                            `industry:${industry}:${wfName}`,
                            `${toDisplayName(wfName)}`,
                            wf,
                            wfName
                        );
                    }
                } catch {
                    // skip unreadable defaults
                }
            }
        }

        // 2) Client folder workflow sources:
        //    - standalone workflow_*.json files
        //    - template client files (e.g. retail_template.json) with workflows map
        const clientsDir = path.join(root, "clients");
        if (fs.existsSync(clientsDir)) {
            const industryEntries = fs.readdirSync(clientsDir, { withFileTypes: true });
            for (const industryEntry of industryEntries) {
                if (!industryEntry.isDirectory()) continue;
                const industry = industryEntry.name;
                const industryPath = path.join(clientsDir, industry);
                const files = fs.readdirSync(industryPath, { withFileTypes: true });
                for (const file of files) {
                    if (!file.isFile()) continue;
                    const fileName = file.name;
                    if (!fileName.endsWith(".json")) continue;
                    const fullPath = path.join(industryPath, fileName);
                    const lowerName = fileName.toLowerCase();

                    if (lowerName.startsWith("workflow_")) {
                        try {
                            const wf = readJsonFileSafe(fullPath);
                            const baseName = fileName.replace(/\.json$/i, "");
                            const wfName = baseName.replace(/^workflow_/i, "");
                            addTemplate(
                                `file:${industry}:${wfName}`,
                                `${toDisplayName(wfName)}`,
                                wf,
                                wfName
                            );
                        } catch {
                            // skip unreadable workflow file
                        }
                        continue;
                    }

                    const isLikelyTemplateFile =
                        lowerName.endsWith("_template.json") ||
                        lowerName.includes("template");
                    if (!isLikelyTemplateFile) continue;
                    try {
                        const parsed = readJsonFileSafe(fullPath);
                        const isTemplate = parsed?.is_template === true || isLikelyTemplateFile;
                        if (!isTemplate) continue;
                        const workflows = parsed?.workflows && typeof parsed.workflows === "object" ? parsed.workflows : {};
                        for (const [wfName, wf] of Object.entries(workflows as Record<string, any>)) {
                            if (wfName === "general") continue;
                            addTemplate(
                                `template:${industry}:${wfName}`,
                                `${toDisplayName(wfName)}`,
                                wf,
                                wfName
                            );
                        }
                    } catch {
                        // skip unreadable template client file
                    }
                }
            }
        }
    }

    if (!includeExtended) {
        return templates;
    }

    return templates;
}

function loadGlobalWorkflowTemplateMap() {
    const out: Record<string, any> = {};
    const templates = loadGlobalWorkflowTemplates(true);
    for (const tpl of templates) {
        const keyPart = String(tpl?.key || "").split(":").pop() || "";
        const labelPart = String(tpl?.label || "");
        const name = normalizeIntentName(keyPart || labelPart);
        if (!name || name === "general") continue;
        if (!out[name]) out[name] = cloneDeep(tpl.workflow);
    }
    return out;
}

function normalizeIntentName(raw: string) {
    return String(raw || "").toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function getConfigRootCandidates(): string[] {
    const roots = new Set<string>();
    roots.add(getConfigPath());
    roots.add(path.resolve(process.cwd(), '../shared_code/config'));
    roots.add(path.resolve(process.cwd(), 'config'));
    return Array.from(roots);
}

function loadIntentLibrary(): { intents: IntentLibraryEntry[] } {
    const merged = new Map<string, IntentLibraryEntry>();
    const candidates = getConfigRootCandidates().map((root) => path.join(root, 'intent_library.json'));

    for (const p of candidates) {
        if (!fs.existsSync(p)) continue;
        let parsed: any = null;
        try {
            parsed = readJsonFileSafe(p);
        } catch {
            continue;
        }
        const src = Array.isArray(parsed?.intents) ? parsed.intents : [];
        for (const entry of src) {
            let normalized: string | null = null;
            let next: IntentLibraryEntry | null = null;
            if (typeof entry === "string") {
                normalized = normalizeIntentName(entry);
                if (!normalized || normalized === "general") continue;
                next = { name: normalized };
            } else if (entry && typeof entry === "object") {
                normalized = normalizeIntentName(entry.name);
                if (!normalized || normalized === "general") continue;
                next = {
                    name: normalized,
                    label: typeof entry.label === "string" ? entry.label : undefined,
                    workflow_template: entry.workflow_template
                };
            }
            if (!normalized || !next) continue;
            const prev = merged.get(normalized);
            if (!prev) {
                merged.set(normalized, next);
            } else {
                merged.set(normalized, {
                    ...prev,
                    ...next,
                    // Prefer any template that exists
                    workflow_template: next.workflow_template || prev.workflow_template
                });
            }
        }
    }

    return { intents: Array.from(merged.values()) };
}

function loadPromptLibraryEntries(): Array<{ suggested_key?: string; text?: string }> {
    const candidates = [
        getPromptLibraryPath(),
        path.resolve(process.cwd(), '../shared_code/config/prompt_library.json'),
    ];
    for (const p of candidates) {
        if (!fs.existsSync(p)) continue;
        try {
            const parsed = readJsonFileSafe(p);
            const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
            return prompts;
        } catch {
            // try next candidate
        }
    }
    return [];
}

function collectPromptKeysFromWorkflow(workflow: any): string[] {
    const out = new Set<string>();
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    for (const node of nodes) {
        const promptKey = String(node?.data?.promptKey || "").trim();
        const promptKeyWithName = String(node?.data?.promptKeyWithName || "").trim();
        if (promptKey) out.add(promptKey);
        if (promptKeyWithName) out.add(promptKeyWithName);
    }
    return Array.from(out);
}

function defaultFirstResponseWorkflow() {
    return {
        nodes: [{ id: '1', position: { x: 250, y: 50 }, data: { label: 'Start First Response', promptKey: 'first_response_greeting' }, type: 'custom_input' }],
        edges: []
    };
}

function buildBootstrapDefaults(industry: string) {
    const intentLib = loadIntentLibrary();
    const promptEntries = loadPromptLibraryEntries();
    const promptByKey: Record<string, string> = {};
    for (const p of promptEntries) {
        const key = String(p?.suggested_key || "").trim();
        const text = String(p?.text || "").trim();
        if (key && text && !promptByKey[key]) promptByKey[key] = text;
    }

    const workflows: Record<string, any> = {};
    const intents = new Set<string>(["first_response"]);
    const firstResponseTemplate = intentLib.intents.find((i) => i.name === "first_response")?.workflow_template;
    workflows.first_response = firstResponseTemplate
        ? cloneDeep(firstResponseTemplate)
        : defaultFirstResponseWorkflow();

    const prompts: Record<string, string> = { general: "..." };
    const promptKeys = new Set<string>();
    Object.values(workflows).forEach((wf) => collectPromptKeysFromWorkflow(wf).forEach((k) => promptKeys.add(k)));
    for (const key of promptKeys) {
        prompts[key] = promptByKey[key] || "...";
    }

    return {
        industry,
        intents: Array.from(intents),
        prompts,
        workflows
    };
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
        const prevName = (prev.name || "").trim();
        const importedName = (imported.name || "").trim();
        const prevIsPlaceholderId =
            imported.provider === "elevenlabs" &&
            !!prev.voice_id &&
            (prevName === prev.voice_id || !prevName);

        map.set(k, {
            ...imported,
            ...prev,
            voice_id: prev.voice_id || imported.voice_id,
            voice_name: prev.voice_name || imported.voice_name,
            locale: prev.locale || imported.locale,
            gender: prev.gender || imported.gender,
            name: prevIsPlaceholderId ? (importedName || prevName) : (prevName || importedName),
        });
    }

    return Array.from(map.values());
}

async function importAzureVoices(locale?: string) {
    const region = (process.env.AZURE_SPEECH_REGION || "uksouth").trim();
    const key = process.env.AZURE_SPEECH_KEY;
    const requestedLocale = String(locale || "").trim();
    if (!key) {
        return FALLBACK_AZURE_VOICES.filter((v) => {
            const voiceLocale = String(v.locale || inferAzureLocale(v.voice_name || "")).trim();
            return !requestedLocale || voiceLocale.toLowerCase() === requestedLocale.toLowerCase();
        });
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
    const requestedLocale = String(locale || "").trim();
    const imported = (Array.isArray(voices) ? voices : [])
        .filter((v: any) => {
            const voiceLocale = String(v?.Locale || "");
            const shortName = String(v?.ShortName || "");
            const voiceType = String(v?.VoiceType || "");
            return (
                (!requestedLocale || voiceLocale.toLowerCase() === requestedLocale.toLowerCase()) &&
                (voiceType.toLowerCase() === "neural" || shortName.toLowerCase().includes("neural"))
            );
        })
        .map((v: any) => {
            const shortName = String(v?.ShortName || "").trim();
            const voiceLocale = String(v?.Locale || inferAzureLocale(shortName)).trim();
            return {
                provider: "azure_neural" as const,
                voice_name: shortName,
                name: String(v?.DisplayName || v?.LocalName || shortName).trim(),
                locale: voiceLocale || undefined,
                gender: String(v?.Gender || "").trim() || undefined,
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
                    const parsed = readJsonFileSafe(p);
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
            const providerName = String(v?.name || "").trim();
            return {
                provider: "elevenlabs" as const,
                voice_id: id,
                name: providerName || id,
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
            const raw = await listConfigurations();
            const data = sanitizeClientList(raw);
            const filtered = filterConfigListForUser(user, data);
            return NextResponse.json(filtered);
        }

        if (type === "workflow_templates") {
            const includeExtended = searchParams.get("include_extended") === "1";
            const templates = loadGlobalWorkflowTemplates(includeExtended);
            return NextResponse.json({ templates });
        }

        if (type === 'industry' && industry) {
            const raw = await listConfigurations();
            const data = sanitizeClientList(raw);
            const clientsInIndustry = data.clients[industry] || [];
            if (!hasIndustryAccess(user, industry, clientsInIndustry)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            const p = getIndustryConfigPath(industry);
            if (fs.existsSync(p)) {
                const content = readJsonFileSafe(p);
                return NextResponse.json(content);
            }
            return NextResponse.json({}, { status: 404 });
        }

        if (type === 'client' && industry && client) {
            if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

            const p = getClientConfigPath(industry, client);
            if (fs.existsSync(p)) {
                const content = readJsonFileSafe(p);
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
                const content = readJsonFileSafe(p);
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
                const content = readJsonFileSafe(p);

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
                const content = readJsonFileSafe(p);
                return NextResponse.json(content);
            }
            return NextResponse.json({ prompts: [] });
        }

        if (type === 'intent_library') {
            const p = path.join(getConfigPath(), 'intent_library.json');
            if (fs.existsSync(p)) {
                const content = readJsonFileSafe(p);
                return NextResponse.json(content);
            }
            return NextResponse.json({ intents: [] });
        }

        if (type === 'voice_library') {
            const p = path.join(getConfigPath(), 'voice_library.json');
            if (fs.existsSync(p)) {
                const content = readJsonFileSafe(p);
                return NextResponse.json(content);
            }
            return NextResponse.json({ voices: [] });
        }

        if (type === 'variants' && industry && client) {
            if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            const dir = getVariantDir(industry, client);
            if (!fs.existsSync(dir)) return NextResponse.json({ variants: [] });
            const variants = fs.readdirSync(dir, { withFileTypes: true })
                .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
                .map((e) => {
                    const p = path.join(dir, e.name);
                    const stat = fs.statSync(p);
                    return {
                        name: e.name.replace(/\.json$/i, ''),
                        file: e.name,
                        updated_at: stat.mtime.toISOString(),
                    };
                })
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            return NextResponse.json({ variants });
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
        const { action = 'save', type, industry, client, content, newName, create_mode, template_client } = body;

        const userLabel = user.name || user.email || "unknown";
        console.log(`[API] POST action=${action} type=${type} industry=${industry} client=${client} user=${userLabel}`);

        // SAFEGUARD: Basic Validation
        if (action !== 'create_industry' && action !== 'import_voices' && type !== 'phone_mappings' && type !== 'prompt_library' && type !== 'voice_library' && type !== 'intent_library' && !industry) {
            return NextResponse.json({ error: 'Industry is required' }, { status: 400 });
        }

        // RBAC Check
        if (action === 'save') {
            if (type === 'client' && client) {
                if (!permissions.can_edit_clients && !isSuperAdmin(user)) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
                if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            } else if (type === 'industry' || type === 'phone_mappings' || type === 'global_prompts' || type === 'prompt_library' || type === 'voice_library' || type === 'intent_library') {
                if (type === 'industry' && isSuperAdmin(user)) {
                    // admin only
                } else if (type === 'phone_mappings' && (permissions.can_edit_phone_mappings || isSuperAdmin(user))) {
                    // allowed
                } else if (type === 'prompt_library' && (permissions.can_manage_prompt_library || isSuperAdmin(user))) {
                    // allowed
                } else if (type === 'intent_library' && (permissions.can_manage_prompt_library || isSuperAdmin(user))) {
                    // allowed (reusing prompt-library management permission)
                } else if (type === 'voice_library') {
                    // Admin-only (product requirement): do not allow non-admins even if permission flags are present.
                    if (!isAdminUser(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                    if (!(permissions.can_manage_voice_library || isSuperAdmin(user))) {
                        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                    }
                } else if (type === 'global_prompts' && isSuperAdmin(user)) {
                    // allowed
                } else {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
            }
        } else if (action !== 'save_variant' && action !== 'load_variant') {
            // Create/Delete actions restricted to Admin usually, 
            // but maybe creating a client is allowed if you have access to that industry? 
            // Implementing strict admin-only for creat/delete for now as per plan
            if (!isAdminUser(user)) return NextResponse.json({ error: 'Forbidden: Admin Only' }, { status: 403 });
        }

        if (action === 'save_variant' || action === 'load_variant') {
            if (!industry || !client) return NextResponse.json({ error: 'Industry and client are required' }, { status: 400 });
            if (!permissions.can_edit_clients && !isSuperAdmin(user)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            if (!hasClientAccess(user, industry, client)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
            } else if (type === 'intent_library') {
                targetPath = path.join(getConfigPath(), 'intent_library.json');
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

        if (action === 'save_variant') {
            const variantName = String(body?.variantName || "").trim();
            if (!variantName) return NextResponse.json({ error: 'variantName is required' }, { status: 400 });
            const safeName = variantName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
            const sourcePath = getClientConfigPath(industry, client);
            if (!fs.existsSync(sourcePath)) return NextResponse.json({ error: 'Client configuration not found' }, { status: 404 });

            const variantDir = getVariantDir(industry, client);
            if (!fs.existsSync(variantDir)) fs.mkdirSync(variantDir, { recursive: true });
            const targetPath = path.join(variantDir, `${safeName}.json`);
            fs.copyFileSync(sourcePath, targetPath);

            logAudit(user, 'save_variant', { industry, client, variantName: safeName, targetPath });
            return NextResponse.json({ success: true, variant: safeName });
        }

        if (action === 'load_variant') {
            const variantName = String(body?.variantName || "").trim();
            if (!variantName) return NextResponse.json({ error: 'variantName is required' }, { status: 400 });
            const safeName = variantName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
            const sourcePath = path.join(getVariantDir(industry, client), `${safeName}.json`);
            if (!fs.existsSync(sourcePath)) return NextResponse.json({ error: 'Variant not found' }, { status: 404 });

            const targetPath = getClientConfigPath(industry, client);
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);

            logAudit(user, 'load_variant', { industry, client, variantName: safeName, sourcePath, targetPath });
            return NextResponse.json({ success: true, variant: safeName });
        }

        if (action === 'import_voices') {
            if (type !== 'voice_library') {
                return NextResponse.json({ error: 'Invalid type for import_voices' }, { status: 400 });
            }
            if (!isAdminUser(user)) {
                return NextResponse.json({ error: 'Forbidden: Admin Only' }, { status: 403 });
            }
            if (!(permissions.can_manage_voice_library || isSuperAdmin(user))) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            const provider = String(body?.provider || "").toLowerCase();
            let imported: VoiceEntry[] = [];
            if (provider === 'azure' || provider === 'azure_neural' || provider === 'azure_gb' || provider === 'azure_neural_gb') {
                const locale = String(body?.locale || "").trim();
                if (locale && !isValidLocale(locale)) {
                    return NextResponse.json({ error: 'Invalid locale for import_voices' }, { status: 400 });
                }
                imported = await importAzureVoices(locale || (provider.includes('_gb') ? 'en-GB' : ''));
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

            return NextResponse.json({
                success: true,
                provider,
                importedCount: imported.length,
                totalVoices: merged.length,
                voices: merged,
                fallback: (provider === 'azure' || provider === 'azure_neural' || provider === 'azure_gb' || provider === 'azure_neural_gb') && !process.env.AZURE_SPEECH_KEY,
            });
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

            const initialDefaults = buildBootstrapDefaults(newName);
            fs.writeFileSync(defaultsPath, JSON.stringify(initialDefaults, null, 2));
            logAudit(user, 'create_industry', { industry: newName });
            return NextResponse.json({ success: true });
        }

        if (action === 'create_client') {
            // Admin only (checked above)
            if (!newName) return NextResponse.json({ error: 'New Name required' }, { status: 400 });
            const targetPath = getClientConfigPath(industry, newName);
            if (fs.existsSync(targetPath)) return NextResponse.json({ error: 'Client already exists' }, { status: 409 });
            const createMode = String(create_mode || "industry_template").trim().toLowerCase();
            const templateClient = String(template_client || "").trim();
            const requestedContent = (content && typeof content === "object" && !Array.isArray(content))
                ? (content as Record<string, any>)
                : null;

            const normalizeIntentName = (raw: string) =>
                String(raw || "")
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, "_")
                    .replace(/[^a-z0-9_]/g, "");

            // Default content
            let initialContent: Record<string, any> = { client_id: newName, industry };
            if (createMode !== "blank") {
                if (templateClient) {
                    try {
                        const templatePath = getClientConfigPath(industry, templateClient);
                        if (fs.existsSync(templatePath)) {
                            initialContent = readJsonFileSafe(templatePath) as Record<string, any>;
                            initialContent.client_id = newName;
                            initialContent.industry = industry;
                        }
                    } catch (e) { }
                }
                try {
                    if (!templateClient || Object.keys(initialContent || {}).length <= 2) {
                        const defaultsPath = getIndustryConfigPath(industry);
                        if (fs.existsSync(defaultsPath)) {
                            initialContent = readJsonFileSafe(defaultsPath) as Record<string, any>;
                            initialContent.client_id = newName;
                        }
                    }
                } catch (e) { }
            } else {
                initialContent = {
                    client_id: newName,
                    industry,
                    intents: ["first_response"],
                    workflows: {
                        first_response: cloneDeep(defaultFirstResponseWorkflow()),
                    },
                    prompts: {},
                };
            }

            const bootstrap = buildBootstrapDefaults(industry);
            if (createMode !== "blank") {
                const currentIntents = new Set<string>(Array.isArray(initialContent.intents) ? initialContent.intents : []);
                currentIntents.delete("general");
                if (!currentIntents.size) {
                    bootstrap.intents.forEach((i) => currentIntents.add(i));
                }
                if (!currentIntents.has("first_response")) currentIntents.add("first_response");
                initialContent.intents = Array.from(currentIntents);

                initialContent.workflows = { ...(bootstrap.workflows || {}), ...(initialContent.workflows || {}) };
                if (!initialContent.workflows.first_response) {
                    initialContent.workflows.first_response = cloneDeep(bootstrap.workflows.first_response || defaultFirstResponseWorkflow());
                }

                const mergedPrompts = { ...(bootstrap.prompts || {}), ...(initialContent.prompts || {}) };
                const keySet = new Set<string>();
                Object.values(initialContent.workflows || {}).forEach((wf: any) => collectPromptKeysFromWorkflow(wf).forEach((k) => keySet.add(k)));
                for (const key of keySet) {
                    if (!mergedPrompts[key]) mergedPrompts[key] = "...";
                }
                initialContent.prompts = mergedPrompts;
            } else {
                const basePrompts = { ...(bootstrap.prompts || {}) };
                const keySet = new Set<string>();
                Object.values(initialContent.workflows || {}).forEach((wf: any) => collectPromptKeysFromWorkflow(wf).forEach((k) => keySet.add(k)));
                for (const key of keySet) {
                    if (!initialContent.prompts[key]) {
                        initialContent.prompts[key] = basePrompts[key] || "...";
                    }
                }
            }

            // Set default voice from library if available
            let appliedDefaultVoice = false;
            try {
                const voiceLibPath = path.join(getConfigPath(), 'voice_library.json');
                if (fs.existsSync(voiceLibPath)) {
                    const lib = readJsonFileSafe(voiceLibPath);
                    const requestedLanguage = String(requestedContent?.language || initialContent.language || initialContent.azure_ssml_lang || "en-GB").trim();
                    const voiceLocale = (v: any) => String(v?.locale || inferAzureLocale(String(v?.voice_name || ""))).trim();
                    const matchesLanguage = (v: any) => {
                        const locale = voiceLocale(v);
                        return !locale || !requestedLanguage || locale.toLowerCase() === requestedLanguage.toLowerCase();
                    };
                    const voices = Array.isArray(lib.voices) ? lib.voices : [];
                    const defaultVoice = voices.find((v: any) => v.default && matchesLanguage(v)) || voices.find(matchesLanguage);
                    if (defaultVoice) {
                        initialContent.tts_provider = defaultVoice.provider || initialContent.tts_provider || "elevenlabs";
                        if (defaultVoice.provider === "elevenlabs") {
                            initialContent.elevenlabs_voice_id = defaultVoice.voice_id || initialContent.elevenlabs_voice_id;
                        }
                        if (defaultVoice.provider === "azure_neural") {
                            initialContent.azure_voice_name = defaultVoice.voice_name || initialContent.azure_voice_name;
                            initialContent.voice_name = defaultVoice.voice_name || initialContent.voice_name;
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
                        const tw = readJsonFileSafe(p);
                        const voiceId = (tw?.elevenlabs_voice_id as string) || "";
                        if (voiceId) {
                            initialContent.tts_provider = "elevenlabs";
                            initialContent.elevenlabs_voice_id = voiceId;
                            break;
                        }
                    }
                } catch (e) { }
            }

            // Apply create-client form overrides (if provided)
            if (requestedContent) {
                const scalarFields = [
                    "brand_name",
                    "assistant_name",
                    "agent_name",
                    "opening_hours",
                    "brand_phone",
                    "tone",
                    "language",
                    "azure_ssml_lang",
                    "tts_provider",
                    "elevenlabs_voice_id",
                    "azure_voice_name",
                    "default_intent",
                ];
                for (const field of scalarFields) {
                    const value = requestedContent[field];
                    if (value === undefined || value === null) continue;
                    const text = String(value).trim();
                    if (!text) continue;
                    initialContent[field] = field === "default_intent" ? normalizeIntentName(text) : text;
                }

                if (Array.isArray(requestedContent.intents)) {
                    const intents = requestedContent.intents
                        .map((i: any) => normalizeIntentName(String(i || "")))
                        .filter(Boolean);
                    if (intents.length) {
                        const next = new Set<string>(["first_response", ...intents]);
                        initialContent.intents = Array.from(next);
                    }
                }
            }

            // Ensure selected intents have workflows from global template library.
            if (createMode !== "blank") {
                const templateMap = loadGlobalWorkflowTemplateMap();
                const configuredIntents = Array.isArray(initialContent.intents) ? initialContent.intents : [];
                for (const rawIntent of configuredIntents) {
                    const intent = normalizeIntentName(String(rawIntent || ""));
                    if (!intent || intent === "general" || intent === "first_response") continue;
                    if (!initialContent.workflows?.[intent] && templateMap[intent]) {
                        initialContent.workflows[intent] = cloneDeep(templateMap[intent]);
                    }
                }
            }

            // Ensure required identity fields always win
            initialContent.client_id = newName;
            initialContent.industry = industry;

            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(targetPath, JSON.stringify(initialContent, null, 2));

            logAudit(user, 'create_client', { industry, client: newName });
            return NextResponse.json({ success: true });
        }

        if (action === 'copy_client') {
            // Admin only (checked above)
            if (!industry || !client || !newName) {
                return NextResponse.json({ error: 'Industry, source client, and new name are required' }, { status: 400 });
            }

            const sourcePath = getClientConfigPath(industry, client);
            if (!fs.existsSync(sourcePath)) {
                return NextResponse.json({ error: 'Source client file not found' }, { status: 404 });
            }

            const targetPath = getClientConfigPath(industry, newName);
            if (fs.existsSync(targetPath)) {
                return NextResponse.json({ error: 'Client already exists' }, { status: 409 });
            }

            try {
                const sourceContent = readJsonFileSafe(sourcePath) as Record<string, any>;
                const copied = { ...sourceContent, client_id: newName };
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(targetPath, JSON.stringify(copied, null, 2));
            } catch (e) {
                return NextResponse.json({ error: 'Failed to copy client configuration' }, { status: 500 });
            }

            logAudit(user, 'copy_client', { industry, sourceClient: client, newClient: newName });
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
