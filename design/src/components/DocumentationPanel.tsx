import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import {
  documentationSearchText,
  resolveDocumentationArticleId,
  searchDocumentation,
  validateDocumentationQuery,
  type DocumentationQuery,
} from "@shared/documentation";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";
import { DOCUMENTATION_ARTICLES } from "../generated/documentationArticles";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import { DocumentIcon } from "./icons";
import RegexBuilder from "./RegexBuilder";
import MarkdownRenderer from "./MarkdownRenderer";

const DEFAULT_ARTICLE_ID = "features/site/landing-and-documentation-site.md";

export default function DocumentationPanel() {
  const settings = useAppStore((state) => state.settings);
  const copy = useMemo(
    () => getUiCopy(settings),
    [settings?.funnyLevelCantonese, settings?.funnyLevelEnglish, settings?.languageMode],
  );
  const [builder, setBuilder] = useState<RegexBuilderState>(() => createDefaultRegexBuilderState());
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(
    DOCUMENTATION_ARTICLES.some((article) => article.id === DEFAULT_ARTICLE_ID)
      ? DEFAULT_ARTICLE_ID
      : DOCUMENTATION_ARTICLES[0]?.id ?? "",
  );
  const builderButtonRef = useRef<HTMLButtonElement>(null);
  const previousBuilderOpen = useRef(false);
  const articleIds = useMemo(() => new Set(DOCUMENTATION_ARTICLES.map((article) => article.id)), []);
  const query = useMemo<DocumentationQuery>(() => ({
    mode: builder.mode,
    pattern: builder.pattern,
    flags: builder.flags,
  }), [builder.flags, builder.mode, builder.pattern]);
  const documentationSamples = useMemo(
    () => DOCUMENTATION_ARTICLES.map(documentationSearchText),
    []
  );
  const regexBatch = useIsolatedRegexBatch(
    query.pattern,
    query.flags,
    documentationSamples,
    query.mode === "regex" && query.pattern.length > 0,
  );
  const queryError = validateDocumentationQuery(query) ?? (regexBatch.pending ? null : regexBatch.error);
  const queryErrorText = queryError ? localizedRegexEvaluationError(queryError, copy.text) : null;
  const results = useMemo(
    () => {
      if (queryError) return [];
      if (query.mode !== "regex" || query.pattern.length === 0) {
        return searchDocumentation(DOCUMENTATION_ARTICLES, query);
      }
      if (!regexBatch.evaluations) return [];
      return DOCUMENTATION_ARTICLES.filter(
        (_, index) => (regexBatch.evaluations?.[index]?.matches.length ?? 0) > 0
      );
    },
    [query, queryError, regexBatch.evaluations],
  );
  const selectedArticle = DOCUMENTATION_ARTICLES.find((article) => article.id === selectedId) ?? DOCUMENTATION_ARTICLES[0] ?? null;

  useLayoutEffect(() => {
    if (previousBuilderOpen.current && !builderOpen) builderButtonRef.current?.focus({ preventScroll: true });
    previousBuilderOpen.current = builderOpen;
  }, [builderOpen]);

  function navigate(href: string): boolean {
    if (!selectedArticle) return false;
    const target = resolveDocumentationArticleId(selectedArticle.sourcePath, href, articleIds);
    if (!target) return false;
    setSelectedId(target);
    return true;
  }

  const resultSummary = regexBatch.pending
    ? copy.text("Evaluating safely…", "安全評估緊…")
    : query.pattern
    ? copy.text(`${results.length} matching bundled article${results.length === 1 ? "" : "s"}`, `${results.length} 篇內置文章相符`)
    : copy.text(`${DOCUMENTATION_ARTICLES.length} bundled articles`, `內置 ${DOCUMENTATION_ARTICLES.length} 篇文章`);

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !builderOpen) return;
    event.preventDefault();
    event.stopPropagation();
    setBuilderOpen(false);
  }

  return (
    <section className="documentation-panel" aria-labelledby="documentation-panel-heading" onKeyDown={handlePanelKeyDown}>
      <header className="documentation-panel-header">
        <div className="documentation-panel-title">
          <DocumentIcon size={18} />
          <div>
            <h1 id="documentation-panel-heading">{copy.text("Documentation", "文件")}</h1>
            <p>{copy.text("Feature articles are bundled for offline reading; links between articles stay inside the app.", "功能文章已內置，離線都睇到；文章之間嘅連結會留喺程式入面。")}</p>
          </div>
        </div>
        <span className="documentation-count" aria-live="polite">{resultSummary}</span>
      </header>

      <div className="documentation-search">
        <label className="documentation-search-label" htmlFor="documentation-search-input">{copy.text("Search documentation", "搜尋文件")}</label>
        <div className="documentation-search-row">
          <input
            id="documentation-search-input"
            className="input"
            type="search"
            value={builder.pattern}
            placeholder={copy.text("Search article titles and content", "搜尋文章標題同內容")}
            aria-label={copy.text("Search documentation articles", "搜尋文件文章")}
            aria-busy={regexBatch.pending || undefined}
            aria-invalid={queryErrorText ? true : undefined}
            aria-describedby={queryErrorText ? "documentation-search-error" : regexBatch.pending ? "documentation-search-pending" : undefined}
            onChange={(event) => setBuilder((state) => ({ ...state, pattern: event.target.value }))}
          />
          <button
            ref={builderButtonRef}
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={builderOpen}
            aria-controls="documentation-search-builder"
            onClick={() => setBuilderOpen((open) => !open)}
          >
            {copy.text("Regex", "正則")}
          </button>
        </div>
        {builderOpen && (
          <div id="documentation-search-builder" className="documentation-search-builder">
            <RegexBuilder
              title={copy.text("Documentation regex builder", "文件正則建立器")}
              value={{ ...builder, sample: selectedArticle?.body ?? "" }}
              onChange={setBuilder}
              text={copy.text}
            />
          </div>
        )}
        {queryErrorText && <p id="documentation-search-error" className="field-error documentation-search-error" role="alert">{queryErrorText}</p>}
        {!queryErrorText && regexBatch.pending && (
          <p id="documentation-search-pending" className="setting-helper documentation-search-error" role="status">
            {copy.text("Evaluating safely…", "安全評估緊…")}
          </p>
        )}
      </div>

      <div className="documentation-layout">
        <aside className="documentation-index" aria-label={copy.text("Documentation article index", "文件文章索引")} aria-busy={regexBatch.pending || undefined}>
          <div className="documentation-index-heading">
            <strong>{copy.text("Articles", "文章")}</strong>
            <span>{results.length}/{DOCUMENTATION_ARTICLES.length}</span>
          </div>
          {regexBatch.pending ? (
            <p className="documentation-empty" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p>
          ) : results.length === 0 ? (
            <p className="documentation-empty" role="status">{copy.funny(
              ["No bundled articles match the active search.", "No bundled articles match; the shelf is being picky.", "No bundled articles match — the article shelf has gone quiet.", "No bundled articles match; even the index found no alibi.", "No bundled articles match — the documentation cupboard is theatrically empty."],
              ["目前搜尋搵唔到相符嘅內置文章。", "目前搵唔到相符文章，個架揀得幾嚴喎。", "目前搵唔到相符文章，文章架靜晒喇。", "目前搵唔到相符文章，連索引都冇口供。", "目前搵唔到相符文章，文件櫃隆重咁空空如也。"],
            )}</p>
          ) : (
            <ul className="documentation-article-list">
              {results.map((article) => (
                <li key={article.id}>
                  <button
                    type="button"
                    className={article.id === selectedArticle?.id ? "active" : ""}
                    aria-current={article.id === selectedArticle?.id ? "page" : undefined}
                    onClick={() => setSelectedId(article.id)}
                  >
                    <strong>{article.title}</strong>
                    <small>{article.category}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <article className="documentation-article" aria-live="polite">
          {selectedArticle ? (
            <>
              <header className="documentation-article-header">
                <p className="documentation-article-category">{selectedArticle.category}</p>
                <h2>{selectedArticle.title}</h2>
                <code>{selectedArticle.sourcePath}</code>
              </header>
              <MarkdownRenderer article={selectedArticle} onNavigate={navigate} />
            </>
          ) : (
            <p className="documentation-empty" role="status">{copy.text("No documentation articles are bundled.", "暫時未有內置文件文章。")}</p>
          )}
        </article>
      </div>
    </section>
  );
}
