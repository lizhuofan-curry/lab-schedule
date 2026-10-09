import { getGraphSource } from "@/lib/graph-service";
import { memberFor, taskError } from "@/lib/task-http";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const actor = await memberFor(request);
    const { key } = await context.params;
    return Response.json({ data: await getGraphSource(key, actor) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { const response = taskError(error); response.headers.set("cache-control", "private, no-store"); return response; }
}
