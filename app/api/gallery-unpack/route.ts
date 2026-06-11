import { unpackDoc } from "@/lib/galleryCrypto";

export const runtime = "nodejs";

// Cap a bit above pack's MAX_DOC_BYTES — ciphertext adds the 16-byte GCM tag
// and the 17-byte header; some slack accommodates near-cap docs without
// rejecting them at unpack time. Bumped to fit pre-baked beat audio.
const MAX_FILE_BYTES = 13_000_000;

// Decrypt a `.infiplot` share file back to its doc JSON string. Returns the
// plaintext as a JSON field (not raw bytes) so the client can chain it through
// JSON.parse without sniffing the response type. Errors are deliberately
// generic — we don't distinguish "wrong key" from "tampered file" because the
// distinction would leak server config.
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.GALLERY_SECRET;
  if (!secret) {
    return Response.json(
      { error: "图集分享未启用 (GALLERY_SECRET 未配置)" },
      { status: 503 },
    );
  }

  let ab: ArrayBuffer;
  try {
    ab = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Bad request body" }, { status: 400 });
  }
  if (ab.byteLength > MAX_FILE_BYTES) {
    return Response.json({ error: "文件太大" }, { status: 413 });
  }
  if (ab.byteLength === 0) {
    return Response.json({ error: "文件为空" }, { status: 400 });
  }

  try {
    const docStr = await unpackDoc(new Uint8Array(ab), secret);
    return Response.json({ docStr });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "解包失败" },
      { status: 400 },
    );
  }
}
