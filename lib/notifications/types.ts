export type NotificationType = "NEW_ORDER" | "NEW_CUSTOM_CAKE";

export interface PortalNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link_url: string;
  related_entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

