import { useState, useCallback, useEffect } from "react";

export default function useNotifications() {
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const initUnreads = useCallback((counts: Record<string, number>) => {
    setUnreadCounts(counts);
  }, []);

  const incrementUnread = useCallback((key: string) => {
    setUnreadCounts((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
  }, []);

  const clearUnread = useCallback((key: string) => {
    setUnreadCounts((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const notify = useCallback((title: string, body: string) => {
    // Audio ping
    new Audio('/sounds/notification.mp3').play().catch(() => {});

    // Desktop notification
    if (window.electronAPI?.showNotification) {
      window.electronAPI.showNotification(title, body);
    } else if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  }, []);

  return { unreadCounts, initUnreads, incrementUnread, clearUnread, notify };
}
