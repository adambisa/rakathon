import Markdown, { type Components } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import documentation from "virtual:documentation";

import { DocumentationDiagram } from "#components/documentation-diagram";
import { PageHeader } from "#components/page-header";
import { Anchor, ButtonLink, Link } from "#ui";

const { "pro-lekare": doctors, "pro-it-a-dpo": it } = documentation;

const guides = [
  { id: "pro-lekare", title: "Pro lékaře", content: doctors },
  { id: "pro-it-a-dpo", title: "Pro IT a DPO", content: it },
];

const components: Components = {
  a({ href, children }) {
    const [path, hash] = (href ?? "").split("#");
    const guide = guides.find((item) => `${item.id}.md` === path);
    if (guide) {
      return (
        <Link to="/dokumentace" search={{ guide: guide.id }} hash={hash ?? ""}>
          {children}
        </Link>
      );
    }
    // Repository references are relative to docs/dokumentace, not the application URL.
    let url = href;
    if (path?.startsWith("../") === true) {
      url = new URL(href ?? "", "https://github.com/rakathon26/rakathon/blob/main/docs/dokumentace/").href;
    }

    return <Anchor href={url}>{children}</Anchor>;
  },
  table({ children }) {
    return (
      <div className="my-6 overflow-x-auto rounded-box border border-base-300">
        <table>{children}</table>
      </div>
    );
  },
  pre({ children }) {
    return <div className="documentation-code">{children}</div>;
  },
  code({ className, children }) {
    if (className === "language-mermaid" && typeof children === "string") {
      return <DocumentationDiagram key={children} source={children.trim()} />;
    }

    return <code className={className}>{children}</code>;
  },
};

export interface DocumentationProps {
  guide: string;
}

export function Documentation({ guide }: DocumentationProps) {
  const selected = guides.find((item) => item.id === guide) ?? { id: "pro-lekare", content: doctors };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader>Dokumentace</PageHeader>
      <nav aria-label="Příručky" className="flex flex-wrap gap-2">
        {guides.map((item) => (
          <ButtonLink
            key={item.id}
            to="/dokumentace"
            search={{ guide: item.id }}
            hash=""
            aria-current={selected.id === item.id ? "page" : undefined}
            size="sm"
            tone={selected.id === item.id ? "primary" : undefined}
            variant={selected.id === item.id ? undefined : "ghost"}
          >
            {item.title}
          </ButtonLink>
        ))}
      </nav>
      <article className="documentation min-w-0 rounded-box border border-base-300 bg-base-100 p-5 sm:p-8">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
          {selected.content}
        </Markdown>
      </article>
    </div>
  );
}
