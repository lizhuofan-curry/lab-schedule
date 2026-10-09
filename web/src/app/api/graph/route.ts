import { graphQuerySchema } from "@/lib/graph-schema";
import { getGraph } from "@/lib/graph-service";
import { memberFor, readQuery, taskError } from "@/lib/task-http";

export async function GET(request: Request) {
  try {
    const actor = await memberFor(request);
    const search = new URL(request.url).searchParams;
    const query = search.size ? readQuery(request, graphQuerySchema) : { scope: "all" as const };
    return Response.json({ data: await getGraph(query, actor) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { const response = taskError(error); response.headers.set("cache-control", "private, no-store"); return response; }
}
