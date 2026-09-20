import fs from "fs";
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getConfigPath } from "@/lib/config";

type LocalUser = {
  id: string;
  username: string;
  name?: string;
  role: "global_admin" | "admin" | "user";
  allowed_clients?: string[];
  allowed_industries?: string[];
  permissions?: Record<string, boolean>;
  email?: string;
};

function readUsers(): LocalUser[] {
  try {
    const usersPath = path.join(getConfigPath(), "users.json");
    if (!fs.existsSync(usersPath)) return [];
    const content = fs.readFileSync(usersPath, "utf-8");
    const data = JSON.parse(content);
    return data.users || [];
  } catch {
    return [];
  }
}

export async function getAuthenticatedUser(): Promise<LocalUser | null> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user as (LocalUser & { id?: string }) | undefined;
  if (!sessionUser) return null;

  const users = readUsers();
  const sessionId = String(sessionUser.id || "").trim();
  const normalized = String(sessionUser.name || sessionUser.email || "")
    .trim()
    .toLowerCase();

  const byId = sessionId ? users.find((u) => String(u.id) === sessionId) : null;
  const byUsername = users.find((u) => String(u.username || "").trim().toLowerCase() === normalized);
  const byEmail = users.find((u) => String(u.email || "").trim().toLowerCase() === normalized);
  const localUser = byId || byUsername || byEmail;

  if (!localUser) return null;

  return {
    ...localUser,
    name: localUser.name || localUser.username,
  };
}
