import { checkProviderHealth } from "@/lib/ai/provider-health";

export async function GET(): Promise<Response> {
  const report = await checkProviderHealth();

  return Response.json(report, {
    status: report.status === "dead" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
