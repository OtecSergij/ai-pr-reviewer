import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

const INLINE_CODE_CLASS =
  "rounded-[5px] bg-[rgba(175,184,193,0.22)] px-[5px] py-px font-mono text-[0.87em]";

const CODE_BLOCK_CLASS =
  "my-3 overflow-x-auto rounded-lg border border-[#d8dee4] bg-[#f6f8fa] p-3 font-mono text-[12px] leading-[1.55] text-[#1f2328]";

const BLOCK_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="mb-3 text-[13.5px] leading-[1.65] text-ink-soft [text-wrap:pretty]">
      {children}
    </p>
  ),
  code: ({ className, children }) => {
    const isBlock =
      /language-/.test(className ?? "") ||
      (typeof children === "string" && children.includes("\n"));
    return isBlock ? (
      <code className="font-mono">{children}</code>
    ) : (
      <code className={INLINE_CODE_CLASS}>{children}</code>
    );
  },
  pre: ({ children }) => <pre className={CODE_BLOCK_CLASS}>{children}</pre>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-link hover:underline"
    >
      {children}
    </a>
  ),
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
  li: ({ children }) => <li className="mb-1">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown components={BLOCK_COMPONENTS}>{children}</ReactMarkdown>
  );
}

const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  code: ({ children }) => <code className={INLINE_CODE_CLASS}>{children}</code>,
  em: ({ children }) => <em>{children}</em>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
};

export function MarkdownInline({ children }: { children: string }) {
  return (
    <ReactMarkdown components={INLINE_COMPONENTS}>{children}</ReactMarkdown>
  );
}
