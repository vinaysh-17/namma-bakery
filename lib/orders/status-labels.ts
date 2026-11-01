/**
 * Customer-facing, human-readable status labels (never show raw enum values such as
 * READY_FOR_PICKUP to customers).
 */
const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  PREPARING: "Accepted",
  READY_FOR_PICKUP: "Ready for pickup",
  COMPLETED: "Completed",
  REJECTED: "Not accepted",
  CANCELLED: "Cancelled",
  NO_SHOW: "Not collected",
};

const CUSTOM_REQUEST_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Request received",
  UNDER_REVIEW: "Under review",
  NEEDS_CLARIFICATION: "We need more details",
  QUOTED: "Quote ready",
  CUSTOMER_ACCEPTED: "Accepted",
  DECLINED: "Not accepted",
  CUSTOMER_DECLINED: "Declined",
  EXPIRED: "Expired",
  WITHDRAWN: "Withdrawn",
};

function fallbackLabel(status: string): string {
  const text = status.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatCustomerOrderStatus(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? fallbackLabel(status);
}

export function formatCustomerRequestStatus(status: string): string {
  return CUSTOM_REQUEST_STATUS_LABELS[status] ?? fallbackLabel(status);
}
