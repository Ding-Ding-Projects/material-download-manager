import { evaluateRegex, validateRegexPattern } from "./regex";

export interface DocumentationArticle {
  id: string;
  sourcePath: string;
  category: string;
  title: string;
  body: string;
}

export interface DocumentationQuery {
  mode: "text" | "regex";
  pattern: string;
  flags: string;
}

export function documentationSearchText(article: DocumentationArticle): string {
  return `${article.title}\n${article.sourcePath}\n${article.body}`;
}

export function isSafeDocumentationHref(href: string): boolean {
  const value = href.trim();
  if (!value || /^(?:javascript|data|file|vbscript):/iu.test(value)) return false;
  if (/^(?:https?:|mailto:)/iu.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) return false;
  return !/^(?:\/\/|[\\/]|#)/u.test(value);
}

export function validateDocumentationQuery(query: DocumentationQuery): string | null {
  if (query.mode !== "regex" || query.pattern.length === 0) return null;
  return validateRegexPattern(query.pattern, query.flags);
}

export function searchDocumentation(
  articles: readonly DocumentationArticle[],
  query: DocumentationQuery,
): DocumentationArticle[] {
  if (!query.pattern) return [...articles];
  const result: DocumentationArticle[] = [];
  for (const article of articles) {
    const haystack = documentationSearchText(article);
    if (query.mode === "text") {
      if (haystack.toLocaleLowerCase().includes(query.pattern.toLocaleLowerCase())) result.push(article);
      continue;
    }
    const evaluated = evaluateRegex(query.pattern, query.flags || "gi", haystack);
    if (!evaluated.error && evaluated.matches.length > 0) result.push(article);
  }
  return result;
}

function normalizePath(sourcePath: string, href: string): string {
  const segments = [...sourcePath.split("/").slice(0, -1), ...href.split("/")];
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join("/");
}

export function resolveDocumentationArticleId(
  sourcePath: string,
  href: string,
  articleIds: ReadonlySet<string>,
): string | null {
  if (/^(?:https?:|mailto:|#|\/)/i.test(href)) return null;
  const withoutFragment = href.split(/[?#]/, 1)[0];
  if (!withoutFragment.toLocaleLowerCase().endsWith(".md")) return null;
  const candidate = normalizePath(sourcePath, withoutFragment);
  return articleIds.has(candidate) ? candidate : null;
}
