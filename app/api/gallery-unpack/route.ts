import { unpackDoc } from "@/lib/galleryCrypto";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 13_000_000;

export async function POST(req: Request): Promise<Response> {
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
    const docStr = await unpackDoc(new Uint8Array(ab));
    return Response.json({ docStr });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "解包失败" },
      { status: 400 },
    );
  }
}
