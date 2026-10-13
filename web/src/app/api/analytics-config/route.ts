export const dynamic = "force-dynamic";

export function GET() {
  const id = process.env.UMAMI_WEBSITE_ID ?? "";
  const websiteId = process.env.ANALYTICS_ENABLED === "1" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  return Response.json({ websiteId }, { headers: { "Cache-Control": "no-store" } });
}
