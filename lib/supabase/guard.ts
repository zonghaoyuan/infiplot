import { NextResponse } from "next/server";
import { AUTH_ENABLED } from "./config";
import { createClient } from "./server";

export async function requireUser(): Promise<
  { userId: string } | NextResponse
> {
  if (!AUTH_ENABLED) return { userId: "anonymous" };
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  if (claims.error || !claims.data?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { userId: claims.data.claims.sub };
}
