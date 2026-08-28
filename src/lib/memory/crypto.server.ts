import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEYLEN = 32;
const CACHE_MS = 5 * 60 * 1000;

const validKeys = new Map<string, number>();

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export async function hashKey(key: string, saltHex: string): Promise<string> {
  const salt = Buffer.from(saltHex, "hex");
  const derived = (await scrypt(key, salt, KEYLEN)) as Buffer;
  return derived.toString("hex");
}

export async function verifyKey(
  key: string,
  saltHex: string,
  hashHex: string,
): Promise<boolean> {
  const salt = Buffer.from(saltHex, "hex");
  const derived = (await scrypt(key, salt, KEYLEN)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function keyFingerprint(key: string, saltHex: string): string {
  return createHmac("sha256", saltHex).update(key).digest("hex");
}

export function cachedValid(fp: string): boolean {
  const exp = validKeys.get(fp);
  if (exp && exp > Date.now()) return true;
  validKeys.delete(fp);
  return false;
}

export function rememberValid(fp: string) {
  validKeys.set(fp, Date.now() + CACHE_MS);
}

export function forgetValid() {
  validKeys.clear();
}
