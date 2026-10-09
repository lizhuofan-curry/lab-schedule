import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { graphAnalysisState as state, students, users } from "@/db/schema";
import { backgroundGraphSnapshot, graphEnabled, graphVersion } from "./graph-service";
import { graphSources } from "./graph-rules";
import { extractGraphThemes, redactGraphText } from "./graph-model";
import type { GraphTheme } from "./graph-schema";
import type { GraphData } from "./graph-rules";

export function graphAnalysisEnabled() { return graphEnabled() && process.env.V3_ANALYSIS_ENABLED === "1"; }
export async function modelRedactor() {
  const rows = await db.select({ name: students.name, studentNo: students.studentNo, userId: students.userId, email: users.email, username: users.username }).from(students).leftJoin(users, eq(users.id, students.userId));
  const identities = rows.map((r) => ({ name: r.name, identifiers: [r.studentNo, r.userId, r.email, r.username].filter((v): v is string => !!v) }));
  const credentials = [process.env.DEEPSEEK_API_KEY, process.env.TYPESAFE_API_KEY, process.env.DASHSCOPE_API_KEY, process.env.DATABASE_URL, process.env.BETTER_AUTH_SECRET].filter((v): v is string => !!v);
  return (text: string) => redactGraphText(text, identities, credentials);
}
export async function readGraphAnalysis(version: string): Promise<{ themes: GraphTheme[]; info: GraphData["analysis"] }> {
  const info: GraphData["analysis"] = { status: "disabled", analyzedAt: null, model: "deepseek-flash", message: "主题分析尚未启用；当前展示真实关系。" };
  if (!graphAnalysisEnabled()) return { themes: [], info };
  if (!process.env.DEEPSEEK_API_KEY) return { themes: [], info: { ...info, message: "主题分析尚未配置密钥；当前展示真实关系。" } };
  const [row] = await db.select().from(state).where(eq(state.id, 1));
  if (!row || row.inputVersion !== version) return { themes: [], info: { ...info, status: "pending", message: "工作数据已变化，主题等待自动分析；当前展示真实关系。" } };
  const ready = row.status === "ready";
  return { themes: ready ? row.themes : [], info: { status: ready ? "ready" : row.status === "failed" ? "failed" : "pending", analyzedAt: row.analyzedAt?.toISOString() ?? null, model: row.model,
    message: ready ? "主题由模型提炼，请点击关联来源核对。" : row.status === "failed" ? "主题分析暂未成功，将按退避策略自动重试；真实关系仍可用。" : "主题正在自动分析；当前展示真实关系。" } };
}

export async function runGraphAnalysisOnce() {
  if (!graphAnalysisEnabled() || !process.env.DEEPSEEK_API_KEY) return;
  const snapshot = await backgroundGraphSnapshot(), version = graphVersion(snapshot), now = new Date();
  await db.insert(state).values({ id: 1, inputVersion: version, status: "pending", model: "deepseek-flash", retryAt: new Date(now.getTime() + 5000) }).onConflictDoNothing();
  const token = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(state).where(eq(state.id, 1)).for("update");
    if (row.inputVersion !== version) {
      await tx.update(state).set({ inputVersion: version, status: "pending", themes: [], analyzedAt: null, attempts: 0, retryAt: new Date(now.getTime() + 5000), leaseToken: null, leaseUntil: null }).where(eq(state.id, 1));
      return false;
    }
    if (row.status === "ready" || row.retryAt > now || row.status === "running" && row.leaseUntil && row.leaseUntil > now) return false;
    await tx.update(state).set({ status: "running", attempts: row.attempts + 1, leaseToken: token, leaseUntil: new Date(now.getTime() + 120000) }).where(eq(state.id, 1));
    return true;
  });
  if (!claim) return;
  try {
    const result = await extractGraphThemes(graphSources(snapshot, { scope: "all" }), await modelRedactor(), {
      beforeBatch: async () => {
        if (!graphAnalysisEnabled() || graphVersion(await backgroundGraphSnapshot()) !== version) throw new Error("Input changed");
        const renewed = await db.update(state).set({ leaseUntil: new Date(Date.now() + 120000) }).where(and(eq(state.id, 1), eq(state.leaseToken, token))).returning({ id: state.id });
        if (!renewed.length) throw new Error("Lease changed");
      },
      usage: async (usage) => { await db.update(state).set({ calls: sql`${state.calls} + 1`, inputTokens: sql`${state.inputTokens} + ${usage.input}`, outputTokens: sql`${state.outputTokens} + ${usage.output}` }).where(eq(state.id, 1)); },
    });
    const currentVersion = graphVersion(await backgroundGraphSnapshot());
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(state).where(eq(state.id, 1)).for("update");
      // A late completion must never overwrite another claim or a new input version.
      if (row.leaseToken !== token || row.inputVersion !== version) return;
      const common = { leaseToken: null, leaseUntil: null };
      if (currentVersion !== version) {
        await tx.update(state).set({ ...common, inputVersion: currentVersion, status: "pending", themes: [], analyzedAt: null, attempts: 0, retryAt: new Date(Date.now() + 5000) }).where(eq(state.id, 1));
      } else {
        await tx.update(state).set({ ...common, status: "ready", themes: result.themes, model: result.model, analyzedAt: new Date(), attempts: 0 }).where(eq(state.id, 1));
      }
    });
  } catch {
    // Never log input text, raw model output, keys, or network errors containing them.
    const [row] = await db.select({ attempts: state.attempts }).from(state).where(and(eq(state.id, 1), eq(state.leaseToken, token)));
    if (row) await db.update(state).set({ status: "failed", themes: [], leaseToken: null, leaseUntil: null, retryAt: new Date(Date.now() + (row.attempts === 1 ? 30000 : row.attempts === 2 ? 120000 : 3600000)) }).where(and(eq(state.id, 1), eq(state.leaseToken, token)));
  }
}

const globals = globalThis as unknown as { graphAnalysisStarted?: boolean };
export function startGraphAnalysis() {
  if (!graphAnalysisEnabled() || globals.graphAnalysisStarted) return;
  globals.graphAnalysisStarted = true;
  // One loop per runtime, plus database leases for multiple runtime processes.
  async function tick() {
    try { await runGraphAnalysisOnce(); } catch { /* retry next observation without disclosing private data */ }
    setTimeout(tick, 15000).unref();
  }
  setTimeout(tick, 15000).unref();
}
