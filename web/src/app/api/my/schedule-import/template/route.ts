import { createImportTemplate } from "@/lib/schedule-import-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!await getCurrentMember(request.headers)) return unauthorized();
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const body = await createImportTemplate(format);
  return new Response(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="schedule-import-template.${format}"`,
      "cache-control": "no-store",
    },
  });
}
