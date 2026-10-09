export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.V3_GRAPH_ENABLED === "1") {
    const { startGraphAnalysis } = await import("./lib/graph-analysis-service");
    startGraphAnalysis();
  }
}
