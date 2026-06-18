import { packDoc } from "@/lib/galleryCrypto";

export const runtime = "nodejs";

const MAX_DOC_BYTES = 5_000_000;

export async function POST(req: Request): Promise<Response> {
  let docStr: string;
  try {
    const body = (await req.json()) as { docStr?: unknown };
    if (typeof body.docStr !== "string") {
      return Response.json({ error: "Missing docStr" }, { status: 400 });
    }
    docStr = body.docStr;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }

  if (new TextEncoder().encode(docStr).byteLength > MAX_DOC_BYTES) {
    return Response.json(
      { error: "图集数据太大,无法打包分享" },
      { status: 413 },
    );
  }

  const bytes = await packDoc(docStr);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Response(ab, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
