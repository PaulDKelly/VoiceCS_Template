import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getConfigPath } from "@/lib/config";

export const dynamic = "force-dynamic";

function getUsersPath() {
  return path.join(getConfigPath(), "users.json");
}

function readUsers() {
  const p = getUsersPath();
  if (!fs.existsSync(p)) return [] as any[];
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return data.users || [];
  } catch {
    return [] as any[];
  }
}

function saveUsers(users: any[]) {
  const p = getUsersPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ users }, null, 2));
}

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();
    const t = String(token || "").trim();
    const pw = String(password || "");

    if (!t || pw.length < 8) {
      return NextResponse.json({ error: "Invalid token or password too short." }, { status: 400 });
    }

    const tokenHash = crypto.createHash("sha256").update(t).digest("hex");
    const users = readUsers();
    const now = Date.now();
    const idx = users.findIndex((u: any) => {
      if (String(u.password_reset_token_hash || "") !== tokenHash) return false;
      const exp = new Date(String(u.password_reset_expires_at || 0)).getTime();
      return Number.isFinite(exp) && exp > now;
    });

    if (idx < 0) {
      return NextResponse.json({ error: "Reset token is invalid or expired." }, { status: 400 });
    }

    users[idx].password_hash = await bcrypt.hash(pw, 10);
    delete users[idx].password_reset_token_hash;
    delete users[idx].password_reset_expires_at;
    saveUsers(users);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Reset failed." }, { status: 500 });
  }
}

