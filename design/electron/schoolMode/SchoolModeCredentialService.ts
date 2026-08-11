import type {
  PresentationSettings,
  ResetCredentialState,
  SchoolModeCredentialMetadata,
} from "../../shared/types";
import type { SchoolModeResetVault } from "./SchoolModeResetVault";

const PASSWORD_MAX_LENGTH = 256;

export interface SchoolModeCredentialHost {
  getSchoolModeCredentialMetadata(): SchoolModeCredentialMetadata;
  setSchoolModeCredentialState(state: ResetCredentialState): Promise<PresentationSettings>;
  disableSchoolModeAfterCredentialVerification(): Promise<PresentationSettings>;
}

function assertCredential(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertPair(next: unknown, confirmation: unknown): asserts next is string {
  assertCredential(next, "new School mode reset credential");
  assertCredential(confirmation, "School mode reset credential confirmation");
  if (next !== confirmation) throw new Error("School mode reset credentials did not match");
}

/** Main-process orchestration for the shared School-mode credential boundary. */
export class SchoolModeCredentialService {
  private operation: Promise<void> = Promise.resolve();

  constructor(
    private readonly vault: SchoolModeResetVault,
    private readonly host: SchoolModeCredentialHost,
  ) {}

  setup(next: unknown, confirmation: unknown): Promise<PresentationSettings> {
    return this.serial(async () => {
      assertPair(next, confirmation);
      if (this.host.getSchoolModeCredentialMetadata().state === "configured") {
        throw new Error("School mode reset credential is already configured");
      }
      await this.vault.configure(next);
      try {
        return await this.host.setSchoolModeCredentialState("configured");
      } catch (error) {
        await this.vault.remove().catch(() => undefined);
        throw error;
      }
    });
  }

  change(current: unknown, next: unknown, confirmation: unknown): Promise<PresentationSettings> {
    return this.serial(async () => {
      assertCredential(current, "current School mode reset credential");
      assertPair(next, confirmation);
      if (this.host.getSchoolModeCredentialMetadata().state !== "configured") {
        throw new Error("School mode reset credential is unavailable; delete the app-data folder to recover it");
      }
      await this.vault.replace(current, next);
      return this.host.setSchoolModeCredentialState("configured");
    });
  }

  reset(current: unknown): Promise<PresentationSettings> {
    return this.serial(async () => {
      assertCredential(current, "current School mode reset credential");
      if (this.host.getSchoolModeCredentialMetadata().state !== "configured") {
        throw new Error("School mode reset credential is unavailable; delete the app-data folder to recover it");
      }
      if (!(await this.vault.verify(current))) throw new Error("School mode reset credential did not match");
      await this.vault.remove();
      try {
        return await this.host.setSchoolModeCredentialState("unconfigured");
      } catch (error) {
        // Keep the metadata and vault aligned if the settings write fails.
        // The current value is still transiently present in this call, so it
        // can restore the verifier without exposing it to settings or logs.
        const restored = await this.vault.configure(current).then(() => true, () => false);
        if (!restored) await this.host.setSchoolModeCredentialState("unavailable").catch(() => undefined);
        throw error;
      }
    });
  }

  disable(current: unknown): Promise<PresentationSettings> {
    return this.serial(async () => {
      assertCredential(current, "current School mode reset credential");
      if (this.host.getSchoolModeCredentialMetadata().state !== "configured") {
        throw new Error("School mode reset credential is unavailable; delete the app-data folder to recover it");
      }
      if (!(await this.vault.verify(current))) throw new Error("School mode reset credential did not match");
      return this.host.disableSchoolModeAfterCredentialVerification();
    });
  }

  synchronize(hadStateFile: boolean): Promise<void> {
    return this.serial(async () => {
      let vaultState: "configured" | "unconfigured";
      try {
        vaultState = await this.vault.state();
      } catch {
        if (this.host.getSchoolModeCredentialMetadata().state !== "unavailable") {
          await this.host.setSchoolModeCredentialState("unavailable");
        }
        return;
      }

      // Deleting app data is the intentional local reset route. A fresh state
      // file must not inherit an orphaned OS-vault verifier from an old profile.
      if (!hadStateFile && vaultState === "configured") {
        await this.vault.remove();
        vaultState = "unconfigured";
      }

      const metadata = this.host.getSchoolModeCredentialMetadata();
      const nextState: ResetCredentialState = vaultState === "configured"
        ? "configured"
        : metadata.state === "configured"
          ? "unavailable"
          : "unconfigured";
      if (metadata.state !== nextState) await this.host.setSchoolModeCredentialState(nextState);
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }
}
