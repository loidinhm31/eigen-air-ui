import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const MAX_MARKDOWN_BYTES = 262_144;

interface Props {
  content: string;
}

interface BoundedContent {
  content: string;
  truncated: boolean;
}

function boundUtf8Content(content: string): BoundedContent {
  let byteLength = 0;
  const characters: string[] = [];

  for (const character of content) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;

    if (byteLength + characterBytes > MAX_MARKDOWN_BYTES) {
      return { content: characters.join(""), truncated: true };
    }

    characters.push(character);
    byteLength += characterBytes;
  }

  return { content, truncated: false };
}

function isSafeExternalLink(href: string | undefined): href is string {
  if (!href || !/^https?:\/\//i.test(href)) {
    return false;
  }

  try {
    const url = new URL(href);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function AssistantMarkdown({ content }: Props) {
  const bounded = boundUtf8Content(content);

  return (
    <div className="min-w-0 break-words leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return isSafeExternalLink(href) ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 focus-visible:ring-ring underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          img({ alt }) {
            return <span>{alt ?? ""}</span>;
          },
          pre({ children }) {
            return (
              <pre className="border-secondary-foreground/15 bg-background/50 my-3 max-w-full overflow-x-auto whitespace-pre rounded-md border p-3 text-xs leading-relaxed">
                {children}
              </pre>
            );
          },
          code({ className, children, ...props }) {
            return (
              <code
                {...props}
                className={
                  className ?? "bg-background/50 rounded px-1 py-0.5 font-mono text-[0.9em]"
                }
              >
                {children}
              </code>
            );
          },
          table({ children }) {
            return (
              <div className="my-3 max-w-full overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border-secondary-foreground/15 bg-background/35 border px-2 py-1.5 font-semibold">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border-secondary-foreground/15 border px-2 py-1.5 align-top">
                {children}
              </td>
            );
          },
        }}
      >
        {bounded.content}
      </ReactMarkdown>
      {bounded.truncated && (
        <p role="status" aria-live="polite" className="text-secondary-foreground/70 mt-2 text-xs">
          Response truncated for display at 256 KB.
        </p>
      )}
    </div>
  );
}

AssistantMarkdown.displayName = "AssistantMarkdown";
