// "Today at 3:45:12 PM" / "Yesterday at 3:45:12 PM" / "5/19/2026 3:45:12 PM"
// for message timestamps. Day boundary is the viewer's local midnight.
export function formatMessageTimestamp(timestamp: number | string | Date): string {
  const d = new Date(timestamp);
  const time = d.toLocaleTimeString();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msgDay = new Date(d);
  msgDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
  if (dayDiff <= 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
}

// Compact "3:45 PM" — used for the hover tooltip on grouped messages.
export function formatShortTime(timestamp: number | string | Date): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// True when `curr` should visually attach to `prev` as a continuation:
// same sender, sent within `windowMs`, same calendar day, and not a reply
// (replies always start a fresh block so the quote has context).
const GROUP_WINDOW_MS = 7 * 60 * 1000;
export function shouldGroupMessages(
  prev: { sender: string; timestamp: string | number | Date } | undefined | null,
  curr: { sender: string; timestamp: string | number | Date; replyToId?: string | null },
): boolean {
  if (!prev) return false;
  if (curr.replyToId) return false;
  if (prev.sender !== curr.sender) return false;
  const prevT = new Date(prev.timestamp).getTime();
  const currT = new Date(curr.timestamp).getTime();
  if (Math.abs(currT - prevT) > GROUP_WINDOW_MS) return false;
  const prevDay = new Date(prevT);
  prevDay.setHours(0, 0, 0, 0);
  const currDay = new Date(currT);
  currDay.setHours(0, 0, 0, 0);
  return prevDay.getTime() === currDay.getTime();
}
