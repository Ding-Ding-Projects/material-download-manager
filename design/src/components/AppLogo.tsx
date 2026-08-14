import { useEffect, useMemo, useState } from "react";
import { DEFAULT_APP_LOGO_SETTINGS, type AppLogoPreset, type AppLogoSnapshot } from "@shared/appLogo";
import type { ScheduledSettingsRecord } from "@shared/scheduledSettings";
import { resolveScheduledSettings } from "@shared/scheduledSettings";
import { useAppStore } from "../store/useAppStore";

export interface AppLogoProps {
  size?: number;
  className?: string;
  /** Title bars supply adjacent product text, so their mark is decorative. */
  decorative?: boolean;
  label?: string;
}

export function AppLogoPresetMark({ preset, size, className, decorative = true, label = "App logo" }: {
  preset: AppLogoPreset;
  size: number;
  className?: string;
  decorative?: boolean;
  label?: string;
}) {
  const accessibility = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  if (preset === "orbit") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...accessibility}>
        <circle cx="12" cy="12" r="10.5" fill="#14532d" />
        <circle cx="12" cy="12" r="6" fill="none" stroke="#bbf7d0" strokeWidth="1.4" />
        <circle cx="17.2" cy="8.3" r="2.1" fill="#facc15" />
        <path d="M7.2 15.8 10.6 12.4l2.1 2.1 4.2-4.2" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (preset === "stack") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...accessibility}>
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#7c3aed" />
        <path d="m5.4 9.1 6.6-3.2 6.6 3.2L12 12.3 5.4 9.1Zm0 4L12 16.3l6.6-3.2M5.4 17 12 20.2l6.6-3.2" fill="none" stroke="white" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...accessibility}>
      <circle cx="12" cy="12" r="11" fill="#4f8cff" />
      <path d="M12 6.5v8.2M8.2 11.6l3.8 3.8 3.8-3.8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Reads only the main-process-generated 128px PNG. The original local file,
 * its path, and its cache token never enter the renderer.
 */
export default function AppLogo({ size = 22, className, decorative = true, label = "App logo" }: AppLogoProps) {
  const settings = useAppStore((state) => state.settings);
  const [snapshot, setSnapshot] = useState<AppLogoSnapshot | null>(null);
  const [customFailed, setCustomFailed] = useState(false);
  const [scheduledLogo, setScheduledLogo] = useState<AppLogoSnapshot["settings"] | null>(null);
  const schoolModeEnabled = settings?.schoolModeEnabled === true;
  const logoKey = useMemo(() => {
    const logo = settings?.appLogo;
    return logo ? `${schoolModeEnabled ? "school" : "regular"}:${JSON.stringify(logo)}` : "";
  }, [schoolModeEnabled, settings?.appLogo]);
  const effectiveLogo = schoolModeEnabled ? DEFAULT_APP_LOGO_SETTINGS : (scheduledLogo ?? settings?.appLogo);
  const preset = effectiveLogo?.preset ?? "material";

  useEffect(() => {
    if (!settings || schoolModeEnabled) {
      setScheduledLogo(null);
      return;
    }
    let active = true;
    const apply = (rules: ScheduledSettingsRecord[]) => {
      const resolved = resolveScheduledSettings({ appLogo: settings.appLogo }, rules);
      const candidate = resolved.appLogo?.source === "preset" ? resolved.appLogo : settings.appLogo;
      if (active) setScheduledLogo(candidate);
    };
    const refresh = () => {
      void window.api.getScheduleRules().then(apply).catch(() => {
        if (active) setScheduledLogo(settings.appLogo);
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    const unsubscribe = window.api.onScheduleChanged(apply);
    return () => {
      active = false;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [schoolModeEnabled, settings?.appLogo]);

  useEffect(() => {
    if (schoolModeEnabled) {
      setSnapshot(null);
      return undefined;
    }
    let active = true;
    setCustomFailed(false);
    void window.api.getAppLogo().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => {
      if (active) setSnapshot(null);
    });
    return () => { active = false; };
  }, [logoKey, schoolModeEnabled]);

  if (!customFailed && effectiveLogo?.source === "custom" && snapshot?.activeSource === "custom" && snapshot.previewDataUrl) {
    return (
      <img
        className={`app-logo${className ? ` ${className}` : ""}`}
        src={snapshot.previewDataUrl}
        width={size}
        height={size}
        alt={decorative ? "" : label}
        aria-hidden={decorative || undefined}
        onError={() => setCustomFailed(true)}
      />
    );
  }
  return <AppLogoPresetMark preset={preset} size={size} className={`app-logo${className ? ` ${className}` : ""}`} decorative={decorative} label={label} />;
}
