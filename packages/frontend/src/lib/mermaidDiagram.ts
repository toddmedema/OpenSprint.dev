/**
 * Client-side Mermaid rendering into .os-mermaid mounts (see markdownUtils).
 */

let mermaidImport: Promise<typeof import("mermaid")> | null = null;

function loadMermaid(): Promise<typeof import("mermaid")> {
  return (mermaidImport ??= import("mermaid"));
}

export async function renderMermaidDiagrams(
  root: HTMLElement,
  resolved: "light" | "dark"
): Promise<void> {
  const mounts = root.querySelectorAll<HTMLElement>(".os-mermaid");
  if (mounts.length === 0) return;

  const { default: mermaid } = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: resolved === "dark" ? "dark" : "default",
  });

  let seq = 0;
  for (const mount of mounts) {
    const b64 = mount.getAttribute("data-mermaid-source");
    const out = mount.querySelector<HTMLElement>(".os-mermaid-svg");
    if (!b64 || !out) continue;

    let source: string;
    try {
      source = decodeMermaidSourceFromAttr(b64);
    } catch {
      out.replaceChildren();
      const err = document.createElement("span");
      err.className = "text-theme-error-text text-xs";
      err.textContent = "Invalid diagram encoding";
      out.appendChild(err);
      continue;
    }

    out.replaceChildren();
    const id = `os-mermaid-${Date.now()}-${seq++}`;
    try {
      const { svg } = await mermaid.render(id, source);
      out.innerHTML = svg;
    } catch {
      const err = document.createElement("span");
      err.className = "text-theme-error-text text-xs";
      err.textContent = "Diagram could not be rendered";
      out.appendChild(err);
    }
  }
}

/** @internal exported for markdownUtils tests */
export function encodeMermaidSourceForAttr(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** @internal exported for markdownUtils tests */
export function decodeMermaidSourceFromAttr(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
