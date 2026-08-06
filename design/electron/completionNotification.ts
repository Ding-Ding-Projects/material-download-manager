import type { AppSettings, DownloadItem } from "../shared/types";

export interface CompletionNotificationOptions {
  title: string;
  body: string;
  icon?: string;
}

export interface CompletionNotificationPort {
  isSupported(): boolean;
  show(options: CompletionNotificationOptions): void;
}

/**
 * Completion has one owner: the main-process native notification. The
 * renderer still reports other download states, but it must not duplicate
 * this event. The persisted compatibility key therefore gates this single
 * path and fails closed when the platform cannot show a native notification.
 */
export function notifyDownloadComplete(
  item: Pick<DownloadItem, "fileName">,
  settings: Pick<AppSettings, "showCompleteDialog">,
  port: CompletionNotificationPort,
  icon?: string
): boolean {
  if (!settings.showCompleteDialog || !port.isSupported()) return false;

  port.show({
    title: "Download complete",
    body: item.fileName,
    icon,
  });
  return true;
}
