import { notFound, redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/server-auth";
import { TaskError, taskDetail, taskOptions } from "@/lib/task-service";
import { TaskDetailView, type Detail } from "../task-view";
export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const person = await getCurrentMember();
  if (!person) redirect("/login");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const data = await taskDetail(id).catch((e) => {
    if (e instanceof TaskError && e.status === 404) notFound();
    throw e;
  });
  const options = await taskOptions();
  return (
    <TaskDetailView
      initial={JSON.parse(JSON.stringify(data)) as Detail}
      options={options}
      person={person}
    />
  );
}
