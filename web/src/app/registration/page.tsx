import { redirect } from "next/navigation";
import { getRegistrationOverview } from "@/lib/registration-service";
import { getCurrentMember } from "@/lib/server-auth";
import { RegistrationView } from "./registration-view";

export const dynamic = "force-dynamic";

export default async function RegistrationPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=/registration");

  const overview = await getRegistrationOverview();
  return <RegistrationView overview={overview} currentUser={{ name: member.name, studentNo: member.studentNo }} />;
}
