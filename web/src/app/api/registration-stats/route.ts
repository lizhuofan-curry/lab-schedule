import { getRegistrationOverview } from "@/lib/registration-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export async function GET(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();

  return Response.json(await getRegistrationOverview());
}
