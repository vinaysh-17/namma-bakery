"use client";

import { useRouter } from "next/navigation";
import { useBroadcastPing } from "./use-broadcast-ping";

/**
 * Renders nothing. Re-fetches the current route's server data (a soft Next.js refresh:
 * no page reload, client state such as selection and filters is preserved) whenever a
 * "changed" ping arrives on the topic.
 */
export function LiveRefresh({ topic }: { topic: string }) {
  const router = useRouter();
  useBroadcastPing([topic], () => router.refresh());
  return null;
}
