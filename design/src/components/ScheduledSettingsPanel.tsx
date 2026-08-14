import { useEffect, useMemo, useState } from "react";
import type {
  PersistedScheduleSource,
  ScheduleWeekday,
  ScheduledSettingsRecord,
} from "@shared/scheduledSettings";
import {
  createDefaultScheduledSettingsRecord,
  SCHEDULE_WEEKDAYS,
} from "@shared/scheduledSettings";
import { useUiCopy } from "../i18n/useUiCopy";
import { useAppStore } from "../store/useAppStore";
import { notify } from "./NotificationCenter";

const WEEKDAY_LABELS: Record<ScheduleWeekday, readonly [string, string]> = {
  monday: ["Monday", "星期一"],
  tuesday: ["Tuesday", "星期二"],
  wednesday: ["Wednesday", "星期三"],
  thursday: ["Thursday", "星期四"],
  friday: ["Friday", "星期五"],
  saturday: ["Saturday", "星期六"],
  sunday: ["Sunday", "星期日"],
};

function cloneRule(rule: ScheduledSettingsRecord): ScheduledSettingsRecord {
  return {
    ...rule,
    weekdays: [...rule.weekdays],
    source: rule.source.kind === "local"
      ? { kind: "local", settings: { ...rule.source.settings } }
      : rule.source.kind === "home-assistant"
        ? { kind: "home-assistant", baseUrl: rule.source.baseUrl, entityId: rule.source.entityId, settings: { ...rule.source.settings } }
        : { kind: "api", url: rule.source.url, ...(rule.source.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}) },
  };
}

function cloneRules(rules: readonly ScheduledSettingsRecord[]): ScheduledSettingsRecord[] {
  return rules.map(cloneRule);
}

function timezoneChoices(): string[] {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return [...new Set([local, "UTC", "America/Toronto", "America/New_York", "America/Vancouver", "Europe/London", "Asia/Hong_Kong"])];
}

function randomRuleId(): string {
  const uuid = window.crypto?.randomUUID?.();
  return uuid ? `schedule-${uuid}` : `schedule-${Date.now().toString(36)}`;
}

function withSourceSettings(source: PersistedScheduleSource, key: "theme" | "density", value: string): PersistedScheduleSource {
  if (source.kind === "api") return source;
  return { ...source, settings: { ...source.settings, [key]: value } };
}

