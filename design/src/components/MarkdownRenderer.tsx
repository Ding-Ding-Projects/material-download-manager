import type { ReactNode } from "react";
import { isSafeDocumentationHref, type DocumentationArticle } from "@shared/documentation";

interface MarkdownRendererProps {
  article: DocumentationArticle;
  onNavigate: (href: string) => boolean;
}

function inlineNodes(value: string, onNavigate: (href: string) => boolean): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`\n]+`|\[[^\]\n]+\]\([^\)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/gu;
  let cursor = 0;
  let key = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(value.slice(cursor, index));
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`inline-${key++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[") && token.includes("](")) {
      const separator = token.indexOf("](");
      const label = token.slice(1, separator);
      const href = token.slice(separator + 2, -1);
      if (!isSafeDocumentationHref(href)) {
        nodes.push(<span key={`inline-${key++}`}>{inlineNodes(label, onNavigate)}</span>);
        cursor = index + token.length;
        continue;
      }
      const external = /^(?:https?:|mailto:)/i.test(href);
      nodes.push(
        <a
          key={`inline-${key++}`}
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
          onClick={(event) => {
            if (!external && onNavigate(href)) event.preventDefault();
          }}
        >
          {inlineNodes(label, onNavigate)}
        </a>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`inline-${key++}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={`inline-${key++}`}>{token.slice(1, -1)}</em>);
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function isBlockStart(line: string): boolean {
  return /^(?:#{1,6}\s|[-*]\s|\d+\.\s|>\s|```|~~~)/u.test(line);
}

export default function MarkdownRenderer({ article, onNavigate }: MarkdownRendererProps) {
  const lines = article.body.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^(?<marker>`{3,}|~{3,})(?<language>.*)$/u);
    if (fence?.groups) {
      const marker = fence.groups.marker;
      const language = fence.groups.language.trim();
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith(marker[0].repeat(marker.length))) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`block-${blockKey++}`}>
          <code className={language ? `language-${language}` : undefined}>{content.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const Heading = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(<Heading key={`block-${blockKey++}`}>{inlineNodes(heading[2], onNavigate)}</Heading>);
      index += 1;
      continue;
    }

    if (/^(?:[-*]\s|\d+\.\s)/u.test(line)) {
      const ordered = /^\d+\.\s/u.test(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? /^\d+\.\s/u.test(lines[index]) : /^[-*]\s/u.test(lines[index]))) {
        items.push(lines[index].replace(ordered ? /^\d+\.\s/u : /^[-*]\s/u, ""));
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={`block-${blockKey++}`}>
          {items.map((item, itemIndex) => <li key={`item-${itemIndex}`}>{inlineNodes(item, onNavigate)}</li>)}
        </List>,
      );
      continue;
    }

    if (line.startsWith("> ") || line === ">") {
      const quote: string[] = [];
      while (index < lines.length && (lines[index].startsWith("> ") || lines[index] === ">")) {
        quote.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`block-${blockKey++}`}>{inlineNodes(quote.join(" "), onNavigate)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`block-${blockKey++}`}>{inlineNodes(paragraph.join(" "), onNavigate)}</p>);
  }

  return <div className="documentation-markdown">{blocks}</div>;
}
