import { submitGraphFeedback } from "@/lib/graph-service";
import { graphFeedbackSchema } from "@/lib/graph-schema";
import { memberFor, readInput, taskError } from "@/lib/task-http";

export async function POST(request: Request) {
  try {
    const actor = await memberFor(request, true);
    const input = await readInput(request, graphFeedbackSchema);
    return Response.json({ data: await submitGraphFeedback(input, actor) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return taskError(error); }
}
