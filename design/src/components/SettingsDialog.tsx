import { useState } from "react";
import type { AppSettings } from "@shared/types";
import { useAppStore } from "../store/useAppStore";
import Dialog from "./Dialog";
import { FolderIcon, SettingsIcon } from "./icons";

const FALLBACK_SETTINGS: AppSettings = {
  defaultSaveFolder: "",
  maxConnectionsPerDownload: 8,
  maxActiveDownloads: 3,
  globalSpeedLimitBytes: 0,
  showCompleteDialog: true,
  startOnSystemStartup: false,
  theme: "dark",
  minConnectionPartSize: 1024 * 1024,
};

export default function SettingsDialog() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const setSettings = useAppStore((s) => s.setSettings);
  const pickFolder = useAppStore((s) => s.pickFolder);

  const [form, setForm] = useState<AppSettings>(
    () => useAppStore.getState().settings ?? FALLBACK_SETTINGS
  );
  const [unlimitedSpeed, setUnlimitedSpeed] = useState(form.globalSpeedLimitBytes === 0);
  const [speedMBs, setSpeedMBs] = useState(
    form.globalSpeedLimitBytes > 0 ? form.globalSpeedLimitBytes / (1024 * 1024) : 5
  );
  const [saving, setSaving] = useState(false);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handlePickFolder() {
    const picked = await pickFolder();
    if (picked) update("defaultSaveFolder", picked);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await setSettings({
        ...form,
        globalSpeedLimitBytes: unlimitedSpeed ? 0 : Math.round(speedMBs * 1024 * 1024),
      });
      closeSettings();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Settings"
      icon={<SettingsIcon size={16} />}
      onClose={closeSettings}
      width={480}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            Save
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={closeSettings}>
            Cancel
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Default save folder</span>
        <div className="field-row">
          <input
            className="input"
            type="text"
            value={form.defaultSaveFolder}
            onChange={(e) => update("defaultSaveFolder", e.target.value)}
          />
          <button type="button" className="icon-btn" title="Choose folder" onClick={() => void handlePickFolder()}>
            <FolderIcon size={15} />
          </button>
        </div>
      </label>

      <div className="field-pair">
        <label className="field">
          <span className="field-label">Max connections per download</span>
          <input
            className="input"
            type="number"
            min={1}
            max={32}
            value={form.maxConnectionsPerDownload}
            onChange={(e) => update("maxConnectionsPerDownload", Number(e.target.value) || 1)}
          />
        </label>
        <label className="field">
          <span className="field-label">Max active downloads</span>
          <input
            className="input"
            type="number"
            min={1}
            max={32}
            value={form.maxActiveDownloads}
            onChange={(e) => update("maxActiveDownloads", Number(e.target.value) || 1)}
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Global speed limit</span>
        <div className="field-row">
          <input
            className="input"
            type="number"
            min={0.1}
            step={0.1}
            disabled={unlimitedSpeed}
            value={speedMBs}
            onChange={(e) => setSpeedMBs(Number(e.target.value) || 0)}
          />
          <span className="field-suffix">MB/s</span>
          <label className="checkbox-row">
            <button
              type="button"
              className={`checkbox${unlimitedSpeed ? " checked" : ""}`}
              onClick={() => setUnlimitedSpeed((v) => !v)}
              aria-label="Unlimited speed"
            />
            <span>Unlimited</span>
          </label>
        </div>
      </label>

      <label className="field">
        <span className="field-label">Theme</span>
        <select
          className="input select"
          value={form.theme}
          onChange={(e) => update("theme", e.target.value as AppSettings["theme"])}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </label>

      <label className="checkbox-row field">
        <button
          type="button"
          className={`checkbox${form.startOnSystemStartup ? " checked" : ""}`}
          onClick={() => update("startOnSystemStartup", !form.startOnSystemStartup)}
          aria-label="Start on system startup"
        />
        <span>Start on system startup</span>
      </label>

      <label className="checkbox-row field">
        <button
          type="button"
          className={`checkbox${form.showCompleteDialog ? " checked" : ""}`}
          onClick={() => update("showCompleteDialog", !form.showCompleteDialog)}
          aria-label="Show complete dialog"
        />
        <span>Show a dialog when a download completes</span>
      </label>

      <details className="advanced-details">
        <summary>Advanced</summary>
        <label className="field">
          <span className="field-label">Minimum splittable part size (KB)</span>
          <input
            className="input"
            type="number"
            min={1}
            value={Math.round(form.minConnectionPartSize / 1024)}
            onChange={(e) => update("minConnectionPartSize", Math.max(1, Number(e.target.value) || 1) * 1024)}
          />
        </label>
      </details>
    </Dialog>
  );
}
