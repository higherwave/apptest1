// Encrypts a small secret (a token) before it is stored, with AES-256-GCM. The key is SETTINGS_ENCRYPTION_KEY: 32 random bytes, base64.
// Generate one with: openssl rand -base64 32. A sealed value reads "v1.<iv>.<tag>.<ciphertext>" (base64url). Plain node crypto, so the
// server and the command-line tools use the same code.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyOf(env) {
  const raw = (env.SETTINGS_ENCRYPTION_KEY ?? '').trim();
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32).');
  return key;
}

export function sealSecret(env, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(env), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** The secret, or null when the key is missing or wrong or the value was changed (a stored value is never trusted blindly). */
export function openSecret(env, sealed) {
  try {
    const [v, iv, tag, body] = String(sealed ?? '').split('.');
    if (v !== 'v1' || !iv || !tag || !body) return null;
    const d = createDecipheriv('aes-256-gcm', keyOf(env), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
