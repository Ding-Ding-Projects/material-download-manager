const FINAL_EVENTS = new Set(["end", "interrupted", "cancelled", "error"]);
const FINAL_EVENT_TYPES = [...FINAL_EVENTS];
const DEFAULT_VOICE_REFRESH_TIMEOUT_MS = 1_000;

function localeMatches(language, locale) {
  const value = String(locale ?? "").replace("_", "-").toLowerCase();
  if (language === "yue") return value === "zh-hk" || value.startsWith("yue-") || value === "yue";
  return value === "en" || value.startsWith("en-");
}

function voiceSupportsFinalEvents(voice) {
  if (!Array.isArray(voice?.eventTypes) || voice.eventTypes.length === 0) return true;
  return FINAL_EVENT_TYPES.every((type) => voice.eventTypes.includes(type));
}

export function createChromeTtsAdapter(tts, options = {}) {
  let sequence = 0;
  let voices = [];
  let voicesLoaded = false;
  const canInspectVoices = typeof tts?.getVoices === "function";
  const hasFinalEventApi = typeof tts?.speak === "function"
    && (typeof tts?.getVoices === "function" || options.assumePerCallEvents === true);
  const unavailable = options.onUnavailable ?? (() => {});

  function chooseVoice(language) {
    if (!canInspectVoices || !voicesLoaded) return null;
    return voices
      .filter((voice) => voice?.remote !== true && localeMatches(language, voice?.lang) && voiceSupportsFinalEvents(voice))
      .sort((a, b) => {
        const exactA = language === "yue" ? /^(zh-HK|yue)/iu.test(a?.lang ?? "") : /^en-HK/iu.test(a?.lang ?? "");
        const exactB = language === "yue" ? /^(zh-HK|yue)/iu.test(b?.lang ?? "") : /^en-HK/iu.test(b?.lang ?? "");
        return Number(exactB) - Number(exactA);
      })[0] ?? null;
  }

  async function refreshVoices() {
    if (!canInspectVoices) {
      voicesLoaded = true;
      return [];
    }
    return new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        voices = Array.isArray(value) ? value : [];
        voicesLoaded = true;
        resolve(voices);
      };
      timeoutId = setTimeout(() => finish([]), Math.max(100, Number(options.voiceRefreshTimeoutMs) || DEFAULT_VOICE_REFRESH_TIMEOUT_MS));
      try {
        const request = tts.getVoices((value) => finish(value));
        if (request && typeof request.then === "function") request.then((value) => finish(value)).catch(() => finish([]));
      } catch {
        finish([]);
      }
    });
  }

  function speak(text, speakOptions, done) {
    if (!hasFinalEventApi) {
      done();
      return;
    }
    const language = speakOptions?.language === "yue" ? "yue" : "en";
    const voice = chooseVoice(language);
    if (canInspectVoices && !voicesLoaded) {
      unavailable(language, "voices-not-ready");
      done();
      return;
    }
    if (canInspectVoices && !voice) {
      unavailable(language, "local-voice-unavailable");
      done();
      return;
    }
    const utteranceId = `material-download-manager-${++sequence}`;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      done();
    };
    const requestOptions = {
      ...speakOptions,
      ...(voice ? { voiceName: voice.voiceName } : {}),
      utteranceId,
      enqueue: false,
      requiredEventTypes: FINAL_EVENT_TYPES,
      onEvent: (event) => {
        if (event?.isFinalEvent === true || FINAL_EVENTS.has(event?.type)) settle();
      },
    };
    try {
      const callback = () => {
        if (globalThis.chrome?.runtime?.lastError) settle();
      };
      const request = tts.speak(text, requestOptions, callback);
      if (request && typeof request.catch === "function") request.catch(settle);
    } catch {
      settle();
    }
  }

  function stop() {
    try {
      tts?.stop?.();
    } catch {
      // Narration is advisory and never blocks the handoff operation.
    }
  }

  return Object.freeze({
    speak,
    stop,
    refreshVoices,
    supportsLanguage: (language) => !canInspectVoices || Boolean(chooseVoice(language === "yue" ? "yue" : "en")),
    isAvailable: () => hasFinalEventApi,
  });
}
