"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to content-free "changed" pings (Supabase Realtime Broadcast) on the given
 * topics and calls `onPing` (debounced) when one arrives.
 *
 * - One channel per topic, removed on cleanup/unmount/topic change (no duplicates, even
 *   under React Strict Mode double-mounting).
 * - Catches up after missed events without polling: when a channel re-subscribes after a
 *   drop, and when the tab becomes visible again.
 * - Always uses the latest `onPing` (no stale closures).
 */
export function useBroadcastPing(topics: string[], onPing: () => void): void {
  const onPingRef = React.useRef(onPing);
  React.useEffect(() => {
    onPingRef.current = onPing;
  });

  const topicKey = topics.filter(Boolean).join("|");

  React.useEffect(() => {
    if (!topicKey) return;

    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onPingRef.current(), 250);
    };

    const alreadySubscribed = new Set<string>();
    const channels = topicKey.split("|").map((topic) => {
      const channel = supabase.channel(topic, {
        config: { broadcast: { self: false } },
      });
      channel
        .on("broadcast", { event: "changed" }, fire)
        .subscribe((status: string) => {
          if (status === "SUBSCRIBED") {
            // A re-subscribe means the connection dropped: catch up on anything missed
            if (alreadySubscribed.has(topic)) fire();
            alreadySubscribed.add(topic);
          }
        });
      return channel;
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [topicKey]);
}
