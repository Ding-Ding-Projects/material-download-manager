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
 * `showCompleteDialog` is an old persisted key. Its current user-facing
 * meaning is whether a non-blocking completion notification is shown.
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
