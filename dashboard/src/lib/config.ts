import path from 'path';
import fs from 'fs';

export function getConfigPath() {
    if (process.env.APP_CONFIG_PATH) {
        return process.env.APP_CONFIG_PATH;
    }

    const cwd = process.cwd();
    // Default: Try bundled config first (for production)
    const bundledPath = path.resolve(cwd, 'config');
    const sharedPath = path.resolve(cwd, '../shared_code/config');

    // Debugging (visible in server terminal)
    // console.log(`[Config] CWD: ${cwd}`);
    // console.log(`[Config] Bundled: ${bundledPath}`);
    // console.log(`[Config] Shared: ${sharedPath}`);

    // Check strict existence of users.json to determine valid config dir
    if (fs.existsSync(path.join(bundledPath, 'users.json'))) {
        return bundledPath;
    }

    if (fs.existsSync(path.join(sharedPath, 'users.json'))) {
        return sharedPath;
    }

    // Fallback to whatever exists or default
    return fs.existsSync(bundledPath) ? bundledPath : sharedPath;
}

export function getClientConfigPath(industry: string, clientId: string) {
    return path.join(getConfigPath(), 'clients', industry, `${clientId}.json`);
}

export function getIndustryConfigPath(industry: string) {
    return path.join(getConfigPath(), 'industries', industry, 'defaults.json');
}

export function getGlobalPromptsPath() {
    return path.join(getConfigPath(), 'global_prompts.json');
}

export function getPhoneMappingsPath() {
    return path.join(getConfigPath(), 'phone_mappings.json');
}

export async function listConfigurations() {
    const root = getConfigPath();
    const industriesPath = path.join(root, 'industries');

    if (!fs.existsSync(industriesPath)) {
        return { industries: [], clients: {} };
    }

    // Parallelize reading industries
    const industryDirents = await fs.promises.readdir(industriesPath, { withFileTypes: true });
    const industries = industryDirents
        .filter(d => d.isDirectory() && d.name !== '__pycache__' && !d.name.startsWith('.'))
        .map(d => d.name);

    const clients: Record<string, string[]> = {};

    const skipClientBasenames = new Set([
        'intents',
        'prompts',
        'intent_routing_rules',
    ]);

    // Parallelize reading clients for all industries
    await Promise.all(industries.map(async (ind) => {
        const clientsPath = path.join(root, 'clients', ind);
        try {
            // Check existence asynchronously
            await fs.promises.access(clientsPath);
            const clientFiles = await fs.promises.readdir(clientsPath);
            const validClientIds = await Promise.all(
                clientFiles
                    .filter(f => f.endsWith('.json'))
                    .map(async (fileName) => {
                        const baseName = fileName.replace('.json', '');
                        const normalizedBase = baseName.toLowerCase();
                        if (
                            skipClientBasenames.has(normalizedBase) ||
                            normalizedBase.startsWith('workflow_')
                        ) {
                            return null;
                        }

                        const fullPath = path.join(clientsPath, fileName);
                        try {
                            const raw = await fs.promises.readFile(fullPath, 'utf-8');
                            const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
                            const parsed = JSON.parse(cleaned);
                            const clientId = String(parsed?.client_id || '').trim();
                            const fileIndustry = String(parsed?.industry || '').trim();
                            const isTemplate = parsed?.is_template === true || normalizedBase.endsWith('_template');

                            if (!clientId || isTemplate) return null;
                            if (clientId.toLowerCase() !== normalizedBase) return null;
                            if (fileIndustry && fileIndustry.toLowerCase() !== ind.toLowerCase()) return null;
                            return baseName;
                        } catch {
                            return null;
                        }
                    })
            );

            clients[ind] = validClientIds.filter((id): id is string => !!id);
        } catch {
            clients[ind] = [];
        }
    }));

    return { industries, clients };
}
