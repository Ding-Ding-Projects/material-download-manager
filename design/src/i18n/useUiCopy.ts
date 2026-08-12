import { useMemo } from "react";
import type { AppSettings } from "@shared/types";
import { useAppStore } from "../store/useAppStore";
import { getUiCopy } from "./ui";

/**
 * Recomputes the copy boundary when the private runtime mapping changes while
 * keeping all settings-derived language and School-mode behavior intact.
 */
export function useUiCopy(settings: AppSettings | null | undefined) {
  const personalVocabulary = useAppStore((state) => state.personalVocabulary);
  return useMemo(() => getUiCopy(settings), [personalVocabulary, settings]);
}
