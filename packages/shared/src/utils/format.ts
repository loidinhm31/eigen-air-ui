import { format, formatDistanceToNow } from "date-fns";

export function formatDateTime(date: Date | string | number): string {
  return format(new Date(date), "PPp");
}

export function formatRelativeTime(date: Date | string | number): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}
