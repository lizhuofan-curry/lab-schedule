import { redirect } from "next/navigation";
import { getCurrentViewer } from "@/lib/server-auth";
import { listTasks } from "@/lib/task-service";
import { TaskListView, type ListItem } from "./task-view";
export default async function TasksPage() {
  const viewer = await getCurrentViewer();
  if (!viewer) redirect("/login?next=%2Ftasks");
  const guest = viewer.kind === "guest";
  return (
    <TaskListView
      initial={
        JSON.parse(
          JSON.stringify(await listTasks(guest, viewer.member?.studentId)),
        ) as ListItem[]
      }
      guest={guest}
      person={
        guest
          ? { name: "游客", studentNo: "只读访问", studentId: 0 }
          : viewer.member
      }
    />
  );
}
