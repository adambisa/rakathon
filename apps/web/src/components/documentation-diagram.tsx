import { useEffect, useId, useState } from "react";

export interface DocumentationDiagramProps {
  source: string;
}

export function DocumentationDiagram({ source }: DocumentationDiagramProps) {
  const id = `documentation-${useId().replaceAll(/[^a-z0-9]/gi, "")}`;
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const result = await mermaid.render(id, source);
        if (!cancelled) setSvg(result.svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void render();

    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (failed) {
    return (
      <div>
        <p role="status">Diagram se nepodařilo zobrazit.</p>
        <pre>{source}</pre>
      </div>
    );
  }

  if (svg === "") return <p role="status">Načítání diagramu…</p>;

  return (
    <div
      role="img"
      aria-label="Diagram postupu a architektury"
      className="overflow-x-auto rounded-box bg-white p-4 text-neutral-900 [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
