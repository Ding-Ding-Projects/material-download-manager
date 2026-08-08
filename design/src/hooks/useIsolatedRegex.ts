import { useEffect, useMemo, useState } from "react";
import {
  localizedRegexEvaluationError,
  localizedPrefixedRegexEvaluationError,
  REGEX_MAX_SAMPLE_LENGTH,
  validateRegexPattern,
  type RegexEvaluation,
} from "@shared/regex";

export { localizedRegexEvaluationError, localizedPrefixedRegexEvaluationError } from "@shared/regex";

interface CompletedRegexBatch {
  pattern: string;
  flags: string;
  samples: readonly string[];
  includeMatches: boolean;
  evaluations: RegexEvaluation[];
}

export interface IsolatedRegexBatchState {
  evaluations: RegexEvaluation[] | null;
  error: string | null;
  pending: boolean;
}

function failedBatch(samples: readonly string[], message: string): RegexEvaluation[] {
  return samples.map((sample) => ({
    error: message,
    matches: [],
    truncated: true,
    normalizedSample: sample.slice(0, REGEX_MAX_SAMPLE_LENGTH),
  }));
}

/**
 * Evaluate renderer-authored expressions in the main process's terminable
 * worker. Results are generation-checked so an older IPC response cannot
 * replace a newer query.
 */
export function useIsolatedRegexBatch(
  pattern: string,
  flags: string,
  samples: readonly string[],
  enabled: boolean,
  includeMatches = false
): IsolatedRegexBatchState {
  const [completed, setCompleted] = useState<CompletedRegexBatch | null>(null);
  const validationError = useMemo(
    () => enabled ? validateRegexPattern(pattern, flags) : null,
    [enabled, flags, pattern]
  );

  useEffect(() => {
    if (!enabled || validationError || samples.length === 0) return;
    let current = true;
    void window.api.evaluateRegexBatch(pattern, flags, [...samples], includeMatches)
      .then((evaluations) => {
        if (current) setCompleted({ pattern, flags, samples, includeMatches, evaluations });
      })
      .catch(() => {
        if (current) {
          setCompleted({
            pattern,
            flags,
            samples,
            includeMatches,
            evaluations: failedBatch(samples, "Regular expression evaluation failed."),
          });
        }
      });
    return () => {
      current = false;
    };
  }, [enabled, flags, includeMatches, pattern, samples, validationError]);

  if (!enabled) return { evaluations: null, error: null, pending: false };
  if (validationError) {
    return { evaluations: failedBatch(samples, validationError), error: validationError, pending: false };
  }
  if (samples.length === 0) return { evaluations: [], error: null, pending: false };
  const isCurrent =
    completed?.pattern === pattern &&
    completed.flags === flags &&
    completed.samples === samples &&
    completed.includeMatches === includeMatches;
  if (!isCurrent) return { evaluations: null, error: null, pending: true };
  const error = completed.evaluations.find((evaluation) => evaluation.error)?.error ?? null;
  return { evaluations: completed.evaluations, error, pending: false };
}
