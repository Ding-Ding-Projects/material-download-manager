import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeDocumentationHref,
  resolveDocumentationArticleId,
  searchDocumentation,
  validateDocumentationQuery,
  type DocumentationArticle,
} from "../../shared/documentation";

const articles: readonly DocumentationArticle[] = [
  {
    id: "features/documentation/in-app-documentation-browser.md",
    sourcePath: "features/documentation/in-app-documentation-browser.md",
    category: "documentation",
    title: "In-app documentation browser",
    body: "Offline Markdown article links resolve inside the app.",
  },
  {
    id: "features/search/regex-builder.md",
    sourcePath: "features/search/regex-builder.md",
    category: "search",
    title: "Regex builder",
    body: "The JavaScript RegExp builder is local and bounded.",
  },
];

test("documentation relative links resolve to the bundled article id", () => {
  const ids = new Set(articles.map((article) => article.id));
  assert.equal(
    resolveDocumentationArticleId(
      articles[0].sourcePath,
      "../search/regex-builder.md#behavior",
      ids,
    ),
    "features/search/regex-builder.md",
  );
  assert.equal(resolveDocumentationArticleId(articles[0].sourcePath, "https://example.com/docs.md", ids), null);
  assert.equal(resolveDocumentationArticleId(articles[0].sourcePath, "../missing.md", ids), null);
});

test("documentation search is plain-text-first and supports bounded regex", () => {
  assert.deepEqual(
    searchDocumentation(articles, { mode: "text", pattern: "offline", flags: "g" }).map((article) => article.id),
    ["features/documentation/in-app-documentation-browser.md"],
  );
  assert.deepEqual(
    searchDocumentation(articles, { mode: "regex", pattern: "RegExp|Markdown", flags: "gi" }).map((article) => article.id),
    articles.map((article) => article.id),
  );
  assert.equal(validateDocumentationQuery({ mode: "regex", pattern: "(", flags: "g" }) !== null, true);
  assert.deepEqual(searchDocumentation(articles, { mode: "regex", pattern: "(", flags: "g" }), []);
});

test("documentation links reject executable and absolute local protocols", () => {
  assert.equal(isSafeDocumentationHref("javascript:alert(1)"), false);
  assert.equal(isSafeDocumentationHref("data:text/html,hello"), false);
  assert.equal(isSafeDocumentationHref("file:///C:/secret.txt"), false);
  assert.equal(isSafeDocumentationHref("//example.test/redirect"), false);
  assert.equal(isSafeDocumentationHref("../navigation/tabbed-navigation.md"), true);
  assert.equal(isSafeDocumentationHref("https://example.test/docs"), true);
});
