import type { AddDownloadRequest, BrowserHandoffRequest } from "../../shared/types";

export const BROWSER_HANDOFF_PROTOCOL = "material-download-manager:";
export const BROWSER_HANDOFF_ARGUMENT_PREFIX = "--mdm-download=";

const MAX_URL_LENGTH = 8_192;
const MAX_FILE_NAME_LENGTH = 512;
const MAX_FOLDER_LENGTH = 32_768;

function validHttpUrl(value: string): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function suggestedFileName(value: string): string {
  try {
    const name = decodeURIComponent(new URL(value).pathname.split("/").pop() ?? "").trim();
    return name.slice(0, MAX_FILE_NAME_LENGTH) || "download";
  } catch {
    return "download";
  }
}

function readString(value: string | null, maxLength: number): string {
  return value?.trim().slice(0, maxLength) ?? "";
}

/**
 * Parse the URL shape exposed to browser integrations. The browser supplies
 * capture metadata, while the main process validates and enqueues the same
 * AddDownloadRequest used by the renderer.
 */
export function parseBrowserHandoffUrl(value: string): BrowserHandoffRequest | null {
  if (!value.startsWith(BROWSER_HANDOFF_PROTOCOL)) return null;

  try {
    const handoff = new URL(value);
    if (handoff.protocol !== BROWSER_HANDOFF_PROTOCOL || (handoff.hostname !== "download" && handoff.pathname !== "/download")) {
      return null;
    }

    const url = validHttpUrl(readString(handoff.searchParams.get("url"), MAX_URL_LENGTH));
    if (!url) return null;

    const folder = readString(handoff.searchParams.get("folder"), MAX_FOLDER_LENGTH);
    const fileName = readString(handoff.searchParams.get("fileName"), MAX_FILE_NAME_LENGTH) || suggestedFileName(url);
    const queueId = readString(handoff.searchParams.get("queueId"), 256);
    const start = handoff.searchParams.get("start");

    return {
      url,
      folder,
      fileName,
      queueId: queueId || null,
      startImmediately: start !== "0" && start !== "false",
    };
  } catch {
    return null;
  }
}

/** Extract protocol handoffs from the initial launch or second-instance argv. */
export function extractBrowserHandoffRequests(commandLine: readonly string[]): AddDownloadRequest[] {
  const requests: AddDownloadRequest[] = [];
  for (const argument of commandLine) {
    const candidate = argument.startsWith(BROWSER_HANDOFF_ARGUMENT_PREFIX)
      ? argument.slice(BROWSER_HANDOFF_ARGUMENT_PREFIX.length)
      : argument;
    const request = parseBrowserHandoffUrl(candidate);
    if (request) requests.push(request);
  }
  return requests;
}
