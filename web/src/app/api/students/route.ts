import { getMemberDirectory } from "@/lib/schedule-service";
import { getCurrentViewer, maskStudentNo, unauthorized } from "@/lib/server-auth";

export async function GET(request: Request) {
  const viewer = await getCurrentViewer(request.headers);
  if (!viewer) return unauthorized();
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 80) ?? "";
  const data = await getMemberDirectory(query);
  return Response.json({ data: viewer.kind === "guest" ? data.map((member) => ({ ...member, studentNo: maskStudentNo(member.studentNo) })) : data });
}
