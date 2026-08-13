import ReactMarkdown from "react-markdown";
import type { Components, Options } from "react-markdown";
import remarkGfm from "remark-gfm";

const INLINE_CODE_CLASS =
  "rounded-[5px] bg-[rgba(175,184,193,0.22)] px-[5px] py-px font-mono text-[0.87em]";

const CODE_BLOCK_CLASS =
  "my-3 overflow-x-auto rounded-lg border border-[#d8dee4] bg-[#f6f8fa] p-3 font-mono text-[12px] leading-[1.55] text-[#1f2328]";

const HEADING_CLASS =
  "mt-3 mb-1.5 text-[14.5px] font-semibold text-ink first:mt-0";

const SUBHEADING_CLASS =
  "mt-2.5 mb-1 text-[13.5px] font-semibold text-ink first:mt-0";

const REMARK_PLUGINS: Options["remarkPlugins"] = [
  [remarkGfm, { singleTilde: false }],
];

const REMARK_REHYPE_OPTIONS: Options["remarkRehypeOptions"] = {
  footnoteLabelTagName: "h4",
};

function withClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

const BLOCK_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="mb-3 text-[13.5px] leading-[1.65] text-ink-soft [text-wrap:pretty]">
      {children}
    </p>
  ),
  h1: ({ children, className, id }) => (
    <h4 id={id} className={withClass(HEADING_CLASS, className)}>
      {children}
    </h4>
  ),
  h2: ({ children, className, id }) => (
    <h4 id={id} className={withClass(HEADING_CLASS, className)}>
      {children}
    </h4>
  ),
  h3: ({ children, className, id }) => (
    <h5 id={id} className={withClass(SUBHEADING_CLASS, className)}>
      {children}
    </h5>
  ),
  h4: ({ children, className, id }) => (
    <h5 id={id} className={withClass(SUBHEADING_CLASS, className)}>
      {children}
    </h5>
  ),
  h5: ({ children, className, id }) => (
    <h5 id={id} className={withClass(SUBHEADING_CLASS, className)}>
      {children}
    </h5>
  ),
  h6: ({ children, className, id }) => (
    <h5 id={id} className={withClass(SUBHEADING_CLASS, className)}>
      {children}
    </h5>
  ),
  code: ({ className, children }) => {
    const isBlock =
      /language-/.test(className ?? "") ||
      !children ||
      (typeof children === "string" && children.includes("\n"));
    return isBlock ? (
      <code className="font-mono">{children}</code>
    ) : (
      <code className={INLINE_CODE_CLASS}>{children}</code>
    );
  },
  pre: ({ children }) => <pre className={CODE_BLOCK_CLASS}>{children}</pre>,
  a: ({
    href,
    children,
    id,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
  }) => {
    const external = !href?.startsWith("#");
    return (
      <a
        id={id}
        href={href}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="text-link hover:underline"
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l border-border pl-3 text-muted [&_p]:text-muted [&_p:last-child]:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-t border-border" />,
  ul: ({ children }) => (
    <ul className="mb-3 list-disc pl-5 text-[13.5px] leading-[1.65] text-ink-soft">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal pl-5 text-[13.5px] leading-[1.65] text-ink-soft">
      {children}
    </ol>
  ),
  li: ({ className, children, id }) => {
    const isTask = (className ?? "").includes("task-list-item");
    return (
      <li id={id} className={isTask ? "mb-1 list-none" : "mb-1"}>
        {children}
      </li>
    );
  },
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-[#d8dee4]">
      <table className="w-full text-[13px] leading-[1.55] text-ink-soft [&>tbody>tr:last-child]:border-0">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#f6f8fa]">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-b border-[#d8dee4]">{children}</tr>
  ),
  th: ({ style, children }) => (
    <th style={style} className="px-3 py-1.5 text-left font-semibold text-ink">
      {children}
    </th>
  ),
  td: ({ style, children }) => (
    <td style={style} className="px-3 py-1.5 align-top">
      {children}
    </td>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  del: ({ children }) => (
    <del className="text-muted line-through">{children}</del>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={BLOCK_COMPONENTS}
      remarkPlugins={REMARK_PLUGINS}
      remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
    >
      {children}
    </ReactMarkdown>
  );
}

const INLINE_ALLOWED_ELEMENTS = ["a", "br", "code", "del", "em", "p", "strong"];

const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  code: ({ children }) => <code className={INLINE_CODE_CLASS}>{children}</code>,
  em: ({ children }) => <em>{children}</em>,
  strong: BLOCK_COMPONENTS.strong,
  del: BLOCK_COMPONENTS.del,
  a: BLOCK_COMPONENTS.a,
};

export function MarkdownInline({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={INLINE_COMPONENTS}
      remarkPlugins={REMARK_PLUGINS}
      allowedElements={INLINE_ALLOWED_ELEMENTS}
      unwrapDisallowed
    >
      {children}
    </ReactMarkdown>
  );
}
