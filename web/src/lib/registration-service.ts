import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { students } from "@/db/schema";
import { summarizeRegistration, type RegistrationOverview } from "@/lib/registration-summary";

export type { RegistrationOverview } from "@/lib/registration-summary";

export async function getRegistrationOverview(): Promise<RegistrationOverview> {
  const rows = await db.select({
    id: students.id,
    name: students.name,
    studentNo: students.studentNo,
    userId: students.userId,
  })
    .from(students)
    .where(eq(students.enabled, true))
    .orderBy(asc(students.name), asc(students.id));

  return summarizeRegistration(rows);
}
