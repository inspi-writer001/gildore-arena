import crypto from "node:crypto";
import { decodeBase64, encodeBase64 } from "../base64";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const DERIVATION_ITERATIONS = 100_000;
const SALT_LENGTH = 16;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function deriveKey(password: string, salt: Uint8Array) {
  return crypto.pbkdf2Sync(
    password,
    salt,
    DERIVATION_ITERATIONS,
    KEY_LENGTH,
    "sha256",
  );
}

function decryptMasterSecret() {
  const password = getRequiredEnv("AGENT_WALLET_MASTER_PASSWORD");
  const encryptedMaster = decodeBase64(
    getRequiredEnv("AGENT_WALLET_MASTER_ENCRYPTED"),
  );
  const salt = decodeBase64(getRequiredEnv("AGENT_WALLET_MASTER_SALT"));

  const iv = encryptedMaster.slice(0, IV_LENGTH);
  const authTag = encryptedMaster.slice(
    encryptedMaster.length - 16,
    encryptedMaster.length,
  );
  const ciphertext = encryptedMaster.slice(IV_LENGTH, encryptedMaster.length - 16);
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(authTag));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext)),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function encryptExecutionWalletSecret(secret: Uint8Array) {
  const masterSecret = decryptMasterSecret();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterSecret, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(secret)),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, ciphertext, authTag]);

  return {
    encryptedPrivateKey: encodeBase64(Uint8Array.from(payload)),
    encryptionSalt: encodeBase64(Uint8Array.from(salt)),
  };
}

export function decryptExecutionWalletSecret(args: {
  encryptedPrivateKey: string;
  encryptionSalt: string;
}) {
  const masterSecret = decryptMasterSecret();
  const salt = decodeBase64(args.encryptionSalt);
  const payload = decodeBase64(args.encryptedPrivateKey);
  const iv = payload.slice(0, IV_LENGTH);
  const authTag = payload.slice(payload.length - 16, payload.length);
  const ciphertext = payload.slice(IV_LENGTH, payload.length - 16);
  const key = deriveKey(masterSecret, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(authTag));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext)),
    decipher.final(),
  ]);
  return Uint8Array.from(decrypted);
}
