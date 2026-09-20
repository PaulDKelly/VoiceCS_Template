import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { getConfigPath } from "@/lib/config";

type LocalUser = {
  id: string;
  username: string;
  email?: string;
  name?: string;
  password_hash?: string;
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

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "").trim().toLowerCase();
        const password = credentials?.password || "";
        if (!email || !password) return null;

        const users = readUsers();
        const user =
          users.find((u) => String((u as any).email || "").trim().toLowerCase() === email) ||
          users.find((u) => String(u.username || "").trim().toLowerCase() === email);
        if (!user?.password_hash) return null;

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return null;

        const canonicalEmail = String((user as any).email || user.username || "").trim().toLowerCase();
        return {
          id: user.id,
          name: user.name || user.username || canonicalEmail,
          email: canonicalEmail,
        };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET && process.env.AZURE_AD_TENANT_ID
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
            tenantId: process.env.AZURE_AD_TENANT_ID,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = (user as any).id;
        token.username = (user as any).name || (user as any).email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token?.username) {
          session.user.name = String(token.username);
        }
        if (token?.userId) {
          (session.user as any).id = String(token.userId);
        }
      }
      return session;
    },
  },
};
