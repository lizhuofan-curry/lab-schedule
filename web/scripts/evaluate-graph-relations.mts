import { loadEnvFile } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GraphSnapshot } from "../src/lib/graph-rules.ts";
loadEnvFile(".env");
const { extractGraphRelations } = await import("../src/lib/graph-model.ts");
const output = "test-results/v3.1/development/model-evaluation";
await mkdir(output, { recursive: true });
const topics = [
  ["CSP脑电分类", "使用CSP提取运动想象脑电特征并训练分类器", "比较CSP运动想象脑电分类器在不同受试者上的表现"],
  ["EEGNet", "训练EEGNet识别运动想象脑电，记录各受试者准确率", "复现EEGNet运动想象识别并比较跨受试者结果"],
  ["视觉重建", "训练CLIP编码器对齐脑电与图像特征", "评估CLIP脑电图像特征对齐质量"],
  ["数据清洗", "标注并删除眼电伪迹，生成清洁脑电训练集", "需要上一项清洁脑电训练集作为模型训练输入"],
  ["基线校正", "实现诱发电位基线校正并比较校正前后的波形", "验证诱发电位基线校正结果是否稳定"],
  ["日志汇总", "解析训练日志并生成按受试者划分的准确率表", "读取准确率表制作受试者结果对比图"],
  ["课表接口", "修复课表导入接口的周次解析并添加单双周测试", "为同一课表导入接口编写单双周回归测试"],
  ["机器人控制", "实现机器人关节轨迹规划并验证速度限制", "测试机器人关节轨迹规划的速度限制"],
  ["睡眠分期", "使用多导睡眠脑电训练睡眠分期模型", "在多导睡眠脑电上评估睡眠分期模型"],
  ["注意力模型", "对比Transformer注意力头数对脑电分类的影响", "复现Transformer脑电分类并调整注意力头数"],
  ["SSVEP频谱", "计算SSVEP稳态视觉诱发脑电的频谱峰值", "验证SSVEP稳态视觉诱发脑电频谱峰值是否稳定"],
  ["在线解码", "实现在线运动想象脑电解码并记录端到端延迟", "测量在线运动想象脑电解码的端到端延迟"],
];
const unrelated = [
  ["脑电CSP分类", "使用CSP对运动想象脑电分类", "植物浇水", "为温室番茄调整浇水时间"],
  ["EEGNet训练", "复现EEGNet运动想象识别", "古诗校对", "核对唐诗标点和异体字"],
  ["睡眠分期", "标注睡眠脑电各阶段", "自行车修理", "更换自行车刹车线"],
  ["视觉特征对齐", "对齐脑电和图像的CLIP表示", "发票整理", "按月份归档餐饮发票"],
  ["关节轨迹", "验证机械臂关节速度约束", "书法练习", "练习楷书横竖笔画"],
  ["课表周次", "解析课程单双周数组", "陶瓷烧制", "调整陶瓷窑的烧制温度"],
  ["脑电伪迹", "清除眼电污染的脑电片段", "建筑测绘", "测量古建筑立面尺寸"],
  ["日志解析", "从训练日志读取分类准确率", "音乐排练", "排练合唱作品的节奏"],
  ["诱发电位", "对诱发电位进行基线校正", "食谱制作", "编写面包发酵配方"],
  ["注意力头数", "评估Transformer脑电分类头数", "渔业调查", "统计湖泊鱼类种群数量"],
];
const samples = [
  ...topics.flatMap(([topic, left, right], i) => [0, 1, 2].map(n => ({ id: `P${i * 3 + n + 1}`, positive: true, titleA: `${topic}实验${n + 1}`, textA: left, titleB: `${topic}验证${n + 1}`, textB: right }))),
  ...unrelated.map(([titleA, textA, titleB, textB], i) => ({ id: `N${i + 1}`, positive: false, titleA, textA, titleB, textB })),
];
const supplement = process.argv.includes("--supplement");
const renderOnly = process.argv.includes("--render-only");
const chosen = renderOnly ? [] : process.argv.includes("--smoke") ? [samples[0], samples.find(s => !s.positive)!] : supplement ? samples.filter(s => s.positive && Number(s.id.slice(1)) > 30) : samples;
type Result = (typeof samples)[number] & { result?: Awaited<ReturnType<typeof extractGraphRelations>>; error?: string; elapsedMs: number; humanVerdict: null };
const results: Result[] = supplement || renderOnly ? JSON.parse(await readFile(`${output}/results.json`, "utf-8")).results : [];
// Every input here is an explicit synthetic fixture; no database read is performed.
for (const sample of chosen) {
  const snapshot: GraphSnapshot = {
    members: [{ id: 1, name: "M01" }, { id: 2, name: "M02" }], groups: [{ id: 1, name: "G1" }], memberships: [{ groupId: 1, studentId: 1 }, { groupId: 1, studentId: 2 }],
    work: [{ id: 1, studentId: 1, title: sample.titleA, description: sample.textA, status: "paused", revision: 1, updatedAt: "2026-10-09", completedAt: null }],
    tasks: [{ id: 1, publisherId: 2, kind: "assigned", status: "active", currentRound: 1, revision: 1 }],
    rounds: [{ id: 1, taskId: 1, number: 1, title: sample.titleB, description: sample.textB, directIds: [1], groupIds: [], deadline: null, endedAt: null, outcome: null }], participants: [],
    courses: [1, 2].map(studentId => ({ id: studentId, studentId, semesterId: 1, name: "测试信号处理", location: "测试楼101", weekday: 2, startPeriod: 1, endPeriod: 2, weeks: [1, 3] })),
  };
  const started = Date.now();
  try {
    const result = await extractGraphRelations(snapshot, text => text);
    results.push({ ...sample, result, elapsedMs: Date.now() - started, humanVerdict: null });
  } catch (error) { const failureKind = error instanceof Error ? error.name + (error.message === "Invalid relation evidence" ? ": evidence" : error.message === "Unsupported upstream dependency" ? ": upstream" : "") : "unknown"; results.push({ ...sample, error: `模型请求或结果校验未通过（${failureKind}），请查看配置和平台状态后重试。`, elapsedMs: Date.now() - started, humanVerdict: null }); }
  await writeFile(`${output}/${chosen.length === 2 ? "smoke" : "results"}.json`, JSON.stringify({ source: "synthetic fixtures; live DeepSeek; human review pending", results }, null, 2));
  console.log(`${sample.id}: ${results.at(-1)!.error ? "failed" : `${results.at(-1)!.result!.relations.length} relations`} ${Date.now() - started}ms`);
  if (!supplement && results.length === 1 && results[0].error) break;
}
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const candidates = results.filter(r => r.positive && r.result?.relations.length).slice(0,30);
const reviewRows = [...candidates, ...results.filter(r => !r.positive)];
const payload = JSON.stringify(reviewRows).replace(/</g, "\\u003c");
const cards = reviewRows.map(r => `<article><h2>${r.id} · ${r.positive ? "预期有内容联系" : "预期无内容联系"}</h2><p><b>工作：</b>${escape(r.titleA)} — ${escape(r.textA)}</p><p><b>任务：</b>${escape(r.titleB)} — ${escape(r.textB)}</p>${r.error ? `<p>${escape(r.error)}</p>` : r.result!.relations.map(edge => `<p><b>${escape(edge.type)}：</b>${escape(edge.reason)}</p><blockquote>${escape(edge.fromEvidence)} ／ ${escape(edge.toEvidence)}</blockquote>`).join("") || "<p>模型未生成联系。</p>"}<label>人工判断 <select data-id="${r.id}"><option value="pending">待核对</option><option value="pass">符合预期</option><option value="fail">不符合预期</option><option value="critical">虚构事实／身份误判等严重错误</option></select></label></article>`).join("");
await writeFile(`${output}/review.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V3.1 内容关联人工验收</title><style>body{max-width:900px;margin:32px auto;padding:0 20px;font:16px/1.7 system-ui;color:#1b3048;background:#f4f7fa}article{background:white;padding:20px;margin:16px 0;border:1px solid #d5e0ea;border-radius:12px}h2{font-size:19px}select,button{padding:9px;border:1px solid #aabccc;border-radius:6px}header{position:sticky;top:0;background:#f4f7fa;padding:12px 0}blockquote{border-left:3px solid #aabccc;padding-left:12px}</style><header><h1>V3.1 内容关联人工验收</h1><p>合成测试数据，使用真实DeepSeek接口；尚未完成人工质量验收。相同小组及课表不应导致无关任务误连。</p><p>按样本ID顺序选择前30条实际生成的联系核对；全部原始样本保留在results.json，未生成联系的正向样本是漏连，另行记录，不计作合理联系。全部正向测试${results.filter(r => r.positive).length}组，实际生成联系${results.filter(r => r.positive && r.result?.relations.length).length}组，未生成联系${results.filter(r => r.positive && !r.result?.relations.length && !r.error).length}组；请求或校验失败${results.filter(r => r.error).length}组。</p><p id="summary"></p><button id="export">保存核对结果</button></header>${cards}<script>const results=${payload};function update(){const selections=[...document.querySelectorAll('select')];const done=selections.filter(x=>x.value!=='pending').length;const good=selections.filter(x=>x.value==='pass'&&results.find(r=>r.id===x.dataset.id).positive).length;const bad=selections.filter(x=>x.value==='fail'&&!results.find(r=>r.id===x.dataset.id).positive).length;const critical=selections.some(x=>x.value==='critical');document.querySelector('#summary').textContent='已核对 '+done+'/'+results.length+'；正向符合预期 '+good+'；无关误连 '+bad+'；严重错误 '+(critical?'有':'无')+'。'+(results.length===40&&done===40&&good>=27&&bad<=1&&!critical&&!results.some(r=>r.error)?'达到本组合成样本门槛，仍须人工核对真实接口证据与发布检查。':'未达到完整人工验收条件。')}document.querySelectorAll('select').forEach(x=>x.addEventListener('change',update));update();document.querySelector('#export').onclick=()=>{const verdicts=[...document.querySelectorAll('select')].map(x=>({id:x.dataset.id,verdict:x.value}));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({source:'synthetic fixtures; live DeepSeek; human review',verdicts},null,2)],{type:'application/json'}));a.download='v31-human-review.json';a.click();URL.revokeObjectURL(a.href)};</script></html>`);
console.log(`Review saved: ${output}/review.html; human acceptance remains pending.`);
