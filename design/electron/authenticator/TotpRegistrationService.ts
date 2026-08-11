import { randomBytes } from "node:crypto";
import {
  createTotpMetadata,
  createTotpQrRegistrationModel,
  isTotpRegistrationMetadata,
  normalizeTotpRegistration,
  toSecretFreeTotpExport,
  type TotpRegistrationExportRecord,
  type TotpRegistrationInput,
  type TotpRegistrationMetadata,
  type TotpQrRegistrationModel,
} from "../../shared/authenticator";
import { generateTotpCode, verifyTotpCode } from "./TotpEngine";
import { TotpSecretVault } from "./TotpSecretVault";

export interface TotpRegistrationServiceOptions {
  vault?: TotpSecretVault;
  idFactory?: () => string;
}
function createId(): string {
  return randomBytes(18).toString("base64url");
}

function assertMetadata(value: unknown): asserts value is TotpRegistrationMetadata {
  if (!isTotpRegistrationMetadata(value)) throw new Error("Invalid authenticator registration metadata");
}

function registrationWithSecret(metadata: TotpRegistrationMetadata, secret: string) {
  return normalizeTotpRegistration({
    issuer: metadata.issuer,
    account: metadata.account,
    secret,
    algorithm: metadata.algorithm,
    digits: metadata.digits,
    period: metadata.period,
  });
}

/** Main-process owner of registration metadata and vault-backed TOTP codes. */
export class TotpRegistrationService {
  private readonly vault: TotpSecretVault;
  private readonly idFactory: () => string;

  constructor(options: TotpRegistrationServiceOptions = {}) {
    this.vault = options.vault ?? new TotpSecretVault();
    this.idFactory = options.idFactory ?? createId;
  }

  /** Build one-time QR/manual material; callers must not persist or log it. */
  createQrRegistration(input: TotpRegistrationInput): TotpQrRegistrationModel {
    return createTotpQrRegistrationModel(input);
  }

  /** Store only the normalized credential in the OS vault and return metadata. */
  async register(input: TotpRegistrationInput): Promise<TotpRegistrationMetadata> {
    const registration = normalizeTotpRegistration(input);
    const id = this.idFactory();
    const metadata = createTotpMetadata(id, registration);
    await this.vault.store(id, registration.secret);
    return metadata;
  }

  async generateCode(metadata: TotpRegistrationMetadata, timestampMs = Date.now()): Promise<string> {
    assertMetadata(metadata);
    const secret = await this.vault.load(metadata.id);
    if (!secret) throw new Error("Authenticator registration secret is unavailable");
    return generateTotpCode(registrationWithSecret(metadata, secret), timestampMs);
  }

  async verifyCode(
    metadata: TotpRegistrationMetadata,
    candidate: unknown,
    timestampMs = Date.now(),
    skewSteps = 1,
  ): Promise<boolean> {
    assertMetadata(metadata);
    const secret = await this.vault.load(metadata.id);
    if (!secret) return false;
    return verifyTotpCode(registrationWithSecret(metadata, secret), candidate, timestampMs, skewSteps);
  }

  async remove(metadata: TotpRegistrationMetadata): Promise<void> {
    assertMetadata(metadata);
    await this.vault.remove(metadata.id);
  }

  /** Ordinary exports contain metadata only and never include an otpauth URI. */
  exportMetadata(metadata: TotpRegistrationMetadata): TotpRegistrationExportRecord {
    assertMetadata(metadata);
    return toSecretFreeTotpExport(metadata);
  }
}
