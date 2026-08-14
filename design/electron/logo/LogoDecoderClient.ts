import path from "node:path";
import { utilityProcess } from "electron";
import {
  APP_LOGO_MAX_INPUT_BYTES,
  APP_LOGO_MAX_TOTAL_VARIANT_BYTES,
  APP_LOGO_MAX_VARIANT_BYTES,
  APP_LOGO_MAX_VARIANTS,
  isAppLogoSettings,
  type AppLogoSettings,
} from "../../shared/appLogo";
import { inspectLogoImageBytes } from "./imageInspection";

export const LOGO_DECODER_TIMEOUT_MS = 4_000;
const MAX_BASE64_INPUT_LENGTH = Math.ceil(APP_LOGO_MAX_INPUT_BYTES / 3) * 4;
const MAX_BASE64_VARIANT_LENGTH = Math.ceil(APP_LOGO_MAX_VARIANT_BYTES / 3) * 4;

export interface LogoVariant {
  size: number;
  png: Buffer;
}

export interface LogoDecoderResult {
  variants: LogoVariant[];
}

export interface LogoDecoderPort {
  render(source: Buffer, settings: AppLogoSettings): Promise<LogoDecoderResult>;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key));
}

function decodeStrictBase64(value: unknown, maximumBytes: number): Buffer | null {
  const maximumChars = Math.ceil(maximumBytes / 3) * 4;
  if (typeof value !== "string" || value.length < 4 || value.length > maximumChars || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.length <= maximumBytes && decoded.toString("base64") === value ? decoded : null;
}

function parseResponse(value: unknown): LogoDecoderResult | null {
  if (!isExactRecord(value, ["ok", "variants"]) || value.ok !== true || !Array.isArray(value.variants) || value.variants.length !== APP_LOGO_MAX_VARIANTS) {
    return null;
  }
  const seen = new Set<number>();
  let total = 0;
  const variants: LogoVariant[] = [];
  for (const candidate of value.variants) {
    if (!isExactRecord(candidate, ["size", "pngBase64"]) || typeof candidate.size !== "number" || !Number.isInteger(candidate.size) || seen.has(candidate.size)) return null;
    const png = decodeStrictBase64(candidate.pngBase64, APP_LOGO_MAX_VARIANT_BYTES);
    if (!png) return null;
    const inspection = inspectLogoImageBytes(png);
    if (inspection.format !== "png" || inspection.width !== candidate.size || inspection.height !== candidate.size) return null;
    total += png.length;
    if (total > APP_LOGO_MAX_TOTAL_VARIANT_BYTES) return null;
    seen.add(candidate.size);
    variants.push({ size: candidate.size, png });
  }
  return variants.length === APP_LOGO_MAX_VARIANTS ? { variants } : null;
}

export class LogoDecoderClient implements LogoDecoderPort {
  render(source: Buffer, settings: AppLogoSettings): Promise<LogoDecoderResult> {
    if (!Buffer.isBuffer(source) || source.length < 1 || source.length > APP_LOGO_MAX_INPUT_BYTES || !isAppLogoSettings(settings) || settings.source !== "custom") {
      return Promise.reject(new Error("The local image could not be prepared safely."));
    }
    const sourceBase64 = source.toString("base64");
    if (sourceBase64.length > MAX_BASE64_INPUT_LENGTH) return Promise.reject(new Error("The local image could not be prepared safely."));

    return new Promise<LogoDecoderResult>((resolve, reject) => {
      const worker = utilityProcess.fork(path.join(__dirname, "LogoDecoderWorker.js"), [], {
        // A private, single-purpose process makes native image decoding killable
        // without ever blocking the main-process event loop.
        execArgv: ["--max-old-space-size=96"],
        stdio: "ignore",
        serviceName: "local-logo-decoder",
      });
      let settled = false;
      const settle = (result: LogoDecoderResult | null, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeAllListeners();
        if (worker.pid !== undefined) worker.kill();
        if (result) resolve(result);
        else reject(error ?? new Error("The local image could not be prepared safely."));
      };
      const timer = setTimeout(() => {
        settle(null, new Error("Local image conversion exceeded the safety time limit; the previous logo remains active."));
      }, LOGO_DECODER_TIMEOUT_MS);
      worker.once("message", (message: unknown) => {
        const parsed = parseResponse(message);
        settle(parsed, new Error("The local image conversion returned an invalid display asset."));
      });
      worker.once("exit", () => settle(null, new Error("The local image conversion stopped before completion; the previous logo remains active.")));
      try {
        worker.postMessage({ kind: "render", sourceBase64, settings });
      } catch {
        settle(null, new Error("The local image conversion could not start; the previous logo remains active."));
      }
    });
  }
}
