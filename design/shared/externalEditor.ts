/**
 * Safe, renderer-facing facts for the optional local editor handoff.
 *
 * The renderer never receives an editor process handle or a child-process
 * error object. It receives a bounded descriptor and a plain result that can
 * be shown as a non-blocking notification.
 */

export const EXTERNAL_EDITOR_SCHEMA_VERSION = 1 as const;
export const EXTERNAL_EDITOR_MAX_PATH_LENGTH = 4_096;
export const EXTERNAL_EDITOR_MAX_FILE_NAME_LENGTH = 160;
export const EXTERNAL_EDITOR_MAX_EXPORT_BYTES = 2 * 1024 * 1024;

export type ExternalEditorId = "vscode" | "vscode-insiders" | "custom";
export type ExternalEditorSource = "path" | "known-install" | "configured";

export interface ExternalEditorDescriptor {
  id: ExternalEditorId;
  label: string;
  executable: string;
  source: ExternalEditorSource;
}
export interface ExternalEditorDiscovery {
  schemaVersion: typeof EXTERNAL_EDITOR_SCHEMA_VERSION;
  editors: ExternalEditorDescriptor[];
  selectedExecutable: string | null;
}

export interface ExternalEditorOpenResult {
  schemaVersion: typeof EXTERNAL_EDITOR_SCHEMA_VERSION;
  opened: boolean;
  editor: ExternalEditorDescriptor | null;
  filePath: string | null;
  workspacePath: string | null;
  error: string | null;
}

/** Windows is the supported delivery target; the leading slash keeps
 * deterministic validator tests portable. */
export function isSafeAbsolutePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > EXTERNAL_EDITOR_MAX_PATH_LENGTH) return false;
  if (/[\u0000-\u001f\u007f]/u.test(value) || value.trim() !== value) return false;
  if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/u.test(value)) return false;
  return !value.split(/[\\/]+/u).some((segment) => segment === "..");
}

export function isSafeEditorExecutable(value: unknown): value is string {
  return isSafeAbsolutePath(value) || (typeof value === "string" && /^(?:code|code-insiders)(?:\.cmd)?$/u.test(value));
}

export function isSafeExportFileName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > EXTERNAL_EDITOR_MAX_FILE_NAME_LENGTH) return false;
  if (value === "." || value === ".." || value.trim() !== value) return false;
  if (/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(value)) return false;
  return !value.endsWith(".") && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(value);
}

export function isExternalEditorDescriptor(value: unknown): value is ExternalEditorDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.id === "vscode" || candidate.id === "vscode-insiders" || candidate.id === "custom")
    && typeof candidate.label === "string" && candidate.label.length > 0 && candidate.label.length <= 128
    && isSafeEditorExecutable(candidate.executable)
    && (candidate.source === "path" || candidate.source === "known-install" || candidate.source === "configured");
}

export function isExternalEditorDiscovery(value: unknown): value is ExternalEditorDiscovery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === EXTERNAL_EDITOR_SCHEMA_VERSION
    && Array.isArray(candidate.editors)
    && candidate.editors.length <= 16
    && candidate.editors.every(isExternalEditorDescriptor)
    && (candidate.selectedExecutable === null || isSafeEditorExecutable(candidate.selectedExecutable));
}

export function isExternalEditorOpenResult(value: unknown): value is ExternalEditorOpenResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === EXTERNAL_EDITOR_SCHEMA_VERSION
    && typeof candidate.opened === "boolean"
    && (candidate.editor === null || isExternalEditorDescriptor(candidate.editor))
    && (candidate.filePath === null || isSafeAbsolutePath(candidate.filePath))
    && (candidate.workspacePath === null || isSafeAbsolutePath(candidate.workspacePath))
    && (candidate.error === null || (typeof candidate.error === "string" && candidate.error.length > 0 && candidate.error.length <= 512))
    && (candidate.opened
      ? candidate.editor !== null && candidate.workspacePath !== null && (candidate.filePath !== null || candidate.workspacePath !== null) && candidate.error === null
      : candidate.error !== null);
}
