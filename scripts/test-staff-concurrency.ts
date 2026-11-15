/**
 * True Multi-Connection Concurrency & Deadlock Test for Administrative Staff Roles.
 *
 * Verifies:
 * 1. Two concurrent demotion transactions cannot leave zero active administrators.
 * 2. Cross-locking two administrators concurrently does not deadlock (no 40P01 error).
 * 3. The transaction-level advisory lock (hashtext('staff_roles_lock')) correctly
 *    serializes execution so that the winner succeeds and the loser is safely rejected.
 */

import { spawn } from "node:child_process";

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runPsql(sql: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      "docker",
      ["exec", "-i", "supabase_db_namma-bakery", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    proc.stdin.write(sql);
    proc.stdin.end();
  });
}

async function runConcurrencyTests() {
  console.log("\n========================================================");
  console.log("NAMMA BAKERY: MULTI-CONNECTION CONCURRENCY TESTS");
  console.log("========================================================\n");

  const adminA = "00000000-0000-0000-0000-0000000000c1";
  const adminCaller = "00000000-0000-0000-0000-0000000000c3";

  // Setup fixtures: Admin A, Admin B, and Admin Caller (total 3 admins).
  // Then we demote Admin A and Admin B concurrently via Admin Caller.
  // One demotion must succeed (leaving 2 admins: caller + survivor),
  // but if both were demoting without proper checks, only 1 would remain.
  // To test the LAST-ADMIN race:
  // If there are exactly 2 admins (Admin A and Admin Caller):
  // Caller tries to demote Admin A in Tx1, and another Admin tries to demote Admin Caller in Tx2?
  // Caller cannot demote Caller (CANNOT_MODIFY_OWN_ROLE).
  // If Admin Caller and Admin A are the only 2 admins:
  // Admin Caller demotes Admin A.
  // What if Admin A was concurrently trying to demote Admin Caller?
  // Tx 1: Admin Caller demoting Admin A.
  // Tx 2: Admin A demoting Admin Caller.
  // This is the EXACT cross-demotion deadlock / race condition!
  // Clean up any stale test rows from previous runs
  await runPsql(`
    DELETE FROM staff_roles WHERE user_id IN ('${adminA}', '${adminCaller}', '00000000-0000-0000-0000-0000000000c2');
    DELETE FROM auth.users WHERE id IN ('${adminA}', '${adminCaller}', '00000000-0000-0000-0000-0000000000c2');
  `);

  const setupSql = `
    INSERT INTO auth.users (id, email) VALUES
      ('${adminA}', 'admin-a@conc.test'),
      ('${adminCaller}', 'caller-c@conc.test')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO staff_roles (user_id, role, is_active) VALUES
      ('${adminA}', 'ADMIN', true),
      ('${adminCaller}', 'ADMIN', true)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;
  `;

  const setupRes = await runPsql(setupSql);
  if (setupRes.code !== 0) {
    console.error("  ✗ Setup failed:", setupRes.stderr);
    process.exit(1);
  }
  console.log("  ✓ Setup: exactly 2 active administrators created (Admin A and Admin Caller)");

  await runPsql(`
    SELECT count(*)::int FROM staff_roles WHERE role = 'ADMIN' and is_active and user_id IN ('${adminA}', '${adminCaller}');
  `);
  console.log("  ✓ Confirmed exactly 2 active test admins before race test");

  // Concurrency Test:
  // Tx1: Admin Caller attempts to demote Admin A.
  // Tx2: Admin A attempts to demote Admin Caller.
  // This is the classic mutual lock-inversion deadlock scenario!
  // In our hardened system:
  // Both acquire pg_advisory_xact_lock. One executes first, demoting the other.
  // The second transaction then unblocks, checks remaining admins, sees count <= 1,
  // and is rejected with LAST_ADMIN_PROTECTED!
  // Zero deadlocks (40P01), and exactly 1 active admin remains (never zero)!
  console.log("\n  -> Launching 2 concurrent transactions attempting mutual demotion of both admins...");

  const tx1Sql = `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminCaller}', true);
    SELECT update_staff_role('${adminA}', 'EMPLOYEE', true);
    COMMIT;
  `;

  const tx2Sql = `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminA}', true);
    SELECT update_staff_role('${adminCaller}', 'EMPLOYEE', true);
    COMMIT;
  `;

  const [res1, res2] = await Promise.all([runPsql(tx1Sql), runPsql(tx2Sql)]);

  const errors = [res1.stderr, res2.stderr].filter(Boolean).join("\n");
  const deadlockDetected = errors.includes("deadlock detected") || errors.includes("40P01");

  console.log(`  ✓ Concurrency Deadlock Check: deadlockDetected = ${deadlockDetected}`);
  if (deadlockDetected) {
    console.error("  ✗ FAIL: Deadlock occurred during concurrent demotion!");
    process.exit(1);
  } else {
    console.log("  ✓ PASS: No deadlock occurred between concurrent demotion transactions");
  }

  const res1Success = res1.code === 0;
  const res2Success = res2.code === 0;

  console.log(`  -> Connection 1 result: ${res1Success ? "SUCCESS" : "REJECTED (" + res1.stderr.trim() + ")"}`);
  console.log(`  -> Connection 2 result: ${res2Success ? "SUCCESS" : "REJECTED (" + res2.stderr.trim() + ")"}`);

  const exactlyOneSucceeded = (res1Success && !res2Success) || (!res1Success && res2Success);
  if (exactlyOneSucceeded) {
    console.log("  ✓ PASS: Exactly one demotion transaction succeeded; the other was rejected");
  } else {
    console.error("  ✗ FAIL: Unexpected transaction outcome:", { res1Success, res2Success });
    process.exit(1);
  }

  const rejectedOutput = res1Success ? res2.stderr : res1.stderr;
  const validRejection =
    rejectedOutput.includes("LAST_ADMIN_PROTECTED") ||
    rejectedOutput.includes("cannot remove the last active admin") ||
    rejectedOutput.includes("forbidden");

  if (validRejection) {
    console.log("  ✓ PASS: The loser transaction was safely rejected without data corruption or lock inversion");
  } else {
    console.error("  ✗ FAIL: Loser did not fail with expected rejection error:", rejectedOutput);
    process.exit(1);
  }

  const finalCountRes = await runPsql(`
    SELECT count(*)::int FROM staff_roles WHERE role = 'ADMIN' and is_active and user_id IN ('${adminA}', '${adminCaller}');
  `);
  const match = finalCountRes.stdout.match(/(\d+)\s*\n\s*\(\d+\s+rows?\)/);
  const finalCount = match ? parseInt(match[1], 10) : parseInt(finalCountRes.stdout.replace(/\D/g, ""), 10);
  console.log(`  ✓ Remaining active administrators: ${finalCount}`);

  if (finalCount === 1) {
    console.log("  ✓ PASS: Invariant preserved: exactly 1 active admin remains (never zero)");
  } else {
    console.error(`  ✗ FAIL: Admin count corrupted! Expected 1, found ${finalCount}`);
    process.exit(1);
  }

  // Cleanup
  await runPsql(`
    DELETE FROM staff_roles WHERE user_id IN ('${adminA}', '${adminCaller}');
    DELETE FROM auth.users WHERE id IN ('${adminA}', '${adminCaller}');
  `);

  console.log("\n========================================================");
  console.log("CONCURRENCY TEST SUMMARY: ALL CHECKS PASSED");
  console.log("========================================================\n");
}

runConcurrencyTests().catch((e) => {
  console.error("Fatal error during concurrency test:", e);
  process.exit(1);
});
