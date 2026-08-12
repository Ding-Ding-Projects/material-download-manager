import {
  applyPersonalVocabularyText,
  createPersonalVocabularyRuntime,
  isPersonalVocabularyRuntime,
  type PersonalVocabularyRuntime,
} from "@shared/personalVocabulary";

let currentRuntime = createPersonalVocabularyRuntime();

/** Runtime-only renderer state; no selected-file path or source metadata exists here. */
export function setPersonalVocabularyRuntime(value: PersonalVocabularyRuntime): void {
  currentRuntime = isPersonalVocabularyRuntime(value)
    ? createPersonalVocabularyRuntime(value.status.state, value.replacements)
    : createPersonalVocabularyRuntime();
}

export function getPersonalVocabularyRuntime(): PersonalVocabularyRuntime {
  return createPersonalVocabularyRuntime(
    currentRuntime.status.state,
    currentRuntime.replacements,
  );
}

/**
 * This is the opt-in text boundary for UI copy. Technical strings, URLs,
 * paths, command syntax, external records, and export data never call it.
 */
export function personalizeUiCopy(value: string, schoolModeEnabled: boolean): string {
  return applyPersonalVocabularyText(value, currentRuntime, { suppressed: schoolModeEnabled });
}
