import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "cake-references";
const BATCH = 100;
const MAX_BATCHES = 10;

/**
 * Removes custom cake reference photos that were orphaned by Order History deletions
 * (manual deletes and the automatic 3-month cleanup).
 *
 * Why a queue: SQL / pg_cron cannot delete files from Supabase Storage, so every deletion
 * writes the photo paths to public.storage_cleanup_queue inside the same transaction. This
 * server-only helper then removes those files from the private cake-references bucket and
 * clears the queue rows it removed. Files that fail stay queued and are retried next time.
 *
 * It can only (a) read/delete rows of the queue table and (b) remove objects from the
 * cake-references bucket. It is called only after an admin session was verified.
 */
export async function drainCakeReferenceCleanupQueue(): Promise<{
  removed: number;
  failed: number;
}> {
  let removed = 0;
  let failed = 0;

  try {
    const admin = createAdminClient();

    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data: rows, error } = await admin
        .from("storage_cleanup_queue")
        .select("id, path")
        .eq("bucket", BUCKET)
        .order("id", { ascending: true })
        .limit(BATCH);

      if (error) {
        console.error("[orderHistory] cleanup queue read failed:", error.code);
        // Queue table missing (migration 0015 not applied yet) or unreadable: nothing to do
        return { removed, failed };
      }
      if (!rows || rows.length === 0) break;

      const paths = rows.map((r) => r.path as string);
      const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
      if (removeError) {
        console.error("[orderHistory] reference photo cleanup failed:", removeError.message);
        failed += rows.length;
        break; // leave them queued; retried on the next run
      }

      const { error: clearError } = await admin
        .from("storage_cleanup_queue")
        .delete()
        .in(
          "id",
          rows.map((r) => r.id as number)
        );
      if (clearError) {
        console.error("[orderHistory] cleanup queue clear failed:", clearError.code);
        break;
      }
      removed += rows.length;

      if (rows.length < BATCH) break;
    }
  } catch (err) {
    console.error("[orderHistory] cleanup queue exception:", err);
  }

  return { removed, failed };
}
