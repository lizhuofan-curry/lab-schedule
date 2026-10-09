"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Settings2, X } from "lucide-react";
import Link from "next/link";
import { graphLayout, type GraphData, type GraphNode, type GraphSource } from "@/lib/graph-rules";
import { createGraphSimulation, seedGraphPositions, defaultGraphForces, type GraphForces } from "@/lib/graph-layout";
import { SelectControl } from "@/components/form-controls";

const statusLabels: Record<string, string> = { active: "进行中", paused: "暂停", completed: "已完成", cancelled: "已撤销", superseded: "历史轮次" };
const kindLabels: Record<GraphNode["kind"], string> = { member: "成员", group: "小组", task: "任务", work: "工作记录", theme: "AI主题" };
async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "关系图读取失败，请重试。");
  return body.data;
}
export function GraphView() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nodeScale, setNodeScale] = useState(1.7);
  const [lineOpacity, setLineOpacity] = useState(.5);
  const [lineWidth, setLineWidth] = useState(.6);
  const [colors, setColors] = useState({ member: "#5bd454", work: "#db585b", task: "#a15bda", group: "#ce8859" });
  const [forces, setForces] = useState<GraphForces>({ ...defaultGraphForces });
  const [labelThreshold, setLabelThreshold] = useState(.35);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState("all");
  const [data, setData] = useState<GraphData | null>(null);
  const [options, setOptions] = useState<GraphData["options"]>({ members: [], groups: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{ id: string; version: string } | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ id: string; version: string; message: string } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [loadedSource, setSource] = useState<(GraphSource & { version: string }) | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [retry, setRetry] = useState(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [canvasPixels, setCanvasPixels] = useState(600);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; nodeId?: string } | null>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number; x: number; y: number } | null>(null);
  const simulation = useRef<ReturnType<typeof createGraphSimulation> | null>(null);
  const displayed = useRef(new Map<string, { x: number; y: number }>());
  const topology = useRef("");
  const growthStarted = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const drawNodes = useRef<{ element: SVGGElement; id: string }[]>([]);
  const drawEdges = useRef<{ element: SVGLineElement; from: string; to: string }[]>([]);
  const paint = useCallback(() => {
    for (const { element, id } of drawNodes.current) { const p = displayed.current.get(id); if (p) element.setAttribute("transform", `translate(${p.x},${p.y})`); }
    for (const { element, from, to } of drawEdges.current) { const a = displayed.current.get(from), b = displayed.current.get(to); if (a && b) { element.setAttribute("x1", String(a.x)); element.setAttribute("y1", String(a.y)); element.setAttribute("x2", String(b.x)); element.setAttribute("y2", String(b.y)); } }
  }, []);
  const startSimulation = useCallback(() => {
    if (frame.current !== null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      frame.current = null;
      const model = simulation.current; if (!model) return;
      if (reduced) { for (let i = 0; i < 160; i++) model.tick(); }
      else { model.tick(); model.tick(); }
      displayed.current = model.positions(); paint();
      if (growthStarted.current !== null) {
        const progress = reduced ? 1 : Math.min(1, (performance.now() - growthStarted.current) / 900);
        canvas.current?.style.setProperty("--graph-arrival", String(1 - Math.pow(1 - progress, 3)));
        if (progress === 1) growthStarted.current = null;
      }
      canvas.current?.setAttribute("data-layout-state", model.running ? "running" : "settled");
      if (model.running || growthStarted.current !== null) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [paint]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); simulation.current = null; }, []);
  const reload = useCallback(() => { setLoading(true); setData(null); setSelected(null); setSource(null); setSourceError(""); setError(""); setRetry((n) => n + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const [kind, id] = scope.split(":");
        const next = await read<GraphData>(`/api/graph?scope=${kind}${id ? `&id=${id}` : ""}`, controller.signal);
        if (!controller.signal.aborted) { setData(previous => previous && JSON.stringify({ ...previous, asOf: "" }) === JSON.stringify({ ...next, asOf: "" }) ? previous : next); setOptions(next.options); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted) { setData(null); setSource(null); setError(e instanceof Error ? e.message : "读取失败，请重试。"); }
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(load, 15000); }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scope, retry]);
  const selectedNode = data?.nodes.find((n) => n.id === selected);
  const version = data?.version;
  const activeEdge = selectedEdge && selectedEdge.version === version ? data?.edges.find(e => e.id === selectedEdge.id) : undefined;
  const sourceKey = selectedNode?.sourceKey;
  const source = loadedSource && loadedSource.version === version && loadedSource.key === sourceKey ? loadedSource : null;
  useEffect(() => {
    const controller = new AbortController();
    if (sourceKey && version) void read<GraphSource & { version: string }>(`/api/graph/sources/${encodeURIComponent(sourceKey)}`, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.version !== version) { setSourceError("数据已变化，正在重新读取关系图。"); reload(); return; }
        setSource(value); setSourceError("");
      }).catch((e) => { if (!controller.signal.aborted) setSourceError(e instanceof Error ? e.message : "来源不可用，请刷新。"); });
    return () => controller.abort();
  }, [sourceKey, version, reload]);
  const visible = useMemo(() => {
    if (!data) return [];
    return data.nodes.filter((n) => (!query.trim() || n.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (status === "all" || n.kind === "member" || n.kind === "group" || n.status === status));
  }, [data, query, status]);
  const initialPositions = useMemo(() => graphLayout(data?.nodes ?? [], data?.edges ?? []), [data]);
  const positions = useMemo(() => seedGraphPositions(data?.nodes ?? []), [data]);
  useEffect(() => {
    if (!data) { simulation.current = null; topology.current = ""; displayed.current.clear(); return; }
    const key = JSON.stringify([data.nodes.map(n => n.id), data.edges.map(e => [e.from, e.to, e.kind])]);
    if (topology.current === key) return;
    topology.current = key;
    const firstArrival = displayed.current.size === 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seeds = firstArrival && !reduced ? new Map([...positions].map(([id, point]) => [id, { x: point.x * .2, y: point.y * .2 }])) : displayed.current.size ? displayed.current : positions;
    if (firstArrival) { growthStarted.current = performance.now(); canvas.current?.style.setProperty("--graph-arrival", reduced ? "1" : "0"); }
    simulation.current = createGraphSimulation(data.nodes, data.edges, seeds, forces);
    displayed.current = simulation.current.positions(); startSimulation();
  }, [data, positions, startSimulation, forces]);
  useEffect(() => { simulation.current?.setForces(forces); startSimulation(); }, [forces, startSimulation]);
  function replayGrowth() {
    if (!data) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seeds = new Map([...positions].map(([id, point]) => [id, { x: point.x * (reduced ? 1 : .2), y: point.y * (reduced ? 1 : .2) }]));
    simulation.current = createGraphSimulation(data.nodes, data.edges, seeds, forces);
    displayed.current = simulation.current.positions();
    growthStarted.current = performance.now();
    canvas.current?.style.setProperty("--graph-arrival", reduced ? "1" : "0");
    paint(); startSimulation();
  }
  const extent = Math.max(180, ...[...initialPositions.values()].map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) + 55));
  const size = extent * 2;
  useEffect(() => {
    const svg = canvas.current; if (!svg) return;
    const observer = new ResizeObserver(() => { const rect = svg.getBoundingClientRect(); setCanvasPixels(Math.max(1, Math.min(rect.width, rect.height))); });
    observer.observe(svg); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const svg = canvas.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
      const matrix = svg.getScreenCTM(); if (!matrix) return;
      const cursor = point.matrixTransform(matrix.inverse());
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1);
      setCamera(c => { const zoom = Math.max(.25, Math.min(12, c.zoom * Math.exp(-Math.max(-500, Math.min(500, delta)) * .0015))); return { zoom, x: cursor.x - (cursor.x - c.x) * zoom / c.zoom, y: cursor.y - (cursor.y - c.y) * zoom / c.zoom }; });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [size]);
  const visibleIds = new Set(visible.map((n) => n.id));
  const edges = data?.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)) ?? [];
  const focused = hovered ?? selected;
  const adjacent = new Set([focused, ...edges.filter((e) => e.from === focused || e.to === focused).flatMap((e) => [e.from, e.to])]);
  const degree = new Map<string, number>();
  for (const e of data?.edges ?? []) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1); }
  useEffect(() => {
    const svg = canvas.current; if (!svg) return;
    drawNodes.current = [...svg.querySelectorAll<SVGGElement>("[data-node-id]")].map(element => ({ element, id: element.getAttribute("data-node-id")! }));
    drawEdges.current = [...svg.querySelectorAll<SVGLineElement>("[data-edge-from]")].map(element => ({ element, from: element.getAttribute("data-edge-from")!, to: element.getAttribute("data-edge-to")! }));
    paint();
  }, [visible, data, paint]);
  function choose(id: string) { if (!drag.current?.moved) { setSettingsOpen(false); setSelectedEdge(null); setSelected(id); setSource(null); setSourceError(""); } }
  function chooseEdge(id: string) {
    if (!data) return;
    setSettingsOpen(false);
    setSelected(null); setSource(null); setSelectedEdge({ id, version: data.version }); setFeedbackReason(""); setFeedbackResult(null);
  }
  async function sendFeedback() {
    if (!activeEdge || !version || feedbackBusy) return;
    const id = activeEdge.id, inputVersion = version;
    setFeedbackBusy(true);
    try {
      const response = await fetch("/api/graph/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ edgeId: id, version: inputVersion, reason: feedbackReason }) });
      const body = await response.json();
      setFeedbackResult({ id, version: inputVersion, message: response.ok ? body.data.message : body.message ?? "提交失败，请稍后重试。" });
    } catch { setFeedbackResult({ id, version: inputVersion, message: "网络连接失败，请检查网络后重试。" }); }
    finally { setFeedbackBusy(false); }
  }
  function pinchPoint(svg: SVGSVGElement) {
    const [a, b] = [...touches.current.values()];
    const point = svg.createSVGPoint(); point.x = (a.x + b.x) / 2; point.y = (a.y + b.y) / 2;
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: local.x, y: local.y, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  return <section className="graph-workspace graph-immersive" style={{ "--graph-line-width": `${lineWidth}px`, ...Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--graph-${key}`, value])) } as CSSProperties} aria-label="工作关系图" onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (settingsOpen) { setSettingsOpen(false); settingsButton.current?.focus(); }
    else { setSelected(null); setSelectedEdge(null); }
  }}>
    <Link href="/dashboard" className="graph-return icon-button" aria-label="返回课表总览" title="返回课表总览"><ArrowLeft size={20} /></Link>
    <button ref={settingsButton} className="graph-settings-button icon-button" aria-label="关系图设置" title="关系图设置" aria-expanded={settingsOpen} aria-controls="graph-settings" onClick={() => setSettingsOpen(open => !open)}><Settings2 size={20} /></button>
    <aside id="graph-settings" className="graph-settings" aria-label="关系图设置" hidden={!settingsOpen}>
      <header><h2>关系图设置</h2><button className="icon-button" aria-label="关闭关系图设置" onClick={() => { setSettingsOpen(false); settingsButton.current?.focus(); }}><X size={18} /></button></header>
      <details className="graph-settings-section" open><summary>筛选</summary><div className="graph-settings-section-body">
    <div className="graph-controls">
      <div className="graph-control"><span>查看范围</span><SelectControl label="查看范围" value={scope} searchable searchLabel="搜索成员或小组" options={[
        { value: "all", label: "全体成员" },
        ...options.members.map(m => ({ value: `member:${m.id}`, label: m.name, group: "成员" })),
        ...options.groups.map(g => ({ value: `group:${g.id}`, label: g.name, group: "小组" })),
      ]} onChange={value => { setScope(value); reload(); setHovered(null); setCamera({ x: 0, y: 0, zoom: 1 }); }} /></div>
      <label>搜索节点<input type="search" placeholder="姓名、任务或记录名称" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="graph-control"><span>来源状态</span><SelectControl label="来源状态" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} /></div>
    </div>
    <div className="graph-meta" aria-live="polite">
      <span>{loading ? "正在读取关系图…" : `显示 ${visible.length} / ${data?.nodes.length ?? 0} 个节点${query || status !== "all" ? " · 筛选中" : " · 当前范围全部节点"}`}</span>
      <button className="text-link" onClick={reload}>重新读取</button>
    </div>
      </div></details>
      <details className="graph-settings-section" open><summary>颜色组</summary><div className="graph-color-controls">{Object.entries(colors).map(([key, color]) => <label key={key}>{kindLabels[key as GraphNode["kind"]]}<input type="color" aria-label={`${kindLabels[key as GraphNode["kind"]]}颜色`} value={color} onChange={event => setColors(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div></details>
      <details className="graph-settings-section" open><summary>外观</summary><div className="graph-settings-section-body">
      <div className="graph-display-controls">
        <label htmlFor="graph-display-size">节点大小 <output>{nodeScale.toFixed(1)}倍</output><input type="range" min="0.5" max="3" step="0.1" id="graph-display-size" value={nodeScale} onChange={event => setNodeScale(Number(event.target.value))} /></label>
        <label htmlFor="graph-display-opacity">连线透明度 <output>{Math.round(lineOpacity * 100)}%</output><input type="range" min="0.1" max="1" step="0.05" id="graph-display-opacity" value={lineOpacity} onChange={event => setLineOpacity(Number(event.target.value))} /></label>
        <label htmlFor="graph-display-labels">名称渐隐阈值 <output>{labelThreshold.toFixed(2)}</output><input type="range" min="0.1" max="2" step="0.05" id="graph-display-labels" value={labelThreshold} onChange={event => setLabelThreshold(Number(event.target.value))} /></label>
        <label htmlFor="graph-display-width">连线粗细 <output>{lineWidth.toFixed(1)}px</output><input id="graph-display-width" type="range" min="0.2" max="1.5" step="0.1" value={lineWidth} onChange={event => setLineWidth(Number(event.target.value))} /></label>
      </div>
      <button className="graph-play-button" onClick={replayGrowth}>播放展开动画</button>
      </div></details>
      <details className="graph-settings-section" open><summary>力度</summary><div className="graph-display-controls graph-settings-section-body">{([ ["center", "图谱向心力"], ["repel", "节点间的排斥力"], ["link", "相连节点间的吸引力"], ["distance", "连线长度"] ] as const).map(([key, label]) => <label key={key} htmlFor={`graph-force-${key}`}>{label}<output>{forces[key].toFixed(2)}</output><input id={`graph-force-${key}`} type="range" min="0.2" max="2" step="0.05" value={forces[key]} onChange={event => setForces(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></details>
      <details className="graph-settings-section"><summary>图例与来源</summary><div className="graph-settings-section-body">
      <div className="graph-legend">{Object.entries(kindLabels).filter(([key]) => key !== "theme").map(([key, label]) => <span key={key}><i className={key} />{label}</span>)}<span>实线：真实关系</span><span>虚线：AI推断</span></div>
      <p className="graph-gesture-hint">滚轮缩放 · 拖动空白移动视图 · 拖动节点调整位置 · 手机双指缩放</p>
      <details className="graph-node-list"><summary>按列表选择节点（{visible.length}）</summary><div>{visible.map((n) => <button key={n.id} className="text-link" onClick={() => choose(n.id)}>{kindLabels[n.kind]} · {n.label}</button>)}</div></details>
      <p className="graph-analysis" role="status">{data?.analysis.message ?? "真实关系来自当前系统记录。"}{data?.analysis.analyzedAt ? ` 分析时间：${new Date(data.analysis.analyzedAt).toLocaleString("zh-CN")}` : ""}</p>
      <p className="graph-footnote">细实线为真实关系，细虚线为模型推断，点击关联查看理由与依据。同课不证明实际共同到课。开启内容关联分析后，DeepSeek读取必要工作、任务、角色与课表字段，使用成员及小组代号；内容仍可能可识别。</p>
      </div></details>
    </aside>
    {loading && <p className="graph-loading" role="status">正在读取关系图…</p>}
    {error ? <div role="alert" className="graph-notice">{error}<button className="text-link" onClick={reload}>重试</button></div> : null}
    <div className="graph-stage">
      <div className="graph-canvas-wrap">
        <svg ref={canvas} className="graph-canvas" role="img" aria-label="可交互的二维工作关系图，拖动可平移；可在设置面板的节点列表中选择" viewBox={`${-extent} ${-extent} ${size} ${size}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            if (e.pointerType === "touch") {
              touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (touches.current.size >= 2) { if (drag.current?.nodeId) simulation.current?.release(drag.current.nodeId); const p = pinchPoint(e.currentTarget); pinch.current = { distance: p.distance, zoom: camera.zoom, x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom }; drag.current = null; return; }
            }
            const nodeId = (e.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id") ?? undefined; const p = nodeId ? displayed.current.get(nodeId) ?? positions.get(nodeId)! : camera;
            if (nodeId) { simulation.current?.pin(nodeId, p.x, p.y); startSimulation(); }
            drag.current = { x: e.clientX, y: e.clientY, cx: p.x, cy: p.y, moved: false, nodeId };
          }}
          onPointerMove={(e) => {
            if (e.pointerType === "touch" && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current && touches.current.size >= 2) { const p = pinchPoint(e.currentTarget), start = pinch.current; const zoom = Math.max(.25, Math.min(12, start.zoom * p.distance / start.distance)); setCamera({ zoom, x: p.x - start.x * zoom, y: p.y - start.y * zoom }); return; }
            const d = drag.current; if (!d) return; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true; if (!d.moved) return;
            const rect = e.currentTarget.getBoundingClientRect(); const unit = size / Math.min(rect.width, rect.height); const x = d.cx + (e.clientX - d.x) * unit / (d.nodeId ? camera.zoom : 1), y = d.cy + (e.clientY - d.y) * unit / (d.nodeId ? camera.zoom : 1);
            if (d.nodeId) { simulation.current?.pin(d.nodeId, x, y); displayed.current.set(d.nodeId, { x, y }); paint(); startSimulation(); } else setCamera((c) => ({ ...c, x, y }));
          }}
          onPointerUp={(e) => { const d = drag.current; if (d?.nodeId) { simulation.current?.release(d.nodeId); startSimulation(); } if (!pinch.current && d) { const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]"); if (target) choose(target.getAttribute("data-node-id")!); } touches.current.delete(e.pointerId); pinch.current = null; drag.current = null; }}
          onPointerCancel={(e) => { if (drag.current?.nodeId) { simulation.current?.release(drag.current.nodeId); startSimulation(); } touches.current.delete(e.pointerId); pinch.current = null; drag.current = null; }}
          onPointerLeave={() => setHovered(null)}>
          <g transform={`translate(${camera.x},${camera.y}) scale(${camera.zoom})`}>
            {edges.map((e) => { const a = positions.get(e.from)!, b = positions.get(e.to)!; const highlighted = focused && (e.from === focused || e.to === focused); return <line key={e.id} data-edge-from={e.from} data-edge-to={e.to} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`graph-edge ${e.kind} ${highlighted ? "highlighted" : ""}`} opacity={focused ? highlighted ? Math.max(.75, lineOpacity) : lineOpacity * .2 : lineOpacity}><title>{e.label}</title></line>; })}
            {edges.filter(e => e.detail).map(e => { const a = positions.get(e.from)!, b = positions.get(e.to)!; return <line key={`hit/${e.id}`} className="graph-edge-hit" data-edge-from={e.from} data-edge-to={e.to} data-edge-id={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} role="button" tabIndex={0} aria-label={`查看关联：${e.label}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); chooseEdge(e.id); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseEdge(e.id); } }} />; })}
            {visible.map((n) => { const p = positions.get(n.id)!, radius = (3.2 + Math.min(4.8, (degree.get(n.id) ?? 0) * .3)) * nodeScale * size / canvasPixels; const labelOpacity = adjacent.has(n.id) ? 1 : Math.max(0, Math.min(1, (camera.zoom - labelThreshold) / .65)) * (visible.length > 100 ? Math.max(0, Math.min(1, camera.zoom - 1)) : 1); return <g key={n.id} data-node-id={n.id} transform={`translate(${p.x},${p.y})`} className={`graph-node ${n.kind} ${selected === n.id ? "selected" : ""}`} opacity={focused && !adjacent.has(n.id) ? .25 : 1} onPointerEnter={(e) => { if (e.pointerType !== "touch") setHovered(n.id); }} onPointerLeave={() => setHovered(null)}>
              <circle r={radius} /><title>{`${kindLabels[n.kind]}：${n.label} ${statusLabels[n.status] ?? n.status}`}</title>
              <text y={radius + 15 * size / canvasPixels / camera.zoom} style={{ fontSize: 12 * size / canvasPixels / camera.zoom }} textAnchor="middle" opacity={labelOpacity}>{n.label.length > 14 ? `${n.label.slice(0, 14)}…` : n.label}</text>
            </g>; })}
          </g>
        </svg>
        {!loading && !visible.length && !error && <p className="graph-empty">当前范围没有匹配的节点。请切换范围或清除筛选。</p>}
      </div>
      {activeEdge && <aside className="graph-detail" aria-label="关联详情">
        <header><span>{activeEdge.kind === "inferred" ? "DeepSeek内容关联 · 模型推断" : "真实课表关系"}</span><button className="icon-button" aria-label="关闭关联详情" onClick={() => setSelectedEdge(null)}><X size={20} /></button></header>
        <h2>{activeEdge.label}</h2><p>{activeEdge.detail?.reason}</p>
        {activeEdge.detail?.analyzedAt && <p>分析时间：{new Date(activeEdge.detail.analyzedAt).toLocaleString("zh-CN")}</p>}
        <h3>关联来源</h3>
        {[activeEdge.from, activeEdge.to].map((id, index) => <div key={id}><button className="text-link" onClick={() => choose(id)}>{data?.nodes.find(n => n.id === id)?.label}</button><p className="graph-source-text">{index === 0 ? activeEdge.detail?.fromEvidence : activeEdge.detail?.toEvidence}</p></div>)}
        {activeEdge.detail?.courses?.map((c, i) => <p key={i}>{c.name} · 星期{"一二三四五六日"[c.weekday - 1]} · 第{c.startPeriod}—{c.endPeriod}节 · {c.location} · 共同周次：{c.weeks.join("、")}</p>)}
        {activeEdge.kind === "inferred" && <form onSubmit={event => { event.preventDefault(); void sendFeedback(); }}>
          <label htmlFor="graph-feedback-reason">关联不准确？请说明理由</label><textarea id="graph-feedback-reason" required maxLength={1000} value={feedbackReason} onChange={event => setFeedbackReason(event.target.value)} />
          <button className="button" disabled={feedbackBusy || !feedbackReason.trim()}>{feedbackBusy ? "正在提交…" : "提交不准确反馈"}</button>
          <p>反馈不会立即修改公共关系图。</p>
          {feedbackResult?.id === activeEdge.id && feedbackResult.version === version && <p role="status">{feedbackResult.message}</p>}
        </form>}
      </aside>}
      {selectedNode && <aside className="graph-detail" aria-label="节点详情">
        <header><span>{kindLabels[selectedNode.kind]}</span><button className="icon-button" aria-label="关闭节点详情" onClick={() => setSelected(null)}><X size={20} /></button></header>
        <h2>{selectedNode.label}</h2><p>{statusLabels[selectedNode.status] ?? selectedNode.status}</p>
        {selectedNode.kind === "group" && <p>按当前成员汇总其经历；不表示这些历史工作由本组交付。</p>}
        {sourceKey && !source && !sourceError && <p role="status">正在核对当前来源…</p>}
        {sourceError && <p role="alert">{sourceError}</p>}
        {source && <><p>原始{source.round ? "发布者" : "所有者"}：{source.owner}{source.round ? ` · 第${source.round}轮` : ""}</p><p>{source.currentLoad ? "当前进行中" : "历史或非进行中来源，不作为当前任务负担"}</p><div className="graph-source-text">{source.description}</div></>}
        <h3>关联节点</h3><ul className="graph-connections">{data?.edges.filter((e) => e.from === selected || e.to === selected).map((e) => { const other = data.nodes.find((n) => n.id === (e.from === selected ? e.to : e.from)); return other ? <li key={e.id}><button className="text-link" onClick={() => choose(other.id)}>{other.label}</button>{e.detail ? <button className="text-link" onClick={() => chooseEdge(e.id)}>{e.label} · 查看依据</button> : <small>{e.label}</small>}</li> : null; })}</ul>
      </aside>}
    </div>
  </section>;
}
