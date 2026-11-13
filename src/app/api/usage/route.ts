// LLM cost and usage, from the call log (src/server/llmLog.ts).
// Open in development. In production it answers only with ?key=<USAGE_KEY>, and not at all without one.
import { connection } from "next/server";
import { usageSummary } from "@/server/llmLog";

export async function GET(request: Request) {
  // With Cache Components a GET handler that reads no request data is prerendered at build time,
  // which would freeze both the key check and the numbers. This makes it run on every request.
  await connection();
  const key = process.env.USAGE_KEY;
  if (process.env.NODE_ENV === "production" && (!key || new URL(request.url).searchParams.get("key") !== key)) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json(usageSummary());
}
