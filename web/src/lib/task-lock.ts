import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/db";
export type TaskTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Shared graph lock is acquired before task/group locks: no reverse lock ordering.
export async function lockTaskGraph(tx: TaskTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(20261008, 2)`);
}
