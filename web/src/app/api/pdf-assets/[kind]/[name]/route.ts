import { readFile } from "node:fs/promises";
import path from "node:path";

// Only PDF.js package assets, never uploaded documents or arbitrary filesystem paths.
const extensions: Record<string, RegExp> = {
  cmaps: /^[a-zA-Z0-9_-]+\.bcmap$/,
  standard_fonts: /^[a-zA-Z0-9_-]+\.(?:pfb|ttf)$/,
  wasm: /^[a-zA-Z0-9_-]+\.wasm$/,
};
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; name: string }> }) {
  const { kind, name } = await params;
  if (!Object.hasOwn(extensions, kind) || !extensions[kind].test(name)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules/pdfjs-dist", kind, name));
    return new Response(new Uint8Array(bytes), { headers: {
      "content-type": kind === "wasm" ? "application/wasm" : "application/octet-stream",
      "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff",
    } });
  } catch { return new Response(null, { status: 404 }); }
}
