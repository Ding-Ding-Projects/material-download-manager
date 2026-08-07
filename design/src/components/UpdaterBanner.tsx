import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/types";
import { notify } from "./NotificationCenter";
import "../styles/updater.css";

interface UpdaterBannerProps {
  hasUnsavedWork: boolean;
  unsavedWorkReason: string;
}

function updateLabel(state: UpdateState): string {
  return state.version ? `version ${state.version}` : "the latest version";
}

export default function UpdaterBanner({ hasUnsavedWork, unsavedWorkReason }: UpdaterBannerProps) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [deferredVersion, setDeferredVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const applyState = (next: UpdateState) => {
      if (!active) return;
      setState(next);
      if (next.status !== "ready" || next.version !== deferredVersion) setDeferredVersion(null);
    };
    const unsubscribe = window.api.onUpdateStateChanged(applyState);
    void window.api
      .getUpdateState()
      .then(applyState)
      .catch((error: unknown) => {
        if (!active) return;
        notify({
          title: "Update status unavailable",
          message: error instanceof Error ? error.message : "The updater did not return a valid state.",
          tone: "error",
        });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [deferredVersion]);

  async function checkForUpdates() {
    setBusy(true);
    try {
      const next = await window.api.checkForUpdates();
      setState(next);
      if (next.status === "failed" || next.status === "offline") {
        notify({ title: "Update check failed", message: next.message, tone: "error" });
      }
    } catch (error) {
      notify({
        title: "Update check failed",
        message: error instanceof Error ? error.message : "The update check could not be completed.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function installUpdate() {
    if (state?.status !== "ready") return;
    setBusy(true);
    try {
      // The main process starts with no safety assertion. This fresh assertion
      // is the hook that future editors can replace with their real dirty-state
      // registry; without it, installation remains blocked fail-closed.
      await window.api.setUnsavedWorkState({
        hasUnsavedWork,
        reason: unsavedWorkReason,
      });
      const result = await window.api.installUpdate();
      if (!result.started) {
        notify({
          title: "Update postponed",
          message: result.reason ?? "The update was not installed.",
          tone: "warning",
        });
      }
    } catch (error) {
      notify({
        title: "Update install failed",
        message: error instanceof Error ? error.message : "The update could not be installed.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function openReleaseNotes(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    try {
      const opened = await window.api.openUpdateReleaseNotes();
      if (!opened) {
        notify({ title: "Release notes unavailable", message: "The unsigned update did not provide a safe release-notes link.", tone: "error" });
      }
    } catch (error) {
      notify({
        title: "Release notes unavailable",
        message: error instanceof Error ? error.message : "The release notes could not be opened.",
        tone: "error",
      });
    }
  }

  if (!state) return null;

  if (state.status === "ready") {
    const deferred = deferredVersion === state.version;
    return (
      <section className={`updater-banner updater-banner-ready${deferred ? " updater-banner-deferred" : ""}`} aria-live="polite" aria-label="Software update ready">
        <div className="updater-copy">
          <strong>Update {state.version} is ready</strong>
          <span>{deferred ? "Installation is deferred; your current session is unchanged." : "Restart is required to install it."}</span>
        </div>
        {!deferred && (
          <a
            className="updater-release-notes"
            href={state.releaseNotesUrl}
            onClick={(event) => void openReleaseNotes(event)}
            aria-label={`Open release notes for version ${state.version}`}
          >
            Release notes
          </a>
        )}
        <div className="updater-actions">
          {deferred ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeferredVersion(null)}>
              Show update actions
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void installUpdate()} disabled={busy}>
              Restart to install update
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeferredVersion(state.version)} disabled={busy}>
            Later
          </button>
        </div>
      </section>
    );
  }

  if (state.status === "available" || state.status === "downloading") {
    const percent = state.status === "downloading" ? state.percent : 0;
    return (
      <section className="updater-banner updater-banner-progress" aria-live="polite" aria-label="Software update in progress">
        <div className="updater-copy">
          <strong>Update {updateLabel(state)} is downloading</strong>
          <span>The download runs in the background; installation waits for your explicit restart.</span>
        </div>
        <div className="updater-progress-wrap">
          <div className="updater-progress" role="progressbar" aria-label="Update download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="updater-progress-value">{Math.round(percent)}%</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void checkForUpdates()} disabled>
          Checking…
        </button>
      </section>
    );
  }

  if (state.status === "failed" || state.status === "offline") {
    return (
      <section className="updater-banner updater-banner-failed" aria-live="polite" aria-label="Software update status">
        <div className="updater-copy">
          <strong>Updates unavailable</strong>
          <span>{state.message}</span>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void checkForUpdates()} disabled={busy}>
          {busy ? "Checking…" : "Check for updates"}
        </button>
      </section>
    );
  }

  return (
    <section className="updater-banner updater-banner-current" aria-live="polite" aria-label="Software update status">
      <div className="updater-copy">
        <strong>Updates</strong>
        <span>Current version {state.version}. Check the unsigned HTTPS feed for a newer release.</span>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void checkForUpdates()} disabled={busy}>
        {busy ? "Checking…" : "Check for updates"}
      </button>
    </section>
  );
}
