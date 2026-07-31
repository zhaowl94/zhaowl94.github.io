(function initializePortfolio(globalObject) {
  "use strict";

  const DEFAULT_LANGUAGE = "zh";
  const SUPPORTED_LANGUAGES = new Set(["zh", "en"]);

  function normalizeLanguage(value) {
    return SUPPORTED_LANGUAGES.has(value) ? value : DEFAULT_LANGUAGE;
  }

  function languageFromSearch(search) {
    const parameters = new URLSearchParams(search || "");
    return normalizeLanguage(parameters.get("lang"));
  }

  function languageUrl(href, language) {
    const url = new URL(href);
    url.searchParams.set("lang", normalizeLanguage(language));
    return url.href;
  }

  function setMetaDescription(documentObject, language) {
    const description = documentObject.querySelector(
      'meta[name="description"]',
    );

    if (!description) {
      return;
    }

    const content =
      language === "en"
        ? description.dataset.metaEn
        : description.dataset.metaZh;

    if (content) {
      description.setAttribute("content", content);
    }
  }

  function setDocumentTitle(documentObject, language) {
    const title = documentObject.querySelector("title");

    if (!title) {
      return;
    }

    const content =
      language === "en" ? title.dataset.titleEn : title.dataset.titleZh;

    if (content) {
      documentObject.title = content;
    }
  }

  function applyLanguage(documentObject, language) {
    const selectedLanguage = normalizeLanguage(language);

    documentObject.documentElement.lang =
      selectedLanguage === "en" ? "en" : "zh-CN";
    documentObject.documentElement.classList.remove("no-js");
    documentObject.documentElement.dataset.language = selectedLanguage;

    for (const element of documentObject.querySelectorAll(
      "[data-lang-content]",
    )) {
      element.hidden = element.dataset.langContent !== selectedLanguage;
    }

    for (const link of documentObject.querySelectorAll(
      "[data-language-link]",
    )) {
      const active = link.dataset.languageLink === selectedLanguage;

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }

    setDocumentTitle(documentObject, selectedLanguage);
    setMetaDescription(documentObject, selectedLanguage);

    const status = documentObject.querySelector("#language-status");
    if (status) {
      status.textContent =
        selectedLanguage === "en"
          ? "Language changed to English."
          : "语言已切换为中文。";
    }

    return selectedLanguage;
  }

  function updateLanguageLinks(documentObject, href) {
    for (const link of documentObject.querySelectorAll(
      "[data-language-link]",
    )) {
      link.href = languageUrl(href, link.dataset.languageLink);
    }
  }

  function start(documentObject, locationObject, historyObject) {
    const initialLanguage = languageFromSearch(locationObject.search);
    applyLanguage(documentObject, initialLanguage);
    updateLanguageLinks(documentObject, locationObject.href);

    for (const link of documentObject.querySelectorAll(
      "[data-language-link]",
    )) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const selectedLanguage = normalizeLanguage(link.dataset.languageLink);
        const nextUrl = languageUrl(locationObject.href, selectedLanguage);

        try {
          historyObject.pushState({ language: selectedLanguage }, "", nextUrl);
          applyLanguage(documentObject, selectedLanguage);
          updateLanguageLinks(documentObject, nextUrl);
        } catch {
          locationObject.assign(nextUrl);
        }
      });
    }

    globalObject.addEventListener("popstate", () => {
      const selectedLanguage = languageFromSearch(locationObject.search);
      applyLanguage(documentObject, selectedLanguage);
      updateLanguageLinks(documentObject, locationObject.href);
    });
  }

  const publicApi = Object.freeze({
    applyLanguage,
    languageFromSearch,
    languageUrl,
    normalizeLanguage,
  });

  globalObject.PortfolioLanguage = publicApi;

  if (
    typeof document !== "undefined" &&
    typeof location !== "undefined" &&
    typeof history !== "undefined"
  ) {
    start(document, location, history);
  }
})(globalThis);
