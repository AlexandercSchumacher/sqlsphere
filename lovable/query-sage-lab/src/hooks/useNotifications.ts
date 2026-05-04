/**
 * LOCAL_MODE notifications stub.
 *
 * Notifications come from the alert system in cloud mode. LOCAL_MODE has
 * no alerts, so this hook is a no-op that returns an empty list.
 */

export const useNotifications = () => ({
  notifications: [] as Array<{
    id: string;
    title: string;
    message: string;
    is_read: boolean;
    created_at: string;
  }>,
  unreadCount: 0,
  loading: false,
  markAsRead: async (_id: string) => {},
  markAllAsRead: async () => {},
});
