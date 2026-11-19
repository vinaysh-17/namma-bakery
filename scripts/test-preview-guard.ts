/**
 * Source-level assertion: every "use server" file that performs database/auth/storage
 * mutations must import and call assertNotPreview() from the preview guard module.
 *
 * This test reads source files only — no database, network, or runtime execution.
 *
 * Run: npx tsx scripts/test-preview-guard.ts
 */

import * as fs from "fs";
import * as path from "path";

const LIB_DIR = path.resolve(__dirname, "..", "lib");
const GUARD_IMPORT = "assertNotPreview";
const GUARD_MODULE = "@/lib/security/preview-guard";

// Confirmed read-only RPCs — every .rpc() call NOT in this set is treated as mutating
const READ_ONLY_RPCS = new Set([
  "admin_preview_order_deletion",
  "available_slots",
  "check_cart_items",
  "find_order_token",
  "get_order_by_token",
  "list_orders_for_phone",
  "staff_list_order_history",
]);

// Patterns that indicate a file performs mutations
const MUTATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\.insert\s*\(/, label: ".insert()" },
  { pattern: /\.update\s*\(/, label: ".update()" },
  { pattern: /\.delete\s*\(/, label: ".delete()" },
  { pattern: /\.upsert\s*\(/, label: ".upsert()" },
  { pattern: /\.upload\s*\(/, label: ".upload()" },
  { pattern: /\.remove\s*\(/, label: ".remove()" },
  { pattern: /auth\.signInWith/, label: "auth.signInWith*" },
  { pattern: /auth\.signUp/, label: "auth.signUp" },
  { pattern: /auth\.verifyOtp/, label: "auth.verifyOtp" },
  { pattern: /auth\.admin\.(create|update|delete)/, label: "auth.admin mutation" },
];

// Files that are known to have mutations only inside helpers called from guarded actions
// or are not "use server" files themselves but are transitively called
const HELPER_ALLOWLIST = new Set([
  "lib/admin/order-history-storage.ts",
  "lib/realtime/broadcast.ts",
  "lib/security/rate-limiter.ts",
]);

// Sign-out actions that intentionally have no guard
const SIGNOUT_ALLOWLIST = new Set([
  "staffSignOutAction",
  "portalSignOutToHomeAction",
  "signOutFindOrdersAction",
  "logoutCustomCakeTrackingAction",
]);

function findSourceFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

function getRelPath(absPath: string): string {
  return path.relative(path.resolve(__dirname, ".."), absPath).replace(/\\/g, "/");
}

/** Extract all .rpc("name") calls from a code string, returning the RPC names. */
function extractRpcNames(code: string): string[] {
  const rpcRegex = /\.rpc\s*\(\s*["'`]([a-z_]+)["'`]/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = rpcRegex.exec(code)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Check if a code string contains mutating patterns (static patterns OR non-read-only RPCs). */
function hasMutations(code: string): boolean {
  if (MUTATION_PATTERNS.some(({ pattern }) => pattern.test(code))) return true;
  const rpcs = extractRpcNames(code);
  return rpcs.some((name) => !READ_ONLY_RPCS.has(name));
}

interface Finding {
  file: string;
  issue: string;
}

function main() {
  const findings: Finding[] = [];
  let serverActionFiles = 0;
  let mutatingFiles = 0;
  let guardedFiles = 0;

  const allFiles = findSourceFiles(LIB_DIR);

  for (const file of allFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const relPath = getRelPath(file);

    if (HELPER_ALLOWLIST.has(relPath)) continue;

    const isServerAction = /^["']use server["']/.test(content.trim());
    if (!isServerAction) continue;

    serverActionFiles++;

    if (!hasMutations(content)) continue;

    mutatingFiles++;

    const hasGuardImport = content.includes(GUARD_IMPORT) && content.includes(GUARD_MODULE);
    if (!hasGuardImport) {
      findings.push({ file: relPath, issue: "Missing import of assertNotPreview" });
      continue;
    }

    guardedFiles++;

    // Per-function check
    const fnRegex = /export\s+async\s+function\s+(\w+)/g;
    let match: RegExpExecArray | null;

    while ((match = fnRegex.exec(content)) !== null) {
      const fnName = match[1];

      if (SIGNOUT_ALLOWLIST.has(fnName)) continue;

      const fnStart = match.index;
      const nextExport = content.indexOf("export ", fnStart + 1);
      const fnBody = content.slice(fnStart, nextExport === -1 ? undefined : nextExport);

      if (!hasMutations(fnBody)) continue;

      if (!fnBody.includes("assertNotPreview()")) {
        findings.push({
          file: relPath,
          issue: `Function ${fnName}() performs mutations but does not call assertNotPreview()`,
        });
      }
    }
  }

  // Admin client graceful degradation check
  const adminClientFiles = allFiles.filter((f) => {
    const content = fs.readFileSync(f, "utf-8");
    return content.includes("createAdminClient") && !HELPER_ALLOWLIST.has(getRelPath(f));
  });

  let adminClientCallCount = 0;
  let adminClientDegradedCount = 0;

  for (const file of adminClientFiles) {
    const content = fs.readFileSync(file, "utf-8");

    if (content.includes("createAdminClient()") || content.includes("createAdminClient()\n")) {
      adminClientCallCount++;
      if (content.includes("isAdminClientAvailable")) {
        adminClientDegradedCount++;
      }
    }
  }

  // Report
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║     Preview Read-Only Guard — Source-Level Audit     ║");
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log(`║  "use server" files scanned:  ${String(serverActionFiles).padStart(3)}                   ║`);
  console.log(`║  Files with mutations:        ${String(mutatingFiles).padStart(3)}                   ║`);
  console.log(`║  Files with guard import:     ${String(guardedFiles).padStart(3)}                   ║`);
  console.log(`║  Admin client files:          ${String(adminClientCallCount).padStart(3)}                   ║`);
  console.log(`║  With graceful degradation:   ${String(adminClientDegradedCount).padStart(3)}                   ║`);
  console.log("╠═══════════════════════════════════════════════════════╣");

  if (findings.length === 0) {
    console.log("║  ✓ All mutating server actions are guarded            ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("\nPASS: Preview read-only guard coverage is complete.");
    process.exit(0);
  } else {
    console.log(`║  ✗ ${findings.length} finding(s) require attention                    ║`);
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("\nFindings:");
    for (const f of findings) {
      console.log(`  [FAIL] ${f.file}: ${f.issue}`);
    }
    console.log(`\nFAIL: ${findings.length} unguarded mutation path(s) detected.`);
    process.exit(1);
  }
}

main();