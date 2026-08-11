import { narrationParts } from "./localization.js";
import { presentationSettings, sanitizeSettings } from "./settings.js";

export const NARRATOR_DEBOUNCE_MS = 250;
export const NARRATOR_COOLDOWN_MS = 2_000;
export const NARRATOR_MAX_TEXT = 512;
export const NARRATOR_MAX_PENDING = 32;
export const NARRATOR_CATEGORY_COOLDOWNS = Object.freeze({
  progress: 30_000,
  info: 10_000,
  success: 5_000,
  warning: 5_000,
  error: 0,
  general: NARRATOR_COOLDOWN_MS,
});

const LANGUAGE_CONFIG = Object.freeze({
  en: { lang: "en-US", levelKey: "funnyLevelEn" },
  yue: { lang: "zh-HK", levelKey: "funnyLevelYue" },
});

function boundedText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NARRATOR_MAX_TEXT);
}

function funnyStyle(level) {
  const safeLevel = Number.isInteger(level) && level >= 1 && level <= 5 ? level : 1;
  const rate = [0.94, 0.98, 1, 1.04, 1.08][safeLevel - 1];
  const pitch = [1, 1, 1.02, 1.05, 1.08][safeLevel - 1];
  return { rate, pitch };
}

function reducedMotionPreference() {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

function screenReaderMarker() {
  try {
    return globalThis.document?.documentElement?.dataset?.screenReaderActive === "true";
  } catch {
    return false;
  }
}

function preferredVoice(speechSynthesis, language) {
  if (typeof speechSynthesis?.getVoices !== "function") return null;
  let voices = [];
  try {
    voices = speechSynthesis.getVoices() ?? [];
  } catch {
    return null;
  }
  const preferred = language === "yue"
    ? voices.find((voice) => /^(zh-HK|yue)([-_]|$)/iu.test(voice?.lang ?? ""))
    : voices.find((voice) => /^(en-HK|en)([-_]|$)/iu.test(voice?.lang ?? ""));
  return preferred ?? null;
}

function segment(text, language) {
  const value = boundedText(text);
  if (!value) return null;
  const config = LANGUAGE_CONFIG[language] ?? LANGUAGE_CONFIG.en;
  return { text: value, language, lang: config.lang };
}

function cooldownFor(category) {
  return NARRATOR_CATEGORY_COOLDOWNS[category] ?? NARRATOR_COOLDOWN_MS;
}

export function createNarrator(options = {}) {
  const speechSynthesis = options.speechSynthesis ?? globalThis.speechSynthesis;
  const Utterance = options.Utterance ?? globalThis.SpeechSynthesisUtterance;
  const tts = options.tts ?? null;
  const setTimer = options.setTimeout ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
  const now = options.now ?? (() => Date.now());
  const isReducedMotion = options.isReducedMotion ?? reducedMotionPreference;
  const isScreenReaderActive = options.isScreenReaderActive ?? screenReaderMarker;
  const isQuiet = options.isQuiet ?? ((settings) => settings.narratorQuietMode === true);
  const state = {
    active: null,
    pending: [],
    timer: null,
    lastSpokenAt: new Map(),
    generation: 0,
  };

  function suppressionReason(settings) {
    const safe = sanitizeSettings(settings);
    if (!safe.narratorEnabled) return "disabled";
    if (tts) {
      if (typeof tts.speak !== "function" || (typeof tts.isAvailable === "function" && !tts.isAvailable())) return "unsupported";
    } else if (typeof speechSynthesis?.speak !== "function" || typeof Utterance !== "function") return "unsupported";
    if (isQuiet(safe)) return "quiet";
    if (safe.narratorSoundMode === "muted") return "muted";
    if (safe.narratorRespectReducedMotion && (safe.narratorReducedMotionActive || isReducedMotion())) return "reduced-motion";
    if (isScreenReaderActive()) return "screen-reader";
    return null;
  }

  function clearScheduled() {
    if (state.timer !== null) {
      clearTimer(state.timer);
      state.timer = null;
    }
  }

  function schedulePending() {
    if (state.timer !== null || state.active || state.pending.length === 0) return;
    const request = state.pending.find((item) => item.category === "error") ?? state.pending[0];
    const lastSpoken = state.lastSpokenAt.get(request.category) ?? -Infinity;
    const cooldownWait = Math.max(0, lastSpoken + cooldownFor(request.category) - now());
    const delay = Math.max(NARRATOR_DEBOUNCE_MS, cooldownWait);
    state.timer = setTimer(() => {
      state.timer = null;
      flushPending();
    }, delay);
  }

  function completeActive() {
    state.active = null;
    schedulePending();
  }

  function finishSegment() {
    if (!state.active) return;
    state.active.index += 1;
    if (state.active.index >= state.active.segments.length) {
      completeActive();
      return;
    }
    speakCurrentSegment();
  }

  function speakCurrentSegment() {
    if (!state.active) return;
    const current = state.active.segments[state.active.index];
    const generation = state.active.generation;
    const config = LANGUAGE_CONFIG[current.language] ?? LANGUAGE_CONFIG.en;
    const style = funnyStyle(state.active.settings[config.levelKey]);
    const reducedSound = state.active.settings.narratorSoundMode === "reduced";
    const volume = reducedSound ? 0.55 : 1;
    if (reducedSound) style.rate *= 0.92;
    if (tts) {
      try {
        tts.speak(current.text, {
          lang: current.lang,
          language: current.language,
          rate: style.rate,
          pitch: style.pitch,
          volume,
          enqueue: false,
        }, () => {
          if (state.active?.generation === generation) finishSegment();
        });
      } catch {
        if (state.active?.generation === generation) finishSegment();
      }
      return;
    }
    let utterance;
    try {
      utterance = new Utterance(current.text);
    } catch {
      finishSegment();
      return;
    }
    utterance.lang = current.lang;
    utterance.rate = style.rate;
    utterance.pitch = style.pitch;
    utterance.volume = 1;
    const voice = preferredVoice(speechSynthesis, current.language);
    if (voice) utterance.voice = voice;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (state.active?.generation === generation) finishSegment();
    };
    utterance.onend = settle;
    utterance.onerror = settle;
    try {
      speechSynthesis.speak(utterance);
    } catch {
      settle();
    }
  }

  function flushPending() {
    if (state.active || state.pending.length === 0) return;
    const request = state.pending.find((item) => item.category === "error") ?? state.pending[0];
    const requestIndex = state.pending.indexOf(request);
    const reason = suppressionReason(request.settings);
    if (reason) {
      state.pending.splice(requestIndex, 1);
      schedulePending();
      return;
    }
    const lastSpoken = state.lastSpokenAt.get(request.category) ?? -Infinity;
    const cooldownWait = Math.max(0, lastSpoken + cooldownFor(request.category) - now());
    if (cooldownWait > 0) {
      schedulePending();
      return;
    }
    state.pending.splice(requestIndex, 1);
    state.lastSpokenAt.set(request.category, now());
    state.generation += 1;
    state.active = { ...request, index: 0, generation: state.generation };
    speakCurrentSegment();
  }

  function enqueue(segments, settings, category) {
    const safe = sanitizeSettings(settings);
    const reason = suppressionReason(safe);
    if (reason) return { accepted: false, reason };
    const filtered = segments.filter(Boolean);
    if (!filtered.length) return { accepted: false, reason: "empty" };
    const categoryName = boundedText(category || "general") || "general";
    const request = {
      segments: filtered,
      settings: presentationSettings(safe),
      category: categoryName,
    };
    let replaced = false;
    if (categoryName === "error") {
      if (state.pending.length >= NARRATOR_MAX_PENDING) return { accepted: false, reason: "queue-full" };
      state.pending.push(request);
    } else {
      const replacementIndex = state.pending.findIndex((item) => item.category === categoryName);
      if (replacementIndex >= 0) {
        state.pending[replacementIndex] = request;
        replaced = true;
      } else if (state.pending.length < NARRATOR_MAX_PENDING) {
        state.pending.push(request);
      } else {
        return { accepted: false, reason: "queue-full" };
      }
    }
    clearScheduled();
    if (!state.active) schedulePending();
    return { accepted: true, queued: true, replaced };
  }

  function narrateText(text, settings, requestOptions = {}) {
    const safe = presentationSettings(settings);
    const language = safe.schoolModeEnabled ? "en" : safe.narratorLanguage;
    const value = boundedText(text);
    if (!value) return { accepted: false, reason: "empty" };
    if (language === "both" && value.includes(" · ")) {
      const [english, ...cantonese] = value.split(" · ");
      return enqueue(
        [segment(english, "en"), segment(cantonese.join(" · "), "yue")],
        safe,
        requestOptions.category,
      );
    }
    return enqueue([segment(value, language === "yue" ? "yue" : "en")], safe, requestOptions.category);
  }

  function narrateKey(key, settings, variables = {}, requestOptions = {}) {
    const safe = presentationSettings(settings);
    const parts = narrationParts(key, safe, variables);
    const language = safe.schoolModeEnabled ? "en" : safe.narratorLanguage;
    const segments = language === "both"
      ? [segment(parts.en, "en"), segment(parts.yue, "yue")]
      : [segment(language === "yue" ? parts.yue : parts.en, language === "yue" ? "yue" : "en")];
    return enqueue(segments, safe, requestOptions.category);
  }

  function cancel() {
    clearScheduled();
    state.pending = [];
    state.generation += 1;
    state.active = null;
    try {
      if (tts) tts.stop?.();
      else speechSynthesis?.cancel?.();
    } catch {
      // A missing or unavailable speech engine is already fail-safe.
    }
  }

  function snapshot() {
    return {
      active: Boolean(state.active),
      pending: state.pending.length ? { categories: state.pending.map((item) => item.category), count: state.pending.length } : null,
      lastSpokenAt: Object.fromEntries(state.lastSpokenAt),
    };
  }

  return Object.freeze({ narrateText, narrateKey, cancel, snapshot });
}
