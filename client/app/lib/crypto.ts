// End-to-end encryption utilities using the Web Crypto API.
// Static ECDH (P-256) key exchange + AES-256-GCM message encryption.
// Password-derived key wrapping (PBKDF2 + AES-KW) for private key backup.

const ECDH_CURVE = { name: "ECDH", namedCurve: "P-256" };
const PBKDF2_ITERATIONS = 600_000;

// --- Helpers ---

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Key Generation ---

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH_CURVE, true, ["deriveKey"]);
}

// --- Public Key Import/Export ---

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}

export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey("raw", raw, ECDH_CURVE, true, []);
}

// --- Password-Derived Key Wrapping (PBKDF2 + AES-KW) ---

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveWrappingKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function wrapPrivateKey(privateKey: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey("pkcs8", privateKey, wrappingKey, "AES-KW");
  return arrayBufferToBase64(wrapped);
}

export async function unwrapPrivateKey(wrappedBase64: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const wrapped = base64ToArrayBuffer(wrappedBase64);
  return crypto.subtle.unwrapKey(
    "pkcs8",
    wrapped,
    wrappingKey,
    "AES-KW",
    ECDH_CURVE,
    false,
    ["deriveKey"],
  );
}

// --- ECDH Shared Secret Derivation ---

export async function deriveSharedSecret(myPrivateKey: CryptoKey, theirPublicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// --- AES-GCM Encrypt/Decrypt ---

export async function encrypt(sharedKey: CryptoKey, plaintext: string): Promise<{ iv: string; ciphertext: string }> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    encoder.encode(plaintext),
  );
  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(encrypted),
  };
}

export async function decrypt(sharedKey: CryptoKey, iv: string, ciphertext: string): Promise<string> {
  const decoder = new TextDecoder();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
    sharedKey,
    base64ToArrayBuffer(ciphertext),
  );
  return decoder.decode(decrypted);
}
