import type { AppSettings, FunnyLevel, NarratorLanguage } from "./types";

export type NarrationCategory = "download-completion" | "download-error" | "download-status" | "manual";
export type NarrationPriority = "event" | "user";

export interface NarratorSettings {
  enabled: boolean;
  language: NarratorLanguage;
  quietMode: boolean;
  funnyLevelEnglish: FunnyLevel;
  funnyLevelCantonese: FunnyLevel;
  assistiveTechnologyActive: boolean;
}

export function effectiveNarratorSettings(settings: Pick<
  AppSettings,
  "narratorEnabled" | "narratorLanguage" | "narratorQuietMode" | "narratorAssistiveTechnologyActive" | "funnyLevelEnglish" | "funnyLevelCantonese" | "schoolModeEnabled"
> | null | undefined): NarratorSettings {
  const schoolMode = settings?.schoolModeEnabled === true;
  return {
    enabled: schoolMode ? false : (settings?.narratorEnabled ?? false),
    language: schoolMode ? "english" : (settings?.narratorLanguage ?? "english"),
    quietMode: settings?.narratorQuietMode ?? false,
    funnyLevelEnglish: schoolMode ? 1 : (settings?.funnyLevelEnglish ?? 1),
    funnyLevelCantonese: schoolMode ? 1 : (settings?.funnyLevelCantonese ?? 3),
    assistiveTechnologyActive: settings?.narratorAssistiveTechnologyActive ?? false,
  };
}

export interface NarrationRequest {
  english: string;
  cantonese: string;
  category: NarrationCategory;
  priority?: NarrationPriority;
  /** Optional settings snapshot used by the user-initiated test action. */
  settings?: NarratorSettings;
  /** Test-only callback; never persisted or rendered. */
  onError?: (error: unknown) => void;
}

export interface SpeechSegment {
  text: string;
  language: "en-US" | "yue-HK";
}

export interface NarratorSpeechAdapter {
  speak(segment: SpeechSegment, done: (error?: unknown) => void): void;
  cancel(): void;
}

export interface NarratorEnvironment {
  /** A screen reader's live region is preferred over duplicate spoken output. */
  screenReaderActive: boolean;
  /** Event narration stays silent when reduced motion is requested; user tests remain explicit. */
  reducedMotion: boolean;
}

export interface NarratorQueueOptions {
  debounceMs?: number;
  cooldownMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface NarratorEnqueueResult {
  accepted: boolean;
  reason: "queued" | "disabled" | "quiet" | "screen-reader" | "reduced-motion" | "invalid";
}

const MAX_TEXT_LENGTH = 1_024;
const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_COOLDOWN_MS = 4_000;

function clampText(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT_LENGTH) : "";
}

function englishStyle(text: string, level: FunnyLevel): string {
  const variants = [
    text,
    `Notice: ${text}`,
    `Notice: ${text} The narrator is keeping up.`,
    `Update: ${text} The tiny narration clerk has filed it.`,
    `Update: ${text} The narration orchestra has found its cue.`,
  ] as const;
  return variants[level - 1] ?? variants[0];
}

function cantoneseStyle(text: string, level: FunnyLevel): string {
  const variants = [
    text,
    `通知：${text}`,
    `通知：${text}，朗讀器跟得上。`,
    `更新：${text}，細細隻朗讀文員已經入檔。`,
    `更新：${text}，朗讀樂隊搵到拍子喇。`,
  ] as const;
  return variants[level - 1] ?? variants[0];
}

export function buildNarrationSegments(request: NarrationRequest, settings: NarratorSettings): SpeechSegment[] {
  const english = englishStyle(clampText(request.english), settings.funnyLevelEnglish);
  const cantonese = cantoneseStyle(clampText(request.cantonese), settings.funnyLevelCantonese);
  if (!english || !cantonese) return [];
  if (settings.language === "cantonese") return [{ text: cantonese, language: "yue-HK" }];
  if (settings.language === "both") {
    return [
      { text: english, language: "en-US" },
      { text: cantonese, language: "yue-HK" },
    ];
  }
  return [{ text: english, language: "en-US" }];
}

