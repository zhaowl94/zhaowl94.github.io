import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = await readFile(
  path.join(projectRoot, "assets/scripts/site.js"),
  "utf8",
);
const context = vm.createContext({ URL, URLSearchParams });
vm.runInContext(source, context);
const language = context.PortfolioLanguage;

test("browser script exposes a frozen language API", () => {
  assert.equal(typeof language.applyLanguage, "function");
  assert.equal(Object.isFrozen(language), true);
});

test("normalizes supported languages", () => {
  assert.equal(language.normalizeLanguage("zh"), "zh");
  assert.equal(language.normalizeLanguage("en"), "en");
});

test("falls back to Chinese for missing or unsupported languages", () => {
  assert.equal(language.normalizeLanguage(null), "zh");
  assert.equal(language.normalizeLanguage("fr"), "zh");
});

test("reads a valid language from a query string", () => {
  assert.equal(language.languageFromSearch("?lang=en"), "en");
  assert.equal(language.languageFromSearch("?view=all&lang=zh"), "zh");
});

test("rejects unsupported query-language values", () => {
  assert.equal(language.languageFromSearch("?lang=EN"), "zh");
  assert.equal(language.languageFromSearch("?lang=private"), "zh");
});

test("builds a shareable language URL without dropping other state", () => {
  assert.equal(
    language.languageUrl("https://zhaowl94.github.io/?view=all#projects", "en"),
    "https://zhaowl94.github.io/?view=all&lang=en#projects",
  );
});

test("language URLs also work with direct file paths", () => {
  assert.equal(
    language.languageUrl("file:///D:/portfolio/index.html#projects", "en"),
    "file:///D:/portfolio/index.html?lang=en#projects",
  );
});

test("unsupported language URLs safely fall back to Chinese", () => {
  assert.equal(
    language.languageUrl("https://zhaowl94.github.io/", "de"),
    "https://zhaowl94.github.io/?lang=zh",
  );
});
