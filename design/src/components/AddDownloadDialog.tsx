import { useEffect, useRef, useState } from "react";
import type { NewDownloadInfo } from "@shared/types";
import type { DistributedDownloadSelection } from "@shared/distributedProtocol";
import { detectCategory } from "@shared/categories";
import { isValidDefaultSaveFolder } from "@shared/settings";
import { useAppStore } from "../store/useAppStore";
import { formatBytes } from "../utils/format";
import Dialog from "./Dialog";
import {
  CategoryIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  FolderIcon,
  LinkAddIcon,
  RefreshIcon,
  SettingsIcon,
  SpinnerIcon,
} from "./icons";

export default function AddDownloadDialog() {
  const settings = useAppStore((s) => s.settings);
  const prefillUrl = useAppStore((s) => s.addDownloadPrefillUrl);
  const closeAddDownload = useAppStore((s) => s.closeAddDownload);
  const probeUrl = useAppStore((s) => s.probeUrl);
  const previewCategory = useAppStore((s) => s.previewCategory);
  const addDownload = useAppStore((s) => s.addDownload);
  const pickFolder = useAppStore((s) => s.pickFolder);

  // A fresh renderer deliberately has no browser-handoff prefill.  Normalize at
  // the UI boundary so every visible entry point (toolbar, tab strip, palette)
  // can open the same real form without asking string methods to operate on null.
  const [url, setUrl] = useState(() => typeof prefillUrl === "string" ? prefillUrl : "");
  const [folder, setFolder] = useState(settings?.defaultSaveFolder ?? "");
  const [fileName, setFileName] = useState("");
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<NewDownloadInfo | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [headersText, setHeadersText] = useState("");
  const [transferMode, setTransferMode] = useState<"local" | "ssh">("local");
  const [workerCount, setWorkerCount] = useState(settings?.sshDefaultWorkerCount ?? 2);
  const [expectedSha256, setExpectedSha256] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [category, setCategory] = useState(() => detectCategory("file"));

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryPreviewGenerationRef = useRef(0);

  async function doProbe(target: string) {
    if (!/^https?:\/\//i.test(target)) {
      setProbeResult(null);
      setProbeError(null);
      return;
    }
    setProbing(true);
    setProbeError(null);
    try {
      const info = await probeUrl(target);
      setProbeResult(info);
      if (!fileNameTouched) setFileName(info.suggestedFileName);
    } catch {
      setProbeResult(null);
      setProbeError("Couldn't resolve this URL.");
    } finally {
      setProbing(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doProbe(url), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const effectiveFileName = fileName || probeResult?.suggestedFileName || "";
  const effectiveFolder = folder || settings?.defaultSaveFolder || "";
  const folderError = isValidDefaultSaveFolder(effectiveFolder)
    ? null
    : "Choose an absolute Windows save folder.";

  useEffect(() => {
    const previewFileName = effectiveFileName || "file";
    const generation = ++categoryPreviewGenerationRef.current;
    setCategory(detectCategory(previewFileName));
    const timer = setTimeout(() => {
      void previewCategory(previewFileName, url)
        .then((nextCategory) => {
          if (categoryPreviewGenerationRef.current === generation) setCategory(nextCategory);
        })
        .catch(() => {
          // The built-in extension result remains an honest, responsive fallback.
        });
    }, 75);
    return () => clearTimeout(timer);
  }, [effectiveFileName, previewCategory, url]);

  function parseHeaders(): Record<string, string> | undefined {
    const lines = headersText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return undefined;
    const record: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) record[key] = value;
    }
    return Object.keys(record).length > 0 ? record : undefined;
  }

  async function handleSubmit(startImmediately: boolean) {
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    try {
      const ssh: DistributedDownloadSelection | undefined = transferMode === "ssh"
        ? {
            mode: "ssh",
            workerCount: Math.max(1, Math.min(16, Number(workerCount) || 1)),
            ...(expectedSha256.trim() ? { expectedSha256: expectedSha256.trim().toLowerCase() } : {}),
          }
        : undefined;
      await addDownload({
        url: url.trim(),
        folder: effectiveFolder,
        fileName: effectiveFileName || "download",
        queueId: null,
        startImmediately,
        headers: parseHeaders(),
        ssh,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePickFolder() {
    const picked = await pickFolder();
    if (picked) setFolder(picked);
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // clipboard access denied; ignore
    }
  }

  return (
    <Dialog
      title="Add download"
      icon={<LinkAddIcon size={16} />}
      onClose={closeAddDownload}
      width={520}
      overlayClassName="add-download-dialog-overlay"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => void handleSubmit(false)} disabled={!url.trim() || submitting || Boolean(folderError)}>
            Add
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSubmit(true)} disabled={!url.trim() || submitting || Boolean(folderError)}>
            Download
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={closeAddDownload}>
            Cancel
          </button>
        </>
      }
    >
      <div className="add-dl-url-row">
        <input
          className="input"
          type="text"
          placeholder="https://example.com/file.zip"
          aria-label="Download URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <button type="button" className="icon-btn" title="Paste from clipboard" onClick={() => void handlePaste()}>
          <ClipboardIcon size={15} />
        </button>
      </div>

      <div className="add-dl-main-row">
        <div className="add-dl-fields">
          <div className="field-row">
            <input
              className="input"
              type="text"
              placeholder="Save folder"
              value={folder}
              aria-label="Save folder"
              aria-invalid={folderError ? true : undefined}
              aria-describedby={folderError ? "add-download-folder-error" : undefined}
              onChange={(e) => setFolder(e.target.value)}
            />
            <button type="button" className="icon-btn" title="Choose folder" onClick={() => void handlePickFolder()}>
              <FolderIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Recent folders"
              onClick={() => setShowFolderMenu((v) => !v)}
            >
              <ChevronDownIcon size={15} />
            </button>
            {showFolderMenu && (
              <div className="mini-dropdown">
                <button
                  type="button"
                  onClick={() => {
                    setFolder(settings?.defaultSaveFolder ?? "");
                    setShowFolderMenu(false);
                  }}
                >
                  Default folder
                </button>
              </div>
            )}
          </div>
          {folderError && <p className="field-error" id="add-download-folder-error" role="alert">{folderError}</p>}
          <div className="field-row">
            <input
              className="input"
              type="text"
              placeholder="File name"
              aria-label="File name"
              value={effectiveFileName}
              onChange={(e) => {
                setFileName(e.target.value);
                setFileNameTouched(true);
              }}
            />
          </div>
        </div>

        <div className="add-dl-side">
          <div className="add-dl-preview" data-category={category} aria-label={`Predicted category: ${category}`}>
            <CategoryIcon category={category} size={22} />
            <span className="add-dl-size">
              {probing ? "Probing…" : probeResult ? formatBytes(probeResult.contentLength) : probeError ? "Unknown" : "—"}
            </span>
            <span className="add-dl-status-icon">
              {probing ? (
                <SpinnerIcon size={14} />
              ) : probeResult ? (
                <CheckIcon size={14} className="text-success" />
              ) : null}
            </span>
          </div>
          <div className="add-dl-side-actions">
            <button type="button" className="icon-btn" title="Re-check URL" onClick={() => void doProbe(url)}>
              <RefreshIcon size={15} />
            </button>
            <button
              type="button"
              className={`icon-btn${showHeaders ? " active" : ""}`}
              title="Advanced settings"
              onClick={() => setShowHeaders((v) => !v)}
            >
              <SettingsIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="add-dl-transfer" aria-label="Transfer route">
        <div className="field-row">
          <label className="field">
            <span className="field-label">Transfer route</span>
            <select className="input select" value={transferMode} onChange={(event) => setTransferMode(event.target.value as "local" | "ssh")}>
              <option value="local">This computer</option>
              <option value="ssh" disabled={!settings?.sshHosts.some((host) => host.enabled && host.provisionedAt && host.workerHostKeySha256)}>Docker SSH workers</option>
            </select>
          </label>
          {transferMode === "ssh" && (
            <label className="field">
              <span className="field-label">Worker hosts</span>
              <input className="input" type="number" min={1} max={16} value={workerCount} onChange={(event) => setWorkerCount(Number(event.target.value) || 1)} />
            </label>
          )}
        </div>
        {transferMode === "ssh" && (
          <label className="field">
            <span className="field-label">Trusted whole-file SHA-256 (optional; blank stays local)</span>
            <input className="input" value={expectedSha256} onChange={(event) => setExpectedSha256(event.target.value)} placeholder="64 lowercase hexadecimal characters" maxLength={64} />
            <span className="setting-helper">Distributed bytes require this trusted digest. Without it, the app keeps the download on this computer.</span>
          </label>
        )}
      </div>

      {showHeaders && (
        <div className="add-dl-headers">
          <label className="field-label">Custom headers (one per line, "Name: value")</label>
          <textarea
            className="input textarea"
            rows={3}
            placeholder={"Authorization: Bearer token\nCookie: sessionid=..."}
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
          />
        </div>
      )}
    </Dialog>
  );
}
