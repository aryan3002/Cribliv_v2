import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Output layout: [iv (12 bytes) | authTag (16 bytes) | ciphertext (n bytes)] using AES-256-GCM.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ENV_VAR = "RENT_AGREEMENT_PAN_KEY";
const KEY_ERROR = `${ENV_VAR} is not set or invalid`;
const DECRYPT_ERROR = "pan decrypt failed";

function resolveKey(key?: Buffer): Buffer {
  if (key !== undefined) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
      throw new Error(KEY_ERROR);
    }
    return key;
  }
  const raw = process.env[ENV_VAR];
  if (!raw) {
    throw new Error(KEY_ERROR);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new Error(KEY_ERROR);
  }
  if (decoded.length !== KEY_LENGTH) {
    throw new Error(KEY_ERROR);
  }
  return decoded;
}

export function encryptPan(plaintext: string, key?: Buffer): Buffer {
  const resolvedKey = resolveKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, resolvedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptPan(ciphertext: Buffer, key?: Buffer): string {
  const resolvedKey = resolveKey(key);
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error(DECRYPT_ERROR);
  }
  try {
    const iv = ciphertext.subarray(0, IV_LENGTH);
    const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const payload = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, resolvedKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(DECRYPT_ERROR);
  }
}
