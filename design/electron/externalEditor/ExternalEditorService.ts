import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  EXTERNAL_EDITOR_MAX_EXPORT_BYTES,
  EXTERNAL_EDITOR_SCHEMA_VERSION,
  isSafeAbsolutePath,
  isSafeEditorExecutable,
  isSafeExportFileName,
  type ExternalEditorDescriptor,
  type ExternalEditorDiscovery,
  type ExternalEditorId,
  type ExternalEditorOpenResult,
} from "../../shared/externalEditor";

const execFileAsync = promisify(execFile);

export interface ExternalEditorServiceOptions {
  which?: (command: string) => Promise<string | null>;
  fileExists?: (filePath: string) => Promise<boolean>;
  directoryExists?: (directoryPath: string) => Promise<boolean>;
  launch?: (executable: string, args: string[]) => Promise<void>;
  environment?: NodeJS.ProcessEnv;
}

function defaultFileExists(filePath: string): Promise<boolean> {
  return fsp.stat(filePath).then((stat) => stat.isFile(), () => false);
}

function defaultDirectoryExists(directoryPath: string): Promise<boolean> {
  return fsp.stat(directoryPath).then((stat) => stat.isDirectory(), () => false);
}

async function defaultWhich(command: string): Promise<string | null> {
  try {
    const result = await execFileAsync("where.exe", [command], { windowsHide: true, timeout: 3_000, maxBuffer: 16 * 1024 });
    const first = String(result.stdout).split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
    return isSafeEditorExecutable(first) ? first : null;
  } catch {
    return null;
  }
}

