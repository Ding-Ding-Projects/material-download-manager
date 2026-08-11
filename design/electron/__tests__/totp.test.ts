import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTotpUri,
  createTotpQrRegistrationModel,
  isTotpRegistrationExportRecord,
  normalizeTotpRegistration,
  parseTotpUri,
  type TotpRegistrationMetadata,
} from "../../shared/authenticator";
import { nextTotpTimestampMs, remainingTotpSeconds } from "../../shared/authenticatorDisplay";
import { generateTotpCode, verifyTotpCode } from "../authenticator/TotpEngine";
import { TotpRegistrationService } from "../authenticator/TotpRegistrationService";
import { TotpSecretVault, type TotpSecretVaultAdapter } from "../authenticator/TotpSecretVault";

function base32(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = Buffer.from(value, "ascii");
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

const vectorTimes = [59, 1_111_111_109, 1_111_111_111, 1_234_567_890, 2_000_000_000, 20_000_000_000];
const vectors = {
  SHA1: ["94287082", "07081804", "14050471", "89005924", "69279037", "65353130"],
  SHA256: ["46119246", "68084774", "67062674", "91819424", "90698825", "77737706"],
  SHA512: ["90693936", "25091201", "99943326", "93441116", "38618901", "47863826"],
} as const;

for (const algorithm of ["SHA1", "SHA256", "SHA512"] as const) {
  test(`RFC 6238 ${algorithm} vectors generate eight-digit codes`, () => {
    const registration = {
      issuer: "RFC 6238",
      account: "vectors",
      secret: base32(algorithm === "SHA1"
        ? "12345678901234567890"
        : algorithm === "SHA256"
          ? "12345678901234567890123456789012"
          : "1234567890123456789012345678901234567890123456789012345678901234"),
      algorithm,
      digits: 8 as const,
      period: 30,
    };
    for (const [index, seconds] of vectorTimes.entries()) {
      assert.equal(generateTotpCode(registration, seconds * 1_000), vectors[algorithm][index]);
    }
  });
}

test("RFC 6238 supports six-digit truncation and bounded period skew", () => {
  const registration = normalizeTotpRegistration({
    issuer: "Example",
    account: "six-digit",
    secret: base32("12345678901234567890"),
    algorithm: "SHA1",
    digits: 6,
    period: 60,
  });
  const previous = generateTotpCode(registration, 59_000);
  const current = generateTotpCode(registration, 60_000);
  assert.equal(previous, "755224");
  assert.equal(current, generateTotpCode(registration, 60_000));
  assert.equal(verifyTotpCode(registration, previous, 60_000, 0), false);
  assert.equal(verifyTotpCode(registration, previous, 60_000, 1), true);
  assert.throws(() => verifyTotpCode(registration, current, 60_000, 5), /skew/iu);
});

test("otpauth URI registration round-trips with issuer/account consistency", () => {
  const registration = normalizeTotpRegistration({
    issuer: "Example Bank",
    account: "alice@example.test",
    secret: "jbsw y3dp-ehpk3pxp",
    algorithm: "SHA512",
    digits: 8,
    period: 45,
  });
  const uri = buildTotpUri(registration);
  assert.match(uri, /^otpauth:\/\/totp\//u);
  assert.deepEqual(parseTotpUri(uri), registration);
  assert.throws(() => parseTotpUri(uri.replace("issuer=Example%20Bank", "issuer=Other")), /issuer/iu);
  assert.throws(() => parseTotpUri(uri.replace("otpauth://totp/", "otpauth://hotp/")), /URI/iu);
  assert.throws(() => parseTotpUri(uri.replace("&digits=8", "&digits=7")), /digits/iu);
  assert.throws(() => parseTotpUri(uri.replace("&period=45", "&unexpected=1")), /query/iu);
});

test("QR registration model is one-time material while ordinary metadata is secret-free", () => {
  const secret = base32("12345678901234567890");
  const qr = createTotpQrRegistrationModel({ issuer: "Example", account: "qr", secret });
  assert.equal(qr.manualSecret, secret);
  assert.equal(new URL(qr.otpauthUri).searchParams.get("secret"), secret);

  const metadata: TotpRegistrationMetadata = {
    schemaVersion: 1,
    id: "metadata-id",
    issuer: qr.issuer,
    account: qr.account,
    algorithm: qr.algorithm,
    digits: qr.digits,
    period: qr.period,
  };
  const ordinary = { ...metadata, secretOmitted: true as const };
  assert.equal(isTotpRegistrationExportRecord(ordinary), true);
  const serialized = JSON.stringify(ordinary);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("otpauth"), false);
  assert.equal(isTotpRegistrationExportRecord({ ...ordinary, secret }), false);
});

class MemoryVaultAdapter implements TotpSecretVaultAdapter {
  readonly values = new Map<string, Uint8Array>();

  async read(account: string): Promise<Uint8Array | null> {
    const value = this.values.get(account);
    return value ? new Uint8Array(value) : null;
  }

  async write(account: string, value: Uint8Array): Promise<void> {
    this.values.set(account, new Uint8Array(value));
  }

  async remove(account: string): Promise<void> {
    this.values.delete(account);
  }
}

test("registration service stores secrets only through the vault and returns metadata", async () => {
  const adapter = new MemoryVaultAdapter();
  const vault = new TotpSecretVault(adapter);
  const service = new TotpRegistrationService({ vault, idFactory: () => "fixed-test-id" });
  const secret = base32("12345678901234567890");
  const metadata = await service.register({ issuer: "Example", account: "service", secret });
  assert.equal(metadata.id, "fixed-test-id");
  assert.equal(await service.generateCode(metadata, 59_000), "287082");
  assert.equal(await service.verifyCode(metadata, "287082", 60_000, 1), true);
  const exported = service.exportMetadata(metadata);
  assert.equal(exported.secretOmitted, true);
  assert.equal(JSON.stringify(exported).includes(secret), false);
  assert.equal(JSON.stringify(exported).includes("otpauth"), false);
  assert.ok(adapter.values.has("totp:fixed-test-id"));
  await service.remove(metadata);
  assert.equal(adapter.values.has("totp:fixed-test-id"), false);
});

test("pending pairing confirms before vault mutation and rejects a wrong code", async () => {
  const adapter = new MemoryVaultAdapter();
  const service = new TotpRegistrationService({ vault: new TotpSecretVault(adapter), idFactory: () => "pending-test-id" });
  const secret = base32("12345678901234567890");
  const input = { issuer: "Example", account: "pending", secret, algorithm: "SHA1" as const, digits: 6 as const, period: 30 };
  const currentCode = generateTotpCode(input, 60_000);

  assert.equal(service.verifyPendingRegistration(input, "000000", 60_000, 1), false);
  assert.equal(adapter.values.size, 0, "a wrong code must not write to the vault");
  assert.equal(service.verifyPendingRegistration(input, currentCode, 60_000, 1), true);
  assert.equal(adapter.values.size, 0, "confirmation only verifies; registration performs the write");

  const metadata = await service.register(input);
  assert.equal(metadata.id, "pending-test-id");
  assert.equal(adapter.values.size, 1);
});

test("secret and URI validation fails closed at the model boundary", () => {
  assert.throws(() => normalizeTotpRegistration({ issuer: "", account: "x", secret: "JBSWY3DPEHPK3PXP" }), /issuer/iu);
  assert.throws(() => normalizeTotpRegistration({ issuer: "x", account: "y", secret: "not-base32-0" }), /secret/iu);
  assert.throws(() => normalizeTotpRegistration({ issuer: "x", account: "y", secret: "JBSWY3DPEHPK3PXP", digits: 7 }), /digits/iu);
  assert.throws(() => normalizeTotpRegistration({ issuer: "x", account: "y", secret: "JBSWY3DPEHPK3PXP", period: 0 }), /period/iu);
});

test("renderer-safe countdown helpers stay aligned to period boundaries", () => {
  assert.equal(remainingTotpSeconds(60_001, 30), 30);
  assert.equal(nextTotpTimestampMs(60_001, 30), 90_000);
  assert.equal(remainingTotpSeconds(89_999, 30), 1);
  assert.equal(nextTotpTimestampMs(89_999, 30), 90_000);
  assert.equal(remainingTotpSeconds(90_000, 30), 30);
  assert.throws(() => remainingTotpSeconds(1_000, 0), /period/iu);
  assert.throws(() => nextTotpTimestampMs(Number.NaN, 30), /timestamp/iu);
});
