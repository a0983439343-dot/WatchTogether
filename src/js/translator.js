(() => {
  "use strict";

  const cache = new Map();
  const localeMap = {
    "zh-TW":"zh-TW",
    "zh-CN":"zh-CN",
    "en":"en",
    "ja":"ja",
    "ko":"ko",
    "es":"es",
    "fr":"fr",
    "de":"de",
    "pt-BR":"pt-BR",
    "ru":"ru",
    "it":"it",
    "th":"th",
    "vi":"vi",
    "id":"id",
    "tr":"tr",
    "ar":"ar"
  };

  function apiUrl() {
    const configured = String(window.WATCHTOGETHER_CONFIG?.aiBugDetectorUrl || "").trim();
    if (configured.endsWith("/ai/analyze")) {
      return configured.slice(0, -"/ai/analyze".length) + "/ai/translate";
    }
    const base = configured.replace(//+$/, "");
    return base ? base + "/ai/translate" : "";
  }

  function targetLanguage() {
    const locale = String(window.WT_I18N?.getLocale?.() || document.documentElement.lang || "zh-TW");
    return localeMap[locale] || "zh-TW";
  }

  async function translateMessage(button) {
    if (!button) return;
    const messageId = String(button.dataset.chatTranslate || "").trim();
    const original = String(button.dataset.chatOriginal || "");
    const target = targetLanguage();
    const host = button.parentElement?.querySelector(".wt2-chat-translation");
    if (!original || !host) return;

    const key = messageId + "|" + target + "|" + original;
    if (cache.has(key)) {
      host.textContent = cache.get(key);
      host.classList.add("show");
      button.textContent = "[隱藏翻譯]";
      button.dataset.translated = "1";
      return;
    }

    if (button.dataset.translated === "1") {
      host.classList.remove("show");
      button.textContent = "[翻譯]";
      button.dataset.translated = "0";
      return;
    }

    const url = apiUrl();
    if (!url) {
      host.textContent = "翻譯服務尚未設定。";
      host.classList.add("show");
      return;
    }

    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "[翻譯中…]";

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: original,
          targetLanguage: target
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true) {
        throw new Error(String(data?.error || "翻譯失敗").slice(0, 180));
      }

      const translated = String(data.translatedText || "").trim();
      if (!translated) throw new Error("翻譯結果為空");

      cache.set(key, translated);
      host.textContent = translated;
      host.classList.add("show");
      button.dataset.translated = "1";
      button.textContent = "[隱藏翻譯]";
    } catch (error) {
      host.textContent = error?.message || "翻譯失敗，請稍後再試。";
      host.classList.add("show");
      button.textContent = oldText;
    } finally {
      button.disabled = false;
    }
  }

  window.WT2_TRANSLATOR = {
    translateMessage,
    clearCache() { cache.clear(); }
  };
})();