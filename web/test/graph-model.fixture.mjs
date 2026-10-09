// Explicit browser-only fake provider. It can never run against another database/key.
if (!/^\/schedule_v3_browser_\d+$/.test(new URL(process.env.DATABASE_URL).pathname) || process.env.DEEPSEEK_API_KEY !== "synthetic-browser-key") throw Error("Unsafe browser fixture environment");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) !== "https://api.deepseek.com/chat/completions") return originalFetch(url, options);
  const body = JSON.parse(String(options.body));
  const sources = JSON.parse(body.messages[1].content).untrustedContext.sources;
  const work = sources.find(s => s.id.startsWith("work:") && s.text.includes("CSP"));
  const task = sources.find(s => s.id.startsWith("round:") && s.text.includes("CSP"));
  const relations = work && task ? [{ from: work.id, to: task.id, type: "method", reason: "两项均明确使用CSP方法", fromEvidence: "CSP", toEvidence: "CSP" }] : [];
  return Response.json({ model: "synthetic-provider-fixture", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ relations }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
};
