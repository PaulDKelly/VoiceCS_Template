#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function getConfigPath() {
  if (process.env.APP_CONFIG_PATH) return process.env.APP_CONFIG_PATH;
  const cwd = process.cwd();
  const bundledPath = path.resolve(cwd, "config");
  const sharedPath = path.resolve(cwd, "../shared_code/config");
  if (fs.existsSync(path.join(bundledPath, "users.json"))) return bundledPath;
  if (fs.existsSync(path.join(sharedPath, "users.json"))) return sharedPath;
  return fs.existsSync(bundledPath) ? bundledPath : sharedPath;
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((v) => String(v).trim()).filter(Boolean);
}

function hasWildcard(values) {
  return values.includes("*");
}

function run() {
  const configPath = getConfigPath();
  const usersPath = path.join(configPath, "users.json");
  if (!fs.existsSync(usersPath)) {
    console.log(`[migrate_roles] users.json not found at ${usersPath}`);
    process.exit(0);
  }

  const raw = fs.readFileSync(usersPath, "utf-8");
  const parsed = JSON.parse(raw);
  const users = Array.isArray(parsed.users) ? parsed.users : [];

  let changed = 0;
  const nextUsers = users.map((u) => {
    const role = String(u.role || "").trim();
    if (role !== "admin") return u;
    const allowedIndustries = normalizeList(u.allowed_industries);
    const allowedClients = normalizeList(u.allowed_clients);
    if (!(hasWildcard(allowedIndustries) || hasWildcard(allowedClients))) return u;
    changed += 1;
    return {
      ...u,
      role: "global_admin",
      allowed_industries: ["*"],
      allowed_clients: ["*"],
      permissions: {},
    };
  });

  if (!changed) {
    console.log("[migrate_roles] No wildcard admin accounts found. No changes made.");
    process.exit(0);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(configPath, `users.pre-global-admin-migration.${ts}.json.bak`);
  fs.writeFileSync(backupPath, raw);

  fs.writeFileSync(usersPath, JSON.stringify({ ...parsed, users: nextUsers }, null, 2));
  console.log(`[migrate_roles] Migrated ${changed} user(s) to global_admin.`);
  console.log(`[migrate_roles] Backup written to: ${backupPath}`);
  console.log(`[migrate_roles] Updated file: ${usersPath}`);
}

run();

