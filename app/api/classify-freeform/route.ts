import { classifyFreeform } from "@infiplot/engine";
import type { FreeformClassifyRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let body: FreeformClassifyRequest;
  try {
    body = (await req.json()) as FreeformClassifyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session || !body.freeformText?.trim()) {
    return NextResponse.json(
      { error: "session and freeformText are required" },
      { status: 400 },
    );
  }

  try {
    const config = loadEngineConfig();
    const result = await classifyFreeform(config, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
