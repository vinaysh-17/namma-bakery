import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Live-update "ping" channel (Supabase Realtime Broadcast).
 *
 * Why broadcast instead of postgres_changes: customers are anonymous and cannot read
 * `orders` / `custom_cake_requests` under RLS, so row-change events would never reach
 * them (and must not, they would expose data). Instead, after a successful server-side
 * change we publish a content-free "changed" ping on an unguessable topic; the viewing
 * client then re-fetches through the existing token / session based server paths.
 *
 * Topics are HMAC(SUPABASE_SECRET_KEY, kind:id) so they cannot be derived by a client
 * that does not already hold the record. Pings carry no data. Sending is best-effort:
 * a realtime outage never fails or slows the underlying action.
 */

const PING_EVENT = "changed";
const SEND_TIMEOUT_MS = 3000;

function topicFor(kind: string, id: string): string {
  const secret = process.env.SUPABASE_SECRET_KEY || "";
  const digest = createHmac("sha256", secret)
    .update(`${kind}:${id}`)
    .digest("hex")
    .slice(0, 32);
  return `${kind}:${digest}`;
}

/** Topic a customer's order tracking page listens on (keyed by order number). */
export function orderTopic(orderNumber: string): string {
  return topicFor("order", orderNumber);
}

/** Topic a customer's custom cake tracking view listens on (keyed by request id). */
export function customRequestTopic(requestId: string): string {
  return topicFor("custom", requestId);
}

/** Topic the Staff Portal listens on; only delivered to authenticated staff pages. */
export function staffTopic(): string {
  return topicFor("staff", "portal");
}

async function sendPing(topics: string[]): Promise<void> {
  try {
    const admin = createAdminClient();
    await Promise.race([
      Promise.all(
        topics.map(async (topic) => {
          const channel = admin.channel(topic);
          try {
            const res = await channel.httpSend(PING_EVENT, { at: Date.now() });
            if (!res.success) {
              console.warn("[realtime] ping not delivered:", topic.split(":")[0]);
            }
          } finally {
            await admin.removeChannel(channel);
          }
        })
      ),
      new Promise<void>((resolve) => setTimeout(resolve, SEND_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn("[realtime] ping failed:", err instanceof Error ? err.message : err);
  }
}

/** Ping staff portals only (e.g. a new order / custom cake request was created). */
export async function notifyStaffChanged(): Promise<void> {
  await sendPing([staffTopic()]);
}

/** An order changed: update the customer tracking page for it and all staff portals. */
export async function notifyOrderChanged(orderId: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("orders")
      .select("order_number")
      .eq("id", orderId)
      .maybeSingle();
    const topics = [staffTopic()];
    if (data?.order_number) topics.push(orderTopic(data.order_number));
    await sendPing(topics);
  } catch (err) {
    console.warn("[realtime] order ping failed:", err instanceof Error ? err.message : err);
  }
}

/** A custom cake request changed: update the customer's tracking view and staff portals. */
export async function notifyCustomRequestChanged(requestId: string): Promise<void> {
  await sendPing([customRequestTopic(requestId), staffTopic()]);
}
