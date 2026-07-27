/**
 * Crypto — AES-256-GCM decryption for user API keys.
 *
 * Mirrors app/lib/auth/crypto.server.ts so the worker can decrypt keys
 * stored by the CF Pages app using the SAME API_KEY_ENCRYPTION_KEY master
 * secret. We only need DECRYPT here (the CF Pages app handles encrypt on
 * store). The format is `<ivBase64>:<cipherBase64>`.
 */

const ALGO = 'AES-GCM';
const IV_BYTES = 12;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(masterKeyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(masterKeyB64);
  if (raw.length !== 32) {
    throw new Error('API_KEY_ENCRYPTION_KEY must decode to 32 bytes (base64 of `openssl rand -base64 32`).');
  }
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: ALGO }, false, ['decrypt']);
}

/**
 * Decrypts a token produced by encryptSecret() in the CF Pages app.
 * Token format: `<ivBase64>:<cipherBase64>`
 */
export async function decryptSecret(token: string, masterKeyB64: string): Promise<string> {
  const [ivB64, cipherB64] = token.split(':');
  if (!ivB64 || !cipherB64) {
    throw new Error('Malformed encrypted secret token.');
  }
  const key = await importKey(masterKeyB64);
  const iv = base64ToBytes(ivB64);
  const cipher = base64ToBytes(cipherB64);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv: iv.buffer as ArrayBuffer }, key, cipher.buffer as ArrayBuffer);
  return new TextDecoder().decode(plain);
}
