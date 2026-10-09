import { memberFor, readInput, taskError } from "@/lib/task-http";
import { workCreateSchema } from "@/lib/work-schema";
import { createWork } from "@/lib/work-service";
export async function POST(request: Request) {
  try {
    const actor = await memberFor(request, true);
    return Response.json(
      {
        data: await createWork(
          await readInput(request, workCreateSchema),
          actor,
        ),
      },
      { status: 201 },
    );
  } catch (e) {
    return taskError(e);
  }
}
