import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/server-auth";
import { taskOptions } from "@/lib/task-service";
import { NewTaskView } from "../task-view";
export default async function NewTaskPage() {
  const person = await getCurrentMember();
  if (!person) redirect("/login?next=%2Ftasks%2Fnew");
  return <NewTaskView person={person} options={await taskOptions()} />;
}
