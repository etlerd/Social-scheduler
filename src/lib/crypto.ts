import crypto from "node:crypto";
import { config } from "./config";

function key(purpose: string): Buffer {
  if (config.secretKey.length < 32) throw new Error("SECRET_KEY must be at least 32 characters");
  return crypto.createHash("sha256").update(`${purpose}:${config.secretKey}`).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key("enc"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string): string {
  if (!blob.startsWith("v1:")) throw new Error("Unknown ciphertext format");
  const raw = Buffer.from(blob.slice(3), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key("enc"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  return crypto.createHmac("sha256", key("sig")).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function randomId(bytes = 12): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
