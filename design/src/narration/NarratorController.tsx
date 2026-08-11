import { useEffect, useRef } from "react";
import type { AppSettings, FunnyLevel, NarratorLanguage } from "@shared/types";
import { effectiveNarratorSettings, NarratorQueue, type NarrationRequest, type NarratorSettings, type SpeechSegment } from "@shared/narration";
import { useAppStore } from "../store/useAppStore";

export const NARRATION_EVENT = "mdm:narration";
const NOTIFICATION_EVENT = "mdm:notification";

export interface NarrationEventDetail extends NarrationRequest {
  settings?: NarratorSettings;
}

function chooseVoice(voices: SpeechSynthesisVoice[], language: SpeechSegment["language"]): SpeechSynthesisVoice | undefined {
  const prefixes = language === "yue-HK" ? ["yue-hk", "zh-hk"] : ["en-us", "en-gb", "en"];
  return voices.find((voice) => prefixes.some((prefix) => voice.lang.toLowerCase() === prefix))
    ?? voices.find((voice) => prefixes.some((prefix) => voice.lang.toLowerCase().startsWith(prefix)));
}

export function speechSynthesisAvailable(): boolean {
  return typeof window !== "undefined"
    && Boolean(window.speechSynthesis)
    && typeof window.SpeechSynthesisUtterance === "function";
}

export type SpeechSynthesisReadiness = "ready" | "speech-unavailable" | "cantonese-voice-unavailable";

export function speechSynthesisReadiness(language: NarratorLanguage): SpeechSynthesisReadiness {
  if (!speechSynthesisAvailable()) return "speech-unavailable";
  if (language !== "english" && !chooseVoice(window.speechSynthesis.getVoices(), "yue-HK")) {
    return "cantonese-voice-unavailable";
  }
  return "ready";
}

function createBrowserAdapter(): { adapter: ConstructorParameters<typeof NarratorQueue>[0]; available: boolean } {
  if (!speechSynthesisAvailable()) {
    return {
      available: false,
      adapter: { speak: (_segment, done) => done(new Error("Speech synthesis is unavailable.")), cancel: () => undefined },
    };
  }
  const synthesis = window.speechSynthesis;
  return {
    available: true,
    adapter: {
      speak: (segment, done) => {
        const utterance = new SpeechSynthesisUtterance(segment.text);
        utterance.lang = segment.language;
        utterance.rate = 1;
        utterance.pitch = 1;
        const voices = synthesis.getVoices();
        const voice = chooseVoice(voices, segment.language);
        if (segment.language === "yue-HK" && !voice) {
          done(new Error("A Hong Kong Cantonese speech voice is unavailable."));
          return;
        }
        if (voice) utterance.voice = voice;
        let finished = false;
        const finish = (error?: unknown) => {
          if (finished) return;
          finished = true;
          done(error);
        };
        utterance.onend = () => finish();
        utterance.onerror = (event) => finish(event.error || new Error("Speech synthesis failed."));
        synthesis.speak(utterance);
      },
      cancel: () => synthesis.cancel(),
    },
  };
}

function screenReaderActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.screenReaderActive === "true"
    || document.body?.dataset.screenReaderActive === "true";
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function requestNarration(request: NarrationEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent< NarrationEventDetail >(NARRATION_EVENT, { detail: request }));
}

/** Mount once in App so notifications and user tests share one serialized queue. */
export default function NarratorController() {
  const settings = useAppStore((state) => state.settings);
  const queueRef = useRef<ReturnType<typeof createQueue> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  if (!queueRef.current) queueRef.current = createQueue(effectiveNarratorSettings(settings));

  useEffect(() => {
    const queue = queueRef.current!;
    const next = effectiveNarratorSettings(settings);
    queue.setSettings({ ...next, enabled: next.enabled && speechSynthesisAvailable() });
    queue.setEnvironment({ screenReaderActive: screenReaderActive(), reducedMotion: reducedMotion() });
  }, [settings]);

  useEffect(() => {
    const queue = queueRef.current!;
    const handleNarration = (event: Event) => {
      const detail = (event as CustomEvent<NarrationEventDetail>).detail;
      if (!detail) return;
      const override = detail.settings;
      const current = effectiveNarratorSettings(settingsRef.current);
      const requested = override ?? current;
      const schoolMode = settingsRef.current?.schoolModeEnabled === true;
      const effective = {
        ...requested,
        enabled: (schoolMode ? false : requested.enabled) && speechSynthesisAvailable(),
        language: schoolMode ? "english" as const : requested.language,
        funnyLevelEnglish: schoolMode ? 1 as const : requested.funnyLevelEnglish,
        funnyLevelCantonese: schoolMode ? 1 as const : requested.funnyLevelCantonese,
        assistiveTechnologyActive: current.assistiveTechnologyActive || requested.assistiveTechnologyActive,
      };
      queue.setSettings(effective);
      queue.setEnvironment({ screenReaderActive: screenReaderActive(), reducedMotion: reducedMotion() });
      queue.enqueue({ ...detail, settings: effective });
    };
    const handleNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ narration?: NarrationEventDetail }>).detail;
      if (!detail?.narration) return;
      handleNarration(new CustomEvent<NarrationEventDetail>(NARRATION_EVENT, { detail: detail.narration }));
    };
    const handleEnvironmentChange = (event?: Event) => {
      const detail = event instanceof CustomEvent
        ? (event as CustomEvent<{ active?: unknown }>).detail
        : null;
      queue.setEnvironment({
        screenReaderActive: detail?.active === true || screenReaderActive() || Boolean(settingsRef.current?.narratorAssistiveTechnologyActive),
        reducedMotion: reducedMotion(),
      });
    };
    window.addEventListener(NARRATION_EVENT, handleNarration);
    window.addEventListener(NOTIFICATION_EVENT, handleNotification);
    window.addEventListener("mdm:screen-reader-active", handleEnvironmentChange);
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    media?.addEventListener?.("change", handleEnvironmentChange);
    return () => {
      window.removeEventListener(NARRATION_EVENT, handleNarration);
      window.removeEventListener(NOTIFICATION_EVENT, handleNotification);
      window.removeEventListener("mdm:screen-reader-active", handleEnvironmentChange);
      media?.removeEventListener?.("change", handleEnvironmentChange);
      queue.cancel();
    };
  }, []);

  return null;
}

function createQueue(settings: NarratorSettings): NarratorQueue {
  const browser = createBrowserAdapter();
  const queue = new NarratorQueue(browser.adapter);
  queue.setSettings({ ...settings, enabled: settings.enabled && browser.available });
  return queue;
}

export type { FunnyLevel, NarratorLanguage };