function defaultLaunch(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(executable, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        // Never invoke a user-selected path through a shell.  The editor
        // resolver converts the supported VS Code launchers to their native
        // executable before this boundary.
        shell: false,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function knownInstallPaths(environment: NodeJS.ProcessEnv): Array<{ id: ExternalEditorId; path: string }> {
  const localAppData = environment.LOCALAPPDATA;
  const programFiles = environment.ProgramFiles;
  const programFilesX86 = environment["ProgramFiles(x86)"];
  const userProfile = environment.USERPROFILE;
  const candidates: Array<{ id: ExternalEditorId; path: string }> = [];
  const addPair = (root: string, suffix: string) => {
    candidates.push({ id: "vscode", path: path.join(root, suffix, "Microsoft VS Code", "bin", "code.cmd") });
    candidates.push({ id: "vscode-insiders", path: path.join(root, suffix, "Microsoft VS Code Insiders", "bin", "code-insiders.cmd") });
  };
  if (localAppData) addPair(localAppData, "Programs");
  if (programFiles) addPair(programFiles, "");
  if (programFilesX86) addPair(programFilesX86, "");
  if (userProfile) addPair(userProfile, "AppData\\Local\\Programs");
  return candidates;
}

function descriptor(id: ExternalEditorId, executable: string, source: ExternalEditorDescriptor["source"]): ExternalEditorDescriptor {
  return {
    id,
    label: id === "vscode-insiders" ? "Visual Studio Code Insiders" : id === "vscode" ? "Visual Studio Code" : "Configured editor",
    executable,
    source,
  };
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function failure(
  editor: ExternalEditorDescriptor | null,
  filePath: string | null,
  workspacePath: string | null,
  error: string,
): ExternalEditorOpenResult {
  return {
    schemaVersion: EXTERNAL_EDITOR_SCHEMA_VERSION,
    opened: false,
    editor,
    filePath,
    workspacePath,
    error: error.slice(0, 512),
  };
}

export class ExternalEditorService {
  private readonly which: (command: string) => Promise<string | null>;
  private readonly fileExists: (filePath: string) => Promise<boolean>;
  private readonly directoryExists: (directoryPath: string) => Promise<boolean>;
  private readonly launch: (executable: string, args: string[]) => Promise<void>;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(private readonly userDataPath: string, options: ExternalEditorServiceOptions = {}) {
    this.which = options.which ?? defaultWhich;
    this.fileExists = options.fileExists ?? defaultFileExists;
    this.directoryExists = options.directoryExists ?? defaultDirectoryExists;
    this.launch = options.launch ?? defaultLaunch;
    this.environment = options.environment ?? process.env;
  }

  async discover(configuredExecutable: string | null = null): Promise<ExternalEditorDiscovery> {
    const editors: ExternalEditorDescriptor[] = [];
    const seen = new Set<string>();
    const add = async (candidate: ExternalEditorDescriptor | null) => {
      if (!candidate || !isSafeEditorExecutable(candidate.executable)) return;
      const key = candidate.executable.toLowerCase();
      if (seen.has(key)) return;
      if (isSafeAbsolutePath(candidate.executable) && !(await this.fileExists(candidate.executable))) return;
      seen.add(key);
      editors.push(candidate);
    };

    if (configuredExecutable && isSafeEditorExecutable(configuredExecutable)) {
      await add(descriptor("custom", configuredExecutable, "configured"));
    }
    const pathCandidates = await Promise.all([
      this.which("code").then((value) => value ? descriptor("vscode", value, "path") : null),
      this.which("code-insiders").then((value) => value ? descriptor("vscode-insiders", value, "path") : null),
    ]);
    for (const candidate of pathCandidates) await add(candidate);
    for (const candidate of knownInstallPaths(this.environment)) {
      await add(descriptor(candidate.id, candidate.path, "known-install"));
    }
    return {
      schemaVersion: EXTERNAL_EDITOR_SCHEMA_VERSION,
      editors,
      selectedExecutable: editors[0]?.executable ?? null,
    };
  }

  async openExport(content: string, fileName: string, configuredExecutable: string | null = null): Promise<ExternalEditorOpenResult> {
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > EXTERNAL_EDITOR_MAX_EXPORT_BYTES) {
      return failure(null, null, null, "The export is too large to open in the external editor.");
    }
    if (!isSafeExportFileName(fileName)) return failure(null, null, null, "The export file name is not safe.");
    const discovery = await this.discover(configuredExecutable);
    if (configuredExecutable && !discovery.editors.some((candidate) => candidate.executable === configuredExecutable)) {
      return failure(null, null, null, "The selected editor is unavailable. Choose automatic discovery or refresh the editor list in Settings.");
    }
    const editor = configuredExecutable
      ? discovery.editors.find((candidate) => candidate.executable === configuredExecutable) ?? null
      : discovery.editors[0] ?? null;
    if (!editor) return failure(null, null, null, "Visual Studio Code was not found. Install it or choose an editor executable in Settings.");
    const workspacePath = path.resolve(this.userDataPath, "exports");
    // A fresh per-export directory means an existing file or reparse point
    // can never be followed by the write. The human-readable file name stays
    // intact inside the directory that VS Code opens as its workspace root.
    const exportDirectory = path.resolve(workspacePath, `${Date.now()}-${randomUUID()}`);
    const filePath = path.resolve(exportDirectory, fileName);
    if (!isWithin(workspacePath, exportDirectory) || !isWithin(exportDirectory, filePath)) {
      return failure(editor, null, workspacePath, "The export path escaped the app export folder.");
    }
    try {
      await fsp.mkdir(exportDirectory, { recursive: true });
      const editorExecutable = await this.resolveLaunchExecutable(editor.executable);
      if (!editorExecutable) return failure(editor, null, workspacePath, "The selected editor launcher has no safe native executable.");
      await fsp.writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await this.launch(editorExecutable, ["--reuse-window", workspacePath, filePath]);
      return {
        schemaVersion: EXTERNAL_EDITOR_SCHEMA_VERSION,
        opened: true,
        editor,
        filePath,
        workspacePath,
        error: null,
      };
    } catch (error) {
      return failure(editor, filePath, workspacePath, error instanceof Error ? error.message : "The external editor could not be opened.");
    }
  }

  async openWorkspace(workspacePath: string, configuredExecutable: string | null = null): Promise<ExternalEditorOpenResult> {
    if (!isSafeAbsolutePath(workspacePath) || !(await this.directoryExists(workspacePath))) {
      return failure(null, null, null, "The selected workspace folder is not available.");
    }
    const discovery = await this.discover(configuredExecutable);
    if (configuredExecutable && !discovery.editors.some((candidate) => candidate.executable === configuredExecutable)) {
      return failure(null, null, workspacePath, "The selected editor is unavailable. Choose automatic discovery or refresh the editor list in Settings.");
    }
    const editor = configuredExecutable
      ? discovery.editors.find((candidate) => candidate.executable === configuredExecutable) ?? null
      : discovery.editors[0] ?? null;
    if (!editor) return failure(null, null, workspacePath, "Visual Studio Code was not found. Install it or choose an editor executable in Settings.");
    try {
      const editorExecutable = await this.resolveLaunchExecutable(editor.executable);
      if (!editorExecutable) return failure(editor, null, workspacePath, "The selected editor launcher has no safe native executable.");
      await this.launch(editorExecutable, ["--reuse-window", workspacePath]);
      return {
        schemaVersion: EXTERNAL_EDITOR_SCHEMA_VERSION,
        opened: true,
        editor,
        filePath: null,
        workspacePath,
        error: null,
      };
    } catch (error) {
      return failure(editor, null, workspacePath, error instanceof Error ? error.message : "The external editor could not be opened.");
    }
  }

  private async resolveLaunchExecutable(executable: string): Promise<string | null> {
    if (executable === "code" || executable === "code-insiders") {
      return this.which(executable);
    }
    if (!/\.cmd$/iu.test(executable)) return executable;
    const root = path.resolve(path.dirname(executable), "..");
    const candidates = path.basename(executable).toLowerCase() === "code-insiders.cmd"
      ? [path.join(root, "Code - Insiders.exe")]
      : [path.join(root, "Code.exe")];
    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) return candidate;
    }
    return null;
  }
}
