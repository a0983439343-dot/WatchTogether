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
    const configured=String(window.WATCHTOGETHER_CONFIG?.translationUrl||"").trim();
    if(configured)return configured;
    const fallback=String(window.WATCHTOGETHER_CONFIG?.aiBugDetectorUrl||"").trim();
    if(fallback.endsWith("/ai/analyze"))return fallback.slice(0,-"/ai/analyze".length)+"/ai/translate";
    const base=fallback.replace(/\/+$/,"");
    return base?base+"/ai/translate":"";
  }

  function targetLanguage() {
    const locale = String(window.WT_I18N?.getLocale?.() || document.documentElement.lang || "zh-TW");
    return localeMap[locale] || "zh-TW";
  }

  async function translateMessage(button) {
    if (!button) return;
    if (window.WT_ENHANCEMENTS?.isFeatureBlocked && await window.WT_ENHANCEMENTS.isFeatureBlocked("translation")) {
      const host = button.parentElement?.querySelector(".wt2-chat-translation");
      if (host) {
        host.textContent = "你的帳號目前無法使用聊天翻譯。";
        host.classList.add("show","error");
      }
      return;
    }
    const messageId = String(button.dataset.chatTranslate || "").trim();
    const original = String(button.dataset.chatOriginal || "");
    const target = targetLanguage();
    const host = button.parentElement?.querySelector(".wt2-chat-translation");
    if (!original || !host) return;

    const key = messageId + "|" + target + "|" + original;
    if (button.dataset.translated === "1") {
      host.classList.remove("show");
      button.textContent = "[翻譯]";
      button.dataset.translated = "0";
      return;
    }

    if (cache.has(key)) {
      host.textContent = cache.get(key);
      host.classList.add("show");
      button.textContent = "[隱藏翻譯]";
      button.dataset.translated = "1";
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
      const headers = {
        "Content-Type": "application/json"
      };
      try {
        const user = window.firebase?.auth?.().currentUser;
        if (user && !user.isAnonymous && typeof user.getIdToken === "function") {
          headers.Authorization = "Bearer " + await user.getIdToken();
        }
      } catch (_) {}

      const response = await fetch(url, {
        method: "POST",
        headers,
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