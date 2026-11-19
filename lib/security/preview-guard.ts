import "server-only";

/**
 * Application-level guard for Vercel Preview deployments.
 *
 * Blocks mutating server actions when PREVIEW_READ_ONLY=true.
 * This is NOT a database-level guarantee — direct Supabase API
 * calls bypass this guard. Existing RLS policies remain the
 * database-level defence.
 *
 * Every "use server" file that performs INSERT, UPDATE, DELETE,
 * RPC mutations, Storage writes, or Auth mutations must call
 * assertNotPreview() as its first executable line.
 */

const IS_PREVIEW_READ_ONLY = process.env.PREVIEW_READ_ONLY === "true";

export class PreviewReadOnlyError extends Error {
  constructor() {
    super("This operation is not available in Preview mode.");
    this.name = "PreviewReadOnlyError";
  }
}

export function assertNotPreview(): void {
  if (IS_PREVIEW_READ_ONLY) {
    throw new PreviewReadOnlyError();
  }
}
