/**
 * Server-side encryption for sensitive per-user secrets (e.g. model provider
 * API keys) using AES-256-GCM via the Web Crypto API (available on the
 * Cloudflare Workers runtime).
 *
 * Passwords are NOT handled here — they are managed by Supabase Auth, which
 * hashes them with bcrypt and never stores plaintext. We only ever encrypt
 * values we must be able to read back (like an API key we forward to a
 * provider on the user's behalf).
 *
 * The master key comes from the `API_KEY_ENCRYPTION_KEY` environment secret:
 * a base64-encoded 32-byte (256-bit) random key. Generate one with:
 *   openssl rand -base64 32
 * then set it as a Cloudflare Pages secret. Without it, encryption is disabled.
 */

const ALGO = 'AES-GCM';
const IV_BYTES = 12;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

async function importKey(masterKeyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(masterKeyB64);

  if (raw.length !== 32) {
    throw new Error('API_KEY_ENCRYPTION_KEY must decode to 32 bytes (base64 of `openssl rand -base64 32`).');
  }

  return crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypts a plaintext string. Returns a single self-describing token of the
 * form `<ivBase64>:<cipherBase64>` so it can be stored in one column.
 */
export async function encryptSecret(plaintext: string, masterKeyB64: string): Promise<string> {
  const key = await importKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);

  return `${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

/** Decrypts a token produced by {@link encryptSecret}. */
export async function decryptSecret(token: string, masterKeyB64: string): Promise<string> {
  const [ivB64, cipherB64] = token.split(':');

  if (!ivB64 || !cipherB64) {
    throw new Error('Malformed encrypted secret token.');
  }

  const key = await importKey(masterKeyB64);
  const iv = base64ToBytes(ivB64);
  const cipher = base64ToBytes(cipherB64);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv }, key, cipher);

  return new TextDecoder().decode(plain);
}
