import { getMemberDirectory } from "@/lib/schedule-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export async function GET(request: Request) {
  const currentMember = await getCurrentMember(request.headers);
  if (!currentMember) return unauthorized();
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 80) ?? "";
  const data = await getMemberDirectory(query);
  return Response.json({ data });
}
