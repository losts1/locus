import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEYLEN = 32;

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
