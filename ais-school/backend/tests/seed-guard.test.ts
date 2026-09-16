import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const seedScript = join(backendRoot, "src", "seed.ts");
const tsxBin = join(backendRoot, "node_modules", ".bin", "tsx");

// Runs the real seed script in a throwaway directory (via DATA_FILE) so
// these tests never touch the developer's own backend/data.json.
function runSeed(env: Record<string, string | undefined>, extraArgs: string[] = []) {
  const dataDir = mkdtempSync(join(tmpdir(), "ais-seed-test-"));
  const dataFile = join(dataDir, "data.json");
  const merged: Record<string, string | undefined> = { ...process.env, ...env, DATA_FILE: dataFile };
  // Allow a caller to truly unset a var (e.g. NODE_ENV) by passing `undefined`
  // — plain object spread can't remove a key that process.env already set
  // (the npm script that runs these tests sets NODE_ENV=test), so do it explicitly.
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return execFileAsync(tsxBin, [seedScript, ...extraArgs], { cwd: backendRoot, env: merged as NodeJS.ProcessEnv })
    .then((r) => ({ ...r, code: 0, dataDir }))
    .catch((e) => ({ stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1, dataDir }))
    .finally(() => rmSync(dataDir, { recursive: true, force: true }));
}

describe("seed script — production safeguard", () => {
  test("refuses to run when NODE_ENV=production and --force is not passed", async () => {
    const result = await runSeed({ NODE_ENV: "production" });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Refusing to run/i);
    assert.match(result.stderr, /--force/);
  });

  test("proceeds when NODE_ENV=production and --force IS passed", async () => {
    const result = await runSeed({ NODE_ENV: "production" }, ["--force"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Seed complete/i);
  });

  test("runs normally in development with no flag needed", async () => {
    const result = await runSeed({ NODE_ENV: "development" });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Seed complete/i);
  });

  test("runs normally when NODE_ENV is unset entirely", async () => {
    const result = await runSeed({ NODE_ENV: undefined });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Seed complete/i);
  });
});