function validRequest(request: NarrationRequest): boolean {
  return Boolean(
    request &&
    (request.category === "download-completion" || request.category === "download-error" || request.category === "download-status" || request.category === "manual") &&
    clampText(request.english) &&
    clampText(request.cantonese)
  );
}

/**
 * Small, deterministic speech queue shared by the renderer and focused Node
 * tests. It keeps only the newest pending event per category, serializes Both
 * language segments, and never lets a late completion overlap the next line.
 */
export class NarratorQueue {
  private readonly pending = new Map<NarrationCategory, NarrationRequest>();
  private readonly lastSpoken = new Map<NarrationCategory, number>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly debounceMs: number;
  private readonly cooldownMs: number;
  private settings: NarratorSettings = {
    enabled: false,
    language: "english",
    quietMode: false,
    funnyLevelEnglish: 1,
    funnyLevelCantonese: 3,
    assistiveTechnologyActive: false,
  };
  private environment: NarratorEnvironment = { screenReaderActive: false, reducedMotion: false };
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly adapter: NarratorSpeechAdapter, options: NarratorQueueOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
  }

  setSettings(settings: NarratorSettings): void {
    this.settings = { ...settings };
    if (!settings.enabled || settings.quietMode || settings.assistiveTechnologyActive) this.cancel();
  }

  setEnvironment(environment: NarratorEnvironment): void {
    const shouldSuppress = environment.screenReaderActive || environment.reducedMotion;
    this.environment = { ...environment };
    if (shouldSuppress) this.cancel();
  }

  enqueue(request: NarrationRequest): NarratorEnqueueResult {
    if (!validRequest(request)) return { accepted: false, reason: "invalid" };
    const priority = request.priority ?? "event";
    if (!this.settings.enabled) return { accepted: false, reason: "disabled" };
    if (this.settings.quietMode && priority !== "user") return { accepted: false, reason: "quiet" };
    if ((this.settings.assistiveTechnologyActive || this.environment.screenReaderActive) && priority !== "user") return { accepted: false, reason: "screen-reader" };
    if (this.environment.reducedMotion && priority !== "user") return { accepted: false, reason: "reduced-motion" };

    this.pending.set(request.category, { ...request, priority });
    this.schedule(priority === "user" ? 0 : this.debounceMs);
    return { accepted: true, reason: "queued" };
  }

  cancel(): void {
    this.generation += 1;
    this.pending.clear();
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.adapter.cancel();
    this.active = false;
  }

  getState(): { active: boolean; pendingCategories: NarrationCategory[] } {
    return { active: this.active, pendingCategories: [...this.pending.keys()] };
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) {
      if (delayMs !== 0) return;
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.pump();
    }, delayMs);
  }

  private pump(): void {
    if (this.active || this.pending.size === 0) return;
    const now = this.now();
    let nextDelay: number | null = null;
    let selected: NarrationRequest | null = null;
    for (const [category, candidate] of this.pending) {
      const last = this.lastSpoken.get(category) ?? Number.NEGATIVE_INFINITY;
      const remaining = Math.max(0, this.cooldownMs - (now - last));
      if (remaining > 0 && candidate.priority !== "user") {
        nextDelay = nextDelay === null ? remaining : Math.min(nextDelay, remaining);
        continue;
      }
      selected = candidate;
      this.pending.delete(category);
      break;
    }
    if (!selected) {
      if (nextDelay !== null) this.schedule(nextDelay);
      return;
    }
    this.active = true;
    const generation = this.generation;
    const segments = buildNarrationSegments(selected, selected.settings ?? this.settings);
    if (segments.length === 0) {
      this.active = false;
      this.pump();
      return;
    }
    let index = 0;
    const speakNext = (error?: unknown) => {
      if (generation !== this.generation) return;
      if (error || index >= segments.length) {
        if (error) selected!.onError?.(error);
        this.active = false;
        this.lastSpoken.set(selected!.category, this.now());
        this.pump();
        return;
      }
      try {
        this.adapter.speak(segments[index++], speakNext);
      } catch (error) {
        speakNext(error);
      }
    };
    speakNext();
  }
}
