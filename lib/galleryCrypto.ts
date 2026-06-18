// Gallery share-file packing. Plaintext + SHA-256 integrity check.
// Uses only Web Crypto (`globalThis.crypto`) so it works in both
// Node 22+ and Cloudflare Workers.
//
// File layout (raw bytes):
//   0..3   "IFPL"          magic — lets us refuse anything that's not ours
//   4      version (=2)    v1 was AES-256-GCM encrypted (removed)
//   5..36  SHA-256 (32 B)  integrity hash of the plaintext
//   37..   plaintext       raw UTF-8 JSON

const MAGIC = [0x49, 0x46, 0x50, 0x4c] as const; // "IFPL"
const VERSION = 2;
const HASH_LEN = 32;
const HEADER_LEN = MAGIC.length + 1 + HASH_LEN; // 37

export async function packDoc(docStr: string): Promise<Uint8Array> {
  const plaintext = new TextEncoder().encode(docStr);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", plaintext),
  );

  const out = new Uint8Array(HEADER_LEN + plaintext.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = VERSION;
  out.set(hash, MAGIC.length + 1);
  out.set(plaintext, HEADER_LEN);
  return out;
}

export async function unpackDoc(blob: Uint8Array): Promise<string> {
  if (blob.length < HEADER_LEN) {
    throw new Error("文件太小,不是合法的分享文件");
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new Error("文件格式不对,不是合法的分享文件");
    }
  }
  const version = blob[MAGIC.length];
  if (version === 1) {
    throw new Error("此文件由旧版本加密导出,当前版本不再支持加密格式");
  }
  if (version !== VERSION) {
    throw new Error(`分享文件版本不被支持: v${version}`);
  }

  const storedHash = blob.slice(MAGIC.length + 1, HEADER_LEN);
  const plaintext = blob.slice(HEADER_LEN);
  const computedHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", plaintext),
  );

  if (storedHash.length !== computedHash.length ||
      !storedHash.every((b, i) => b === computedHash[i])) {
    throw new Error("文件校验失败:内容可能被改动过");
  }

  return new TextDecoder().decode(plaintext);
}
