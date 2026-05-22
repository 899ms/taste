import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function safeEqualHash(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function encryptSecret(secret: string, keyMaterial: string): EncryptedSecret {
  const key = normalizeKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(encrypted: EncryptedSecret, keyMaterial: string): string {
  const key = normalizeKey(keyMaterial);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeKey(keyMaterial: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(keyMaterial)) return Buffer.from(keyMaterial, "hex");
  if (keyMaterial.length >= 43) {
    const decoded = Buffer.from(keyMaterial, "base64url");
    if (decoded.length === 32) return decoded;
  }
  return createHash("sha256").update(keyMaterial).digest();
}
