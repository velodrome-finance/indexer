/**
 * Loads the worktree's .env once (dotenv is already a dependency). Values are
 * never printed by the harness.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

let loaded = false;

/**
 * Loads `.env` from the repository root into process.env (no override).
 * @returns void
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const p = path.join(REPO_ROOT, ".env");
  if (existsSync(p)) dotenv.config({ path: p, override: false });
}

/**
 * Reads a required environment variable.
 * @param name - Variable name
 * @returns Its value
 */
export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
