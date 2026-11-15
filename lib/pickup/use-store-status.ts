"use client";

import * as React from "react";
import { getStoreStatus } from "./queries";

/**
 * Client-side paused-ordering status (GitHub issue #74).
 *
 * `checked` is false until the first fetch resolves, so callers can avoid flashing a
 * false "not paused" state before anything is known. On any fetch failure this fails
 * OPEN (isPaused: false): place_order / submit_custom_request remain the authority at
 * submission time regardless, so a status-check outage never blocks ordering outright,
 * it just loses the early warning.
 */
export interface OrderingPausedStatus {
  checked: boolean;
  isPaused: boolean;
  pauseMessage: string | null;
}

export function useOrderingPausedStatus(): OrderingPausedStatus {
  const [status, setStatus] = React.useState<OrderingPausedStatus>({
    checked: false,
    isPaused: false,
    pauseMessage: null,
  });

  React.useEffect(() => {
    let isCancelled = false;

    getStoreStatus()
      .then((result) => {
        if (isCancelled) return;
        setStatus({
          checked: true,
          isPaused: result.isPaused,
          pauseMessage: result.pauseMessage ?? null,
        });
      })
      .catch(() => {
        if (isCancelled) return;
        setStatus({ checked: true, isPaused: false, pauseMessage: null });
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return status;
}
