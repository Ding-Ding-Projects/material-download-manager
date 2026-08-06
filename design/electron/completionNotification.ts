import type { AppSettings, DownloadItem } from "../shared/types";

export interface CompletionNotificationOptions {
  title: string;
  body: string;
  icon?: string;
}

/**
 * The native notification port keeps Electron out of the decision logic so
 * the compatibility setting can be tested without launching a desktop.
 */
export interface CompletionNotificationPort {
  isSupported(): boolean;
  show(options: CompletionNotificationOptions): void;
}

/**
 * Completion has one owner: the main-process native notification. The
 * renderer still reports other download states, but it must not duplicate
 * this event. The persisted compatibility key therefore gates this single
 * path and fails closed when the platform cannot show a native notification.
 * `showCompleteDialog` is an old persisted key whose current meaning is
 * whether this non-blocking completion notification is shown.
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
