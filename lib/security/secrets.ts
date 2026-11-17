const MIN_SECRET_LENGTH = 32;

export function getSigningSecret(): string {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      "SUPABASE_SECRET_KEY is missing or too short. Signing operations are unavailable."
    );
  }
  return secret;
}
