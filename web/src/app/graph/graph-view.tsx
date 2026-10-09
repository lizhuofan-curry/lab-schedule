"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { graphLayout, type GraphData, type GraphNode, type GraphSource } from "@/lib/graph-rules";
import { createGraphSimulation, seedGraphPositions } from "@/lib/graph-layout";
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
  const [scope, setScope] = useState("all");
  const [data, setData] = useState<GraphData | null>(null);
  const [options, setOptions] = useState<GraphData["options"]>({ members: [], groups: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
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
      canvas.current?.setAttribute("data-layout-state", model.running ? "running" : "settled");
      if (model.running) frame.current = requestAnimationFrame(step);
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
    simulation.current = createGraphSimulation(data.nodes, data.edges, displayed.current.size ? displayed.current : positions);
    displayed.current = simulation.current.positions(); startSimulation();
  }, [data, positions, startSimulation]);
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
  function choose(id: string) { if (!drag.current?.moved) { setSelected(id); setSource(null); setSourceError(""); } }
  function pinchPoint(svg: SVGSVGElement) {
    const [a, b] = [...touches.current.values()];
    const point = svg.createSVGPoint(); point.x = (a.x + b.x) / 2; point.y = (a.y + b.y) / 2;
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: local.x, y: local.y, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  return <section className="graph-workspace" aria-label="工作关系图">
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
    {error ? <div role="alert" className="graph-notice">{error}<button className="text-link" onClick={reload}>重试</button></div> : null}
    <div className="graph-stage">
      <div className="graph-canvas-wrap">
        <svg ref={canvas} className="graph-canvas" role="img" aria-label="可交互的二维工作关系图，拖动可平移；可使用下方节点列表选择" viewBox={`${-extent} ${-extent} ${size} ${size}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
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
            {edges.map((e) => { const a = positions.get(e.from)!, b = positions.get(e.to)!; const highlighted = focused && (e.from === focused || e.to === focused); return <line key={e.id} data-edge-from={e.from} data-edge-to={e.to} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`graph-edge ${e.kind} ${highlighted ? "highlighted" : ""}`} opacity={focused ? highlighted ? .9 : .1 : .5}><title>{e.label}</title></line>; })}
            {visible.map((n) => { const p = positions.get(n.id)!, radius = 5 + Math.min(8, Math.sqrt(degree.get(n.id) ?? 0) * 2); const labelOpacity = adjacent.has(n.id) ? 1 : Math.max(0, Math.min(1, (camera.zoom - .35) / .65)) * (visible.length > 100 ? Math.max(0, Math.min(1, camera.zoom - 1)) : 1); return <g key={n.id} data-node-id={n.id} transform={`translate(${p.x},${p.y})`} className={`graph-node ${n.kind} ${selected === n.id ? "selected" : ""}`} opacity={focused && !adjacent.has(n.id) ? .25 : 1} onPointerEnter={(e) => { if (e.pointerType !== "touch") setHovered(n.id); }} onPointerLeave={() => setHovered(null)}>
              <circle r={radius} /><title>{`${kindLabels[n.kind]}：${n.label} ${statusLabels[n.status] ?? n.status}`}</title>
              <text y={radius + 15 * size / canvasPixels / camera.zoom} style={{ fontSize: 12 * size / canvasPixels / camera.zoom }} textAnchor="middle" opacity={labelOpacity}>{n.label.length > 14 ? `${n.label.slice(0, 14)}…` : n.label}</text>
            </g>; })}
          </g>
        </svg>
        {!loading && !visible.length && !error && <p className="graph-empty">当前范围没有匹配的节点。请切换范围或清除筛选。</p>}
        <div className="graph-legend">{Object.entries(kindLabels).map(([key, label]) => <span key={key}><i className={key} />{label}</span>)}<span>实线：真实关系</span><span>虚线：AI推断</span></div>
        <p className="graph-gesture-hint">滚轮缩放 · 拖动空白移动视图 · 拖动节点调整位置 · 手机双指缩放</p>
      </div>
      {selectedNode && <aside className="graph-detail" aria-label="节点详情">
        <header><span>{kindLabels[selectedNode.kind]}</span><button className="icon-button" aria-label="关闭节点详情" onClick={() => setSelected(null)}><X size={20} /></button></header>
        <h2>{selectedNode.label}</h2><p>{statusLabels[selectedNode.status] ?? selectedNode.status}</p>
        {selectedNode.kind === "group" && <p>按当前成员汇总其经历；不表示这些历史工作由本组交付。</p>}
        {sourceKey && !source && !sourceError && <p role="status">正在核对当前来源…</p>}
        {sourceError && <p role="alert">{sourceError}</p>}
        {source && <><p>原始{source.round ? "发布者" : "所有者"}：{source.owner}{source.round ? ` · 第${source.round}轮` : ""}</p><p>{source.currentLoad ? "当前进行中" : "历史或非进行中来源，不作为当前任务负担"}</p><div className="graph-source-text">{source.description}</div></>}
        <h3>关联节点</h3><ul className="graph-connections">{data?.edges.filter((e) => e.from === selected || e.to === selected).map((e) => { const other = data.nodes.find((n) => n.id === (e.from === selected ? e.to : e.from)); return other ? <li key={e.id}><button className="text-link" onClick={() => choose(other.id)}>{other.label}</button><small>{e.label}</small></li> : null; })}</ul>
      </aside>}
    </div>
    <details className="graph-node-list"><summary>按列表选择节点（{visible.length}）</summary><div>{visible.map((n) => <button key={n.id} className="text-link" onClick={() => choose(n.id)}>{kindLabels[n.kind]} · {n.label}</button>)}</div></details>
    <p className="graph-analysis" role="status">{data?.analysis.message ?? "真实关系来自当前系统记录。"}{data?.analysis.analyzedAt ? ` 分析时间：${new Date(data.analysis.analyzedAt).toLocaleString("zh-CN")}` : ""}</p>
    <p className="graph-footnote">主题分析使用 DeepSeek。分析仅发送必要文字并使用成员代号，正文仍可能含可识别内容。真实关系与模型推断分别标识，可点击节点核对来源。</p>
  </section>;
}
