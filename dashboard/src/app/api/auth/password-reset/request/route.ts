import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
    const { email } = await req.json();
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) {
      return NextResponse.json({ message: "If this email exists, a reset link has been sent." });
    }

    const users = readUsers();
    const idx = users.findIndex(
      (u: any) => String(u.email || u.username || "").trim().toLowerCase() === normalized
    );

    if (idx >= 0) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();

      users[idx].password_reset_token_hash = tokenHash;
      users[idx].password_reset_expires_at = expiresAt;
      saveUsers(users);

      const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin;
      const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

      // Placeholder for email integration. In production wire this to SMTP/provider.
      console.log(`[PasswordReset] ${normalized} -> ${resetUrl}`);

      if (process.env.NODE_ENV !== "production") {
        return NextResponse.json({
          message: "Reset link generated. Use the URL below (dev only).",
          reset_url: resetUrl,
        });
      }
    }

    return NextResponse.json({ message: "If this email exists, a reset link has been sent." });
  } catch {
    return NextResponse.json({ message: "If this email exists, a reset link has been sent." });
  }
}

