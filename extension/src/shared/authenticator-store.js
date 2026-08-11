import {
  AUTHENTICATOR_MAX_RECORDS,
  createTotpMetadata,
  createTotpRegistrationModel,
  generateTotpCode,
  isTotpMetadata,
  normalizeTotpRegistration,
  parseTotpUri,
  toSecretFreeMetadata,
  verifyTotpCode,
} from "./totp.js";
import { appendAuthenticatorMutation } from "./mutation-journal.js";

export const AUTHENTICATOR_METADATA_KEY = "authenticatorMetadata.v1";
export const AUTHENTICATOR_SECRETS_KEY = "authenticatorSecrets.v1";

function randomId() {
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(18));
  if (!bytes) throw new Error("Browser randomness is unavailable for the authenticator.");
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); },
    async remove(key) { values.delete(key); },
    values,
  };
}

function safeMetadataList(value) {
  if (!Array.isArray(value)) throw new Error("The authenticator metadata is corrupt.");
  if (value.length > AUTHENTICATOR_MAX_RECORDS) throw new Error("The authenticator metadata exceeds its safety limit.");
  const seen = new Set();
  return value.map((item) => {
    if (!isTotpMetadata(item) || seen.has(item.id)) throw new Error("The authenticator metadata is corrupt.");
    seen.add(item.id);
    return toSecretFreeMetadata(item);
  });
}

function safeSecrets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The authenticator secret record is corrupt.");
  if (Object.keys(value).length > AUTHENTICATOR_MAX_RECORDS) throw new Error("The authenticator secrets exceed their safety limit.");
  const result = {};
  for (const [id, secret] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(id) || typeof secret !== "string") throw new Error("The authenticator secret record is corrupt.");
    try {
      result[id] = normalizeTotpRegistration({ issuer: "session", account: "secret", secret }).secret;
    } catch {
      throw new Error("The authenticator secret record is corrupt.");
    }
  }
  return result;
}

/**
 * Storage boundary for the extension authenticator.
 *
 * Persistent metadata and the browser-local fallback secret record live in
 * separate chrome.storage.local keys. Chrome extensions do not expose the
 * operating-system credential vault, so this fallback is explicitly not a
 * security boundary; the UI and docs name it and clearing extension storage
 * resets it. The pending one-time model remains in memory only.
 */