export default function ScheduledSettingsPanel() {
  const settings = useAppStore((state) => state.settings);
  const ui = useUiCopy(settings);
  const [rules, setRules] = useState<ScheduledSettingsRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(timezoneChoices, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void window.api.getScheduleRules().then((next) => {
      if (!active) return;
      setRules(cloneRules(next));
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : ui.text("Scheduled settings could not be loaded.", "未能載入排程設定。"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    const unsubscribe = window.api.onScheduleChanged((next) => {
      if (active) setRules(cloneRules(next));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [settings?.languageMode, settings?.schoolModeEnabled]);

  const editing = editingId ? rules.find((rule) => rule.id === editingId) ?? null : null;

  function updateEditing(patch: Partial<ScheduledSettingsRecord>) {
    if (!editingId) return;
    setRules((current) => current.map((rule) => rule.id === editingId ? { ...rule, ...patch } : rule));
  }

  function updateSource(patch: Partial<PersistedScheduleSource>) {
    if (!editing || !editingId) return;
    const source = { ...editing.source, ...patch } as PersistedScheduleSource;
    updateEditing({ source });
  }

  function updateSourceSetting(key: "theme" | "density", value: string) {
    if (!editing) return;
    updateEditing({ source: withSourceSettings(editing.source, key, value) });
  }

  function toggleWeekday(day: ScheduleWeekday) {
    if (!editing) return;
    const weekdays = editing.weekdays.includes(day)
      ? editing.weekdays.filter((candidate) => candidate !== day)
      : [...editing.weekdays, day];
    updateEditing({ weekdays });
  }

  function addRule() {
    const next = createDefaultScheduledSettingsRecord(zones[0] ?? "UTC");
    next.id = randomRuleId();
    next.label = ui.text("New schedule", "新排程");
    setRules((current) => [...current, next]);
    setEditingId(next.id);
    setError(null);
  }

  function removeRule(id: string) {
    setRules((current) => current.filter((rule) => rule.id !== id));
    if (editingId === id) setEditingId(null);
  }

  async function saveRules() {
    setSaving(true);
    setError(null);
    try {
      const saved = await window.api.setScheduleRules(cloneRules(rules));
      setRules(cloneRules(saved));
      notify({
        title: ui.text("Scheduled settings saved", "排程設定已儲存"),
        message: ui.text("The local schedule record and its history entry are up to date.", "本地排程規則同歷史紀錄都更新好喇。"),
        tone: "success",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ui.text("Scheduled settings were not saved.", "排程設定未有儲存。"));
    } finally {
      setSaving(false);
    }
  }

  const sourceKind = editing?.source.kind ?? "local";
  const sourceSettings = editing && editing.source.kind !== "api" ? editing.source.settings : {};

  return (
    <section className="settings-section scheduled-settings" id="settings-scheduled-settings" tabIndex={-1} aria-labelledby="settings-scheduled-settings-heading">
      <div className="settings-section-heading" id="settings-scheduled-settings-heading">
        {ui.text("Scheduled settings", "排程設定")}
      </div>
      <p className="setting-helper" id="settings-scheduled-settings-help">
        {ui.text(
          "Schedule language, theme, density, accent, fonts, and other supported values using local time. Every day means all seven weekdays; date and time boundaries are inclusive. Cross-midnight windows continue into the following local date. Daylight-saving changes use the selected timezone's platform rules.",
          "可以按本地時間排程語言、主題、密度、主色、字型同其他支援值；每日即係七日，日期同時間界線包括在內。跨午夜時段會延續到下一個本地日期，夏令時間跟住所揀時區嘅平台規則。"
        )}
      </p>
      <p className="setting-helper">
        {ui.text(
          "Matching rules resolve by highest priority, then stable record ID. Remote sources are validated in the main process; tokens never enter this editor, settings files, exports, or history.",
          "相符規則先按最高優先次序，再按穩定規則 ID 決定；遠端來源由主程序驗證，token 絕對唔會落入呢個編輯器、設定檔、匯出或者歷史。"
        )}
      </p>

      {loading ? <p className="setting-helper" role="status">{ui.text("Loading schedules…", "載入緊排程…")}</p> : null}
      {!loading && rules.length === 0 ? (
        <div className="auto-organize-empty" role="status">
          {ui.text("No schedules yet. Add one to temporarily change supported settings.", "而家未有排程；新增一條就可以暫時改變支援設定。")}
        </div>
      ) : null}

      <div className="scheduled-rule-list" role="list" aria-label={ui.text("Scheduled settings records", "排程設定規則") }>
        {rules.map((rule) => (
          <article className={`scheduled-rule-card${editingId === rule.id ? " active" : ""}`} role="listitem" key={rule.id}>
            <div className="scheduled-rule-card-heading">
              <strong>{rule.label}</strong>
              <span className="setting-helper">
                {ui.text(`Priority ${rule.priority} · ${rule.enabled ? "enabled" : "disabled"}`, `優先次序 ${rule.priority} · ${rule.enabled ? "開啟" : "關閉"}`)}
              </span>
            </div>
            <div className="setting-helper">
              {rule.startTime}–{rule.endTime} · {rule.timezone} · {rule.source.kind}
            </div>
            <div className="button-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(rule.id)}>{ui.text("Edit", "編輯")}</button>
              <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => removeRule(rule.id)}>{ui.text("Remove", "移除")}</button>
            </div>
          </article>
        ))}
      </div>

      <div className="button-row">
        <button type="button" className="btn btn-ghost" onClick={addRule}>{ui.text("Add schedule", "新增排程")}</button>
        <button type="button" className="btn btn-primary" disabled={saving || loading} onClick={() => void saveRules()}>{saving ? ui.text("Saving…", "儲存緊…") : ui.text("Save schedules", "儲存排程")}</button>
      </div>

      {editing && (
        <div className="scheduled-rule-editor" role="group" aria-labelledby="scheduled-rule-editor-heading" aria-describedby="settings-scheduled-settings-help">
          <div className="settings-section-heading" id="scheduled-rule-editor-heading">{ui.text("Edit schedule", "編輯排程")}</div>
          <div className="field-pair">
            <label className="field">
              <span className="field-label">{ui.text("Schedule label", "排程名稱")}</span>
              <input className="input" value={editing.label} maxLength={120} onChange={(event) => updateEditing({ label: event.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">{ui.text("Priority", "優先次序")}</span>
              <input className="input" type="number" min={-1000} max={1000} step={1} value={editing.priority} onChange={(event) => updateEditing({ priority: Number(event.target.value) || 0 })} />
            </label>
          </div>
          <label className="checkbox-row" htmlFor={`schedule-enabled-${editing.id}`}>
            <input id={`schedule-enabled-${editing.id}`} type="checkbox" checked={editing.enabled} onChange={(event) => updateEditing({ enabled: event.target.checked })} />
            <span>{ui.text("Enable this schedule", "啟用呢條排程")}</span>
          </label>
          <div className="field-pair">
            <label className="field"><span className="field-label">{ui.text("Start date (optional)", "開始日期（可選）")}</span><input className="input" type="date" value={editing.startDate ?? ""} onChange={(event) => updateEditing({ startDate: event.target.value || null })} /></label>
            <label className="field"><span className="field-label">{ui.text("End date (optional)", "結束日期（可選）")}</span><input className="input" type="date" value={editing.endDate ?? ""} onChange={(event) => updateEditing({ endDate: event.target.value || null })} /></label>
          </div>
          <div className="field-pair">
            <label className="field"><span className="field-label">{ui.text("Start time", "開始時間")}</span><input className="input" type="time" value={editing.startTime} onChange={(event) => updateEditing({ startTime: event.target.value })} /></label>
            <label className="field"><span className="field-label">{ui.text("End time", "結束時間")}</span><input className="input" type="time" value={editing.endTime} onChange={(event) => updateEditing({ endTime: event.target.value })} /></label>
          </div>
          <fieldset className="scheduled-weekdays">
            <legend className="field-label">{ui.text("Weekdays", "星期")}</legend>
            <label className="checkbox-row"><input type="checkbox" checked={editing.weekdays.length === SCHEDULE_WEEKDAYS.length} onChange={(event) => updateEditing({ weekdays: event.target.checked ? [...SCHEDULE_WEEKDAYS] : [] })} /><span>{ui.text("Every day", "每日")}</span></label>
            <div className="scheduled-weekday-grid">
              {SCHEDULE_WEEKDAYS.map((day) => (
                <label className="checkbox-row" key={day}>
                  <input type="checkbox" checked={editing.weekdays.includes(day)} onChange={() => toggleWeekday(day)} />
                  <span>{ui.text(...WEEKDAY_LABELS[day])}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="field-label">{ui.text("Timezone", "時區")}</span>
            <select className="input select" value={editing.timezone} onChange={(event) => updateEditing({ timezone: event.target.value })}>
              {!zones.includes(editing.timezone) && <option value={editing.timezone}>{editing.timezone}</option>}
              {zones.map((zone) => <option value={zone} key={zone}>{zone}</option>)}
            </select>
            <span className="setting-helper">{ui.text("Native date/time controls use this timezone, including daylight-saving transitions.", "原生日期／時間控制會用呢個時區，包括夏令時間轉換。")}</span>
          </label>
          <label className="field">
            <span className="field-label">{ui.text("Source", "來源")}</span>
            <select className="input select" value={sourceKind} onChange={(event) => {
              const next = event.target.value as PersistedScheduleSource["kind"];
              updateEditing(next === "local"
                ? { source: { kind: "local", settings: { theme: "dark" } } }
                : next === "api"
                  ? { source: { kind: "api", url: "https://example.com/schedule" } }
                  : { source: { kind: "home-assistant", baseUrl: "https://home-assistant.local", entityId: "input_boolean.schedule_enabled", settings: { theme: "dark" } } });
            }}>
              <option value="local">{ui.text("Local settings", "本地設定")}</option>
              <option value="api">{ui.text("Versioned HTTPS API", "版本化 HTTPS API")}</option>
              <option value="home-assistant">{ui.text("Home Assistant boolean", "Home Assistant 布爾狀態")}</option>
            </select>
          </label>
          {editing.source.kind === "api" && (
            <>
              <label className="field"><span className="field-label">{ui.text("HTTPS schedule URL", "HTTPS 排程網址")}</span><input className="input" type="url" value={editing.source.url} onChange={(event) => updateSource({ url: event.target.value })} /></label>
              <label className="checkbox-row"><input type="checkbox" checked={editing.source.allowLoopbackHttp === true} onChange={(event) => updateSource({ allowLoopbackHttp: event.target.checked || undefined })} /><span>{ui.text("Allow bounded loopback HTTP for local development", "允許本機開發用嘅受限 loopback HTTP")}</span></label>
            </>
          )}
          {editing.source.kind === "home-assistant" && (
            <>
              <label className="field"><span className="field-label">{ui.text("Home Assistant base URL", "Home Assistant 基礎網址")}</span><input className="input" type="url" value={editing.source.baseUrl} onChange={(event) => updateSource({ baseUrl: event.target.value })} /></label>
              <label className="field"><span className="field-label">{ui.text("Boolean entity", "布爾實體")}</span><input className="input" value={editing.source.entityId} onChange={(event) => updateSource({ entityId: event.target.value })} placeholder="input_boolean.schedule_enabled" /></label>
              <p className="setting-helper">{ui.text("The access token is resolved only by the main process from the operating-system vault; this form cannot enter or display it.", "存取 token 只會由主程序從作業系統憑證庫解析；呢個表格唔可以輸入或者顯示 token。")}</p>
            </>
          )}
          {editing.source.kind !== "api" && (
            <div className="field-pair">
              <label className="field"><span className="field-label">{ui.text("Scheduled theme", "排程主題")}</span><select className="input select" value={String(sourceSettings.theme ?? "dark")} onChange={(event) => updateSourceSetting("theme", event.target.value)}><option value="dark">{ui.text("Dark", "深色")}</option><option value="light">{ui.text("Light", "淺色")}</option><option value="system">{ui.text("System", "系統")}</option></select></label>
              <label className="field"><span className="field-label">{ui.text("Scheduled density", "排程密度")}</span><select className="input select" value={String(sourceSettings.density ?? "comfortable")} onChange={(event) => updateSourceSetting("density", event.target.value)}><option value="compact">{ui.text("Compact", "緊湊")}</option><option value="comfortable">{ui.text("Comfortable", "舒適")}</option><option value="spacious">{ui.text("Spacious", "寬鬆")}</option></select></label>
            </div>
          )}
        </div>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
