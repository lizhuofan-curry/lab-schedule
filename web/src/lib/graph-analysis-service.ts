import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { graphAnalysisState as state, students, users, groups, graphRelationFeedback } from "@/db/schema";
import { backgroundGraphSnapshot, graphEnabled, graphVersion } from "./graph-service";
import { validateRelations } from "./graph-relations";
import { extractGraphRelations, redactGraphText } from "./graph-model";
import type { GraphRelation } from "./graph-schema";
import type { GraphData, GraphSnapshot } from "./graph-rules";

export function graphAnalysisEnabled() { return graphEnabled() && process.env.V3_ANALYSIS_ENABLED === "1"; }
export async function modelRedactor() {
  const rows = await db.select({ name: students.name, enabled: students.enabled, studentNo: students.studentNo, userId: students.userId, email: users.email, username: users.username }).from(students).leftJoin(users, eq(users.id, students.userId)).orderBy(asc(students.id));
  const ordered = [...rows.filter(r => r.enabled && r.userId), ...rows.filter(r => !r.enabled || !r.userId)];
  const identities = ordered.map((r) => ({ name: r.name, identifiers: [r.studentNo, r.userId, r.email, r.username].filter((v): v is string => !!v) }));
  const groupRows = await db.select({ name: groups.name }).from(groups).orderBy(asc(groups.id));
  const replacements = groupRows.map((g, i) => ({ name: g.name, code: `G${i + 1}` })).sort((a, b) => b.name.length - a.name.length);
  const credentials = [process.env.DEEPSEEK_API_KEY, process.env.TYPESAFE_API_KEY, process.env.DASHSCOPE_API_KEY, process.env.DATABASE_URL, process.env.BETTER_AUTH_SECRET].filter((v): v is string => !!v);
  return (text: string) => redactGraphText(replacements.reduce((value, g) => g.name ? value.split(g.name).join(g.code) : value, text), identities, credentials);
}
export async function readGraphAnalysis(version: string, snapshot?: GraphSnapshot): Promise<{ relations: GraphRelation[]; info: GraphData["analysis"] }> {
  const info: GraphData["analysis"] = { status: "disabled", analyzedAt: null, model: "deepseek-flash", message: "内容关联分析尚未启用；当前展示真实关系。" };
  if (!graphAnalysisEnabled()) return { relations: [], info };
  if (!process.env.DEEPSEEK_API_KEY) return { relations: [], info: { ...info, message: "内容关联分析尚未配置密钥；当前展示真实关系。" } };
  const [row] = await db.select().from(state).where(eq(state.id, 1));
  if (!row || row.inputVersion !== version) return { relations: [], info: { ...info, status: "pending", message: "工作数据已变化，内容关联等待自动分析；当前展示真实关系。" } };
  const ready = row.status === "ready";
  let relations: GraphRelation[] = [];
  if (ready) {
    const current = snapshot ?? await backgroundGraphSnapshot();
    if (graphVersion(current) !== version) return { relations, info: { ...info, status: "pending", message: "数据已变化，等待自动分析。" } };
    try { relations = validateRelations(row.relations, current, await modelRedactor()); }
    catch { return { relations: [], info: { ...info, status: "failed", message: "内容关联依据校验失败，请联系维护者；真实关系仍可用。" } }; }
  }
  return { relations, info: { status: ready ? "ready" : row.status === "failed" ? "failed" : "pending", analyzedAt: row.analyzedAt?.toISOString() ?? null, model: row.model,
    message: ready ? "内容关联由DeepSeek分析，请点击虚线核对理由及来源。" : row.status === "failed" ? row.attempts >= 5 ? "内容关联连续失败，已停止本版本重试，请联系维护者核对配置；修改来源后会重新分析。" : "内容关联分析暂未成功，将按退避策略自动重试；真实关系仍可用。" : "内容关联正在自动分析；通常2分钟内更新。" } };
}

export async function runGraphAnalysisOnce() {
  if (!graphEnabled()) return;
  const snapshot = await backgroundGraphSnapshot(), version = graphVersion(snapshot), now = new Date();
  // User-entered feedback may quote a source. Once its version expires keep only
  // metadata and a tombstone, never a readable historical copy of the comment.
  const tombstone = "关联版本已失效，反馈文字已清除。";
  await db.update(graphRelationFeedback).set({ reason: tombstone }).where(and(ne(graphRelationFeedback.inputVersion, version), ne(graphRelationFeedback.reason, tombstone)));
  if (!graphAnalysisEnabled() || !process.env.DEEPSEEK_API_KEY) {
    await db.update(state).set({ inputVersion: version, status: "pending", relations: [], themes: [], analyzedAt: null, attempts: 0, leaseToken: null, leaseUntil: null, retryAt: now }).where(ne(state.inputVersion, version));
    return;
  }
  await db.insert(state).values({ id: 1, inputVersion: version, status: "pending", model: "deepseek-flash", retryAt: new Date(now.getTime() + 5000) }).onConflictDoNothing();
  const token = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(state).where(eq(state.id, 1)).for("update");
    if (row.inputVersion !== version) {
      await tx.update(state).set({ inputVersion: version, status: "pending", relations: [], themes: [], analyzedAt: null, attempts: 0, retryAt: new Date(now.getTime() + 5000), leaseToken: null, leaseUntil: null }).where(eq(state.id, 1));
      return false;
    }
    if (row.attempts >= 5 || row.status === "ready" || row.retryAt > now || row.status === "running" && row.leaseUntil && row.leaseUntil > now) return false;
    await tx.update(state).set({ status: "running", attempts: row.attempts + 1, leaseToken: token, leaseUntil: new Date(now.getTime() + 120000) }).where(eq(state.id, 1));
    return true;
  });
  if (!claim) return;
  try {
    const result = await extractGraphRelations(snapshot, await modelRedactor(), {
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
        await tx.update(state).set({ ...common, inputVersion: currentVersion, status: "pending", relations: [], themes: [], analyzedAt: null, attempts: 0, retryAt: new Date(Date.now() + 5000) }).where(eq(state.id, 1));
      } else {
        await tx.update(state).set({ ...common, status: "ready", themes: [], relations: result.relations, model: result.model, analyzedAt: new Date(), attempts: 0 }).where(eq(state.id, 1));
      }
    });
  } catch {
    // Never log input text, raw model output, keys, or network errors containing them.
    const [row] = await db.select({ attempts: state.attempts }).from(state).where(and(eq(state.id, 1), eq(state.leaseToken, token)));
    if (row) await db.update(state).set({ status: "failed", relations: [], leaseToken: null, leaseUntil: null, retryAt: new Date(Date.now() + (row.attempts === 1 ? 30000 : row.attempts === 2 ? 120000 : 3600000)) }).where(and(eq(state.id, 1), eq(state.leaseToken, token)));
  }
}

const globals = globalThis as unknown as { graphAnalysisStarted?: boolean };
export function startGraphAnalysis() {
  if (!graphEnabled() || globals.graphAnalysisStarted) return;
  globals.graphAnalysisStarted = true;
  // One loop per runtime, plus database leases for multiple runtime processes.
  async function tick() {
    try { await runGraphAnalysisOnce(); } catch { /* retry next observation without disclosing private data */ }
    setTimeout(tick, 15000).unref();
  }
  setTimeout(tick, 15000).unref();
}