export function createAuthenticatorStore({ local, now = () => Date.now(), idFactory = randomId } = {}) {
  const localStorage = local ?? memoryStorage();
  let mutation = Promise.resolve();

  const serialize = (action) => {
    mutation = mutation.catch(() => {}).then(action);
    return mutation;
  };

  async function readMetadata() {
    const stored = await localStorage.get(AUTHENTICATOR_METADATA_KEY);
    return stored?.[AUTHENTICATOR_METADATA_KEY] === undefined ? [] : safeMetadataList(stored[AUTHENTICATOR_METADATA_KEY]);
  }

  async function readSecrets() {
    const stored = await localStorage.get(AUTHENTICATOR_SECRETS_KEY);
    return stored?.[AUTHENTICATOR_SECRETS_KEY] === undefined ? {} : safeSecrets(stored[AUTHENTICATOR_SECRETS_KEY]);
  }

  /**
   * Reconcile the two local records after a worker crash or interrupted write.
   * A secret without a validated metadata row is never usable, so prune only
   * those orphan ids and fail closed if the storage write itself is refused.
   */
  async function readConsistentState() {
    const metadata = await readMetadata();
    const secrets = await readSecrets();
    const ids = new Set(metadata.map((item) => item.id));
    const reconciled = Object.fromEntries(Object.entries(secrets).filter(([id]) => ids.has(id)));
    if (Object.keys(reconciled).length !== Object.keys(secrets).length) {
      await localStorage.set({ [AUTHENTICATOR_SECRETS_KEY]: reconciled });
    }
    return { metadata, secrets: reconciled };
  }

  async function prepare(input) {
    const registration = typeof input?.uri === "string" ? parseTotpUri(input.uri) : normalizeTotpRegistration(input);
    return createTotpRegistrationModel(registration);
  }

  async function cancelPending() {
    return { ok: true };
  }

  async function confirm(input, candidate, timestampMs = now()) {
    return serialize(async () => {
      const registration = normalizeTotpRegistration(input);
      if (!(await verifyTotpCode(registration, candidate, timestampMs, 1))) return { ok: false, code: "authenticator-code-mismatch" };
      const metadata = createTotpMetadata(idFactory(), registration);
      const { metadata: metadataList, secrets } = await readConsistentState();
      if (metadataList.length >= AUTHENTICATOR_MAX_RECORDS) return { ok: false, code: "authenticator-capacity-full" };
      if (metadataList.some((item) => item.id === metadata.id)) return { ok: false, code: "authenticator-id-collision" };
      secrets[metadata.id] = registration.secret;
      let metadataWritten = false;
      let secretsWritten = false;
      try {
        await localStorage.set({ [AUTHENTICATOR_SECRETS_KEY]: secrets });
        secretsWritten = true;
        await localStorage.set({ [AUTHENTICATOR_METADATA_KEY]: [...metadataList, metadata] });
        metadataWritten = true;
        await appendAuthenticatorMutation(localStorage, { action: "authenticator-created", id: metadata.id, at: new Date(timestampMs).toISOString() });
      } catch (error) {
        delete secrets[metadata.id];
        if (secretsWritten) await localStorage.set({ [AUTHENTICATOR_SECRETS_KEY]: secrets });
        if (metadataWritten) await localStorage.set({ [AUTHENTICATOR_METADATA_KEY]: metadataList });
        throw error;
      }
      return { ok: true, metadata };
    });
  }

  async function getCode(id, timestampMs = now()) {
    const { metadata: metadataList, secrets } = await readConsistentState();
    const metadata = metadataList.find((item) => item.id === id);
    if (!metadata) return { ok: false, code: "authenticator-not-found" };
    const secret = secrets[id];
    if (!secret) return { ok: false, code: "authenticator-browser-secret-unavailable", metadata };
    const registration = normalizeTotpRegistration({ ...metadata, secret });
    const code = await generateTotpCode(registration, timestampMs);
    const nextCode = await generateTotpCode(registration, timestampMs + registration.period * 1000);
    const elapsed = Math.floor(timestampMs / 1000) % registration.period;
    return { ok: true, metadata, code, nextCode, remainingSeconds: registration.period - elapsed };
  }

  async function remove(id) {
    return serialize(async () => {
      const { metadata: metadataList, secrets } = await readConsistentState();
      if (!metadataList.some((item) => item.id === id)) return { ok: false, code: "authenticator-not-found" };
      const previousSecrets = { ...secrets };
      delete secrets[id];
      const nextMetadata = metadataList.filter((item) => item.id !== id);
      let secretsWritten = false;
      let metadataWritten = false;
      try {
        await localStorage.set({ [AUTHENTICATOR_SECRETS_KEY]: secrets });
        secretsWritten = true;
        await localStorage.set({ [AUTHENTICATOR_METADATA_KEY]: nextMetadata });
        metadataWritten = true;
        await appendAuthenticatorMutation(localStorage, { action: "authenticator-removed", id, at: new Date(now()).toISOString() });
      } catch (error) {
        if (secretsWritten || metadataWritten) await localStorage.set({ [AUTHENTICATOR_SECRETS_KEY]: previousSecrets, [AUTHENTICATOR_METADATA_KEY]: metadataList });
        throw error;
      }
      return { ok: true };
    });
  }

  async function state() {
    return { metadata: (await readConsistentState()).metadata };
  }

  async function exportMetadata() {
    return (await readConsistentState()).metadata.map(toSecretFreeMetadata);
  }

  return { prepare, cancelPending, confirm, getCode, remove, state, exportMetadata, readMetadata };
}
