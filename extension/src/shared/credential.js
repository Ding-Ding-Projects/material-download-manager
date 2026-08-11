export const RESET_CREDENTIAL_STATES = Object.freeze({
  UNAVAILABLE: "unavailable",
  UNCONFIGURED: "unconfigured",
  CONFIGURED: "configured",
});

const KNOWN_STATES = new Set(Object.values(RESET_CREDENTIAL_STATES));

export function normalizeCredentialState(value) {
  return KNOWN_STATES.has(value) ? value : RESET_CREDENTIAL_STATES.UNAVAILABLE;
}

/**
 * A deliberately capability-free boundary for the extension surface.
 *
 * The desktop app owns the eventual OS credential-vault implementation. Until
 * that bridge is present, this object exposes state and fail-closed operations
 * without accepting or persisting any credential material in extension storage.
 */
export function createCredentialAbstraction(state = RESET_CREDENTIAL_STATES.UNAVAILABLE) {
  const normalizedState = normalizeCredentialState(state);
  const unavailable = { ok: false, code: "credential-unavailable" };
  return Object.freeze({
    state: normalizedState,
    available: false,
    supportsVerification: false,
    async verifyLocally() {
      return { ...unavailable };
    },
    async configure() {
      return { ...unavailable };
    },
    async clear() {
      return { ...unavailable };
    },
  });
}
