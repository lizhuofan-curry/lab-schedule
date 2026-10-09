import type { GraphEdge, GraphNode } from "./graph-rules";

type Point = { id: string; x: number; y: number; vx: number; vy: number; fixed?: { x: number; y: number } };
type Cell = { left: number; top: number; width: number; mass: number; x: number; y: number; points?: Point[]; children?: Cell[] };
function tree(points: Point[], left: number, top: number, width: number, depth = 0): Cell {
  const cell: Cell = { left, top, width, mass: points.length, x: 0, y: 0 };
  if (!points.length) return cell;
  cell.x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  cell.y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  if (points.length <= 1 || depth >= 24) { cell.points = points; return cell; }
  const half = width / 2, buckets: Point[][] = [[], [], [], []];
  for (const p of points) buckets[Number(p.x >= left + half) + 2 * Number(p.y >= top + half)].push(p);
  cell.children = buckets.map((bucket, i) => tree(bucket, left + i % 2 * half, top + Math.floor(i / 2) * half, half, depth + 1));
  return cell;
}
function repel(p: Point, cell: Cell, alpha: number) {
  if (!cell.mass) return;
  if (cell.points) {
    for (const q of cell.points) if (q !== p) {
      const dx = p.x - q.x, dy = p.y - q.y, squared = Math.max(25, dx * dx + dy * dy);
      const strength = 160 * alpha / squared;
      p.vx += dx * strength; p.vy += dy * strength;
      const distance = Math.sqrt(squared);
      if (distance < 42) { const push = (42 - distance) / distance * .18; p.vx += dx * push; p.vy += dy * push; }
    }
    return;
  }
  const dx = p.x - cell.x, dy = p.y - cell.y, squared = Math.max(25, dx * dx + dy * dy);
  const contains = p.x >= cell.left && p.x <= cell.left + cell.width && p.y >= cell.top && p.y <= cell.top + cell.width;
  if (!contains && cell.width * cell.width < squared * .64) {
    const strength = 160 * alpha * cell.mass / squared; p.vx += dx * strength; p.vy += dy * strength;
  } else for (const child of cell.children!) repel(p, child, alpha);
}

// Keep unrelated nodes clear of a link's interior without adding graph edges.
// Query the same spatial tree so this does not scan every node for every link.
function clearLink(a: Point, b: Point, cell: Cell, alpha: number) {
  const gap = 16;
  if (!cell.mass || cell.left > Math.max(a.x, b.x) + gap || cell.left + cell.width < Math.min(a.x, b.x) - gap || cell.top > Math.max(a.y, b.y) + gap || cell.top + cell.width < Math.min(a.y, b.y) - gap) return;
  if (cell.children) { for (const child of cell.children) clearLink(a, b, child, alpha); return; }
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  if (squared < 1) return;
  const length = Math.sqrt(squared);
  for (const p of cell.points ?? []) {
    if (p === a || p === b || p.fixed) continue;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared;
    if (t <= .08 || t >= .92) continue;
    const signed = ((p.x - a.x) * -dy + (p.y - a.y) * dx) / length;
    if (Math.abs(signed) >= gap) continue;
    const side = signed === 0 ? (p.id.localeCompare(a.id) < 0 ? -1 : 1) : Math.sign(signed);
    const push = side * (gap - Math.abs(signed)) * .35 * alpha;
    p.vx += -dy / length * push; p.vy += dx / length * push;
  }
}

// Deterministic force layout: links attract, nearby nodes repel. The tree bounds
// repulsion work for large graphs; every node remains in the layout.
export function seedGraphPositions(nodes: GraphNode[]) {
  return new Map([...nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5)), radius = 38 * Math.sqrt(index);
    return [n.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }] as const;
  }));
}
export function createGraphSimulation(nodes: GraphNode[], edges: GraphEdge[] = [], initial = seedGraphPositions(nodes)) {
  const points: Point[] = [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5)), radius = 38 * Math.sqrt(index);
    return { id: n.id, ...(initial.get(n.id) ?? { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }), vx: 0, vy: 0 };
  });
  const lookup = new Map(points.map(p => [p.id, p]));
  const links = edges.flatMap(e => {
    const a = lookup.get(e.from), b = lookup.get(e.to);
    return a && b && a !== b ? [{ a, b, length: e.kind === "inferred" ? 75 : 95 }] : [];
  });
  const degrees = new Map<string, number>();
  for (const { a, b } of links) { degrees.set(a.id, (degrees.get(a.id) ?? 0) + 1); degrees.set(b.id, (degrees.get(b.id) ?? 0) + 1); }
  let alpha = 1;
  const cloudRadius = Math.max(100, Math.sqrt(points.length) * 40);
  function tick() {
    if (!points.length || alpha < .005) return;
    const left = Math.min(...points.map(p => p.x)) - 1, top = Math.min(...points.map(p => p.y)) - 1;
    const width = Math.max(Math.max(...points.map(p => p.x)) - left, Math.max(...points.map(p => p.y)) - top) + 2;
    const root = tree(points, left, top, width);
    for (const p of points) repel(p, root, alpha);
    for (const { a, b, length } of links) {
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - length) / distance * .12 * alpha;
      const bias = (degrees.get(a.id) ?? 1) / ((degrees.get(a.id) ?? 1) + (degrees.get(b.id) ?? 1));
      a.vx += dx * force * (1 - bias); a.vy += dy * force * (1 - bias);
      b.vx -= dx * force * bias; b.vy -= dy * force * bias;
    }
    for (const { a, b } of links) clearLink(a, b, root, alpha);
    for (const p of points) {
      if (p.fixed) { p.x = p.fixed.x; p.y = p.fixed.y; p.vx = 0; p.vy = 0; continue; }
      // A soft circular envelope keeps sparse leaf branches within the cloud;
      // positions inside remain governed by the actual links and repulsion.
      const radius = Math.max(1, Math.hypot(p.x, p.y));
      const inward = .08 * Math.min(1, points.length / 20) + Math.max(0, radius - cloudRadius) / radius * .18;
      p.vx = (p.vx - p.x * inward * alpha) * .72; p.vy = (p.vy - p.y * inward * alpha) * .72;
      p.x += Math.max(-20, Math.min(20, p.vx)); p.y += Math.max(-20, Math.min(20, p.vy));
    }
    alpha *= .965;
  }
  return {
    tick,
    get running() { return points.length > 0 && alpha >= .005; },
    positions: () => new Map(points.map(p => [p.id, { x: p.x, y: p.y }])),
    pin(id: string, x: number, y: number) { const p = lookup.get(id); if (p) { p.fixed = { x, y }; p.x = x; p.y = y; alpha = Math.max(alpha, .4); } },
    release(id: string) { const p = lookup.get(id); if (p) { delete p.fixed; alpha = Math.max(alpha, .4); } },
  };
}
export function forceGraphLayout(nodes: GraphNode[], edges: GraphEdge[] = []) {
  const simulation = createGraphSimulation(nodes, edges);
  for (let tick = 0; tick < 160; tick++) simulation.tick();
  const points = [...simulation.positions()].map(([id, p]) => ({ id, ...p }));
  if (!points.length) return new Map<string, { x: number; y: number }>();
  return new Map(points.map(p => [p.id, { x: p.x, y: p.y }]));
}
