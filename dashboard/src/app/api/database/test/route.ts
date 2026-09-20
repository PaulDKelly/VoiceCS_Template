import { NextResponse } from "next/server";
import net from "net";
import fs from "fs";
import path from "path";
import dns from "dns";
import { getAuthenticatedUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbConnection = {
    type?: string;
    host?: string;
    port?: number | string;
    connection_string?: string;
    sqlite_path?: string;
    supabase_url?: string;
    supabase_key?: string;
    supabase_key_env?: string;
};

function defaultPortForType(type: string) {
    switch (type) {
        case "postgres":
            return 5432;
        case "mysql":
            return 3306;
        case "sqlserver":
            return 1433;
        default:
            return 0;
    }
}

function parseHostPortFromConnectionString(connectionString: string) {
    const raw = String(connectionString || "").trim();
    if (!raw) return { host: "", port: 0 };

    try {
        const u = new URL(raw);
        return {
            host: u.hostname || "",
            port: u.port ? parseInt(u.port, 10) : 0
        };
    } catch {
        const hostMatch = raw.match(/(?:host|server)\s*=\s*([^;]+)/i);
        const portMatch = raw.match(/port\s*=\s*([0-9]+)/i);
        return {
            host: hostMatch?.[1]?.trim() || "",
            port: portMatch?.[1] ? parseInt(portMatch[1], 10) : 0
        };
    }
}

async function testTcp(host: string, port: number, timeoutMs = 5000) {
    await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        const done = (err?: Error) => {
            socket.removeAllListeners();
            try { socket.destroy(); } catch { }
            if (err) reject(err);
            else resolve();
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done());
        socket.once("timeout", () => done(new Error(`Connection timed out after ${timeoutMs}ms`)));
        socket.once("error", (err) => done(err));
    });
}

async function testTcpWithIpFallback(host: string, port: number, timeoutMs = 5000) {
    const candidates: string[] = [];
    try {
        const resolved = await dns.promises.lookup(host, { all: true });
        const ipv4 = resolved.filter((r) => r.family === 4).map((r) => r.address);
        const ipv6 = resolved.filter((r) => r.family === 6).map((r) => r.address);
        candidates.push(...ipv4, ...ipv6);
    } catch {
        // Fallback to host if DNS lookup fails (e.g., literal IP)
        candidates.push(host);
    }

    if (!candidates.length) candidates.push(host);

    const errors: string[] = [];
    for (const candidate of candidates) {
        try {
            await testTcp(candidate, port, timeoutMs);
            return candidate;
        } catch (err: any) {
            errors.push(`${candidate}: ${err?.message || "connection failed"}`);
        }
    }

    throw new Error(errors.join(" | "));
}

export async function POST(req: Request) {
    const user = await getAuthenticatedUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const conn = (body?.connection || {}) as DbConnection;
        const type = String(conn.type || "postgres").toLowerCase();

        if (type === "supabase_rest") {
            const supabaseUrl = String(conn.supabase_url || conn.host || conn.connection_string || "").trim();
            if (!supabaseUrl) {
                return NextResponse.json({ ok: false, error: "Supabase URL is required." }, { status: 400 });
            }
            const base = supabaseUrl.replace(/\/+$/, "");
            const url = `${base}/rest/v1/`;
            const key =
                String(conn.supabase_key || "").trim() ||
                (conn.supabase_key_env ? String(process.env[String(conn.supabase_key_env)] || "").trim() : "") ||
                "";

            const headers: Record<string, string> = { Accept: "application/json" };
            if (key) {
                headers.apikey = key;
                headers.Authorization = `Bearer ${key}`;
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            try {
                const res = await fetch(url, { method: "GET", headers, signal: controller.signal, cache: "no-store" });
                if (![200, 401, 403, 404].includes(res.status)) {
                    const txt = await res.text().catch(() => "");
                    return NextResponse.json({ ok: false, error: `Supabase REST check failed (${res.status}): ${txt || res.statusText}` }, { status: 502 });
                }
                return NextResponse.json({
                    ok: true,
                    message: `Supabase REST reachable at ${url} (status ${res.status}).`
                });
            } finally {
                clearTimeout(timer);
            }
        }

        if (type === "sqlite") {
            const p = String(conn.sqlite_path || "").trim();
            if (!p) {
                return NextResponse.json({ ok: false, error: "SQLite path is required." }, { status: 400 });
            }
            const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
            if (!fs.existsSync(abs)) {
                return NextResponse.json({ ok: false, error: `SQLite file not found: ${abs}` }, { status: 400 });
            }
            return NextResponse.json({
                ok: true,
                message: `SQLite file exists: ${abs}`
            });
        }

        const fromConnString = parseHostPortFromConnectionString(String(conn.connection_string || ""));
        const host = String(conn.host || fromConnString.host || "").trim();
        const port = Number(conn.port || fromConnString.port || defaultPortForType(type));

        if (!host) {
            return NextResponse.json({ ok: false, error: "Host is required (or provide a valid connection string)." }, { status: 400 });
        }
        if (!port || Number.isNaN(port)) {
            return NextResponse.json({ ok: false, error: "Valid port is required." }, { status: 400 });
        }

        const connectedAddress = await testTcpWithIpFallback(host, port, 6000);
        return NextResponse.json({
            ok: true,
            message: `Connected to ${host}:${port} via ${connectedAddress}. Reachability check passed (does not validate DB credentials or query permissions).`
        });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || "Connection test failed." },
            { status: 500 }
        );
    }
}
