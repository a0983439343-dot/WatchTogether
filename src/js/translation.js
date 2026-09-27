(() => {
  "use strict";

  const memoryCache = new Map();
  const $ = id => document.getElementById(id);

  function getConfig(){
    return window.WATCHTOGETHER_CONFIG || {};
  }

  function targetLanguage(){
    const map = {
      "zh-Hant":"zh-TW",
      "zh-TW":"zh-TW",
      "zh-HK":"zh-TW",
      "zh":"zh-TW",
      "zh-CN":"zh-CN",
      "en":"en",
      "ja":"ja",
      "ko":"ko",
      "es":"es",
      "fr":"fr",
      "de":"de",
      "pt-BR":"pt-BR",
      "pt":"pt-BR",
      "ru":"ru",
      "it":"it",
      "th":"th",
      "vi":"vi",
      "id":"id",
      "tr":"tr",
      "ar":"ar"
    };
    const i18nLocale = String(
      window.WT_I18N?.getMode?.() ||
      window.WT_I18N?.getLocale?.() ||
      ""
    ).trim();
    const lang = String(
      localStorage.getItem("wt2_translation_target") ||
      i18nLocale ||
      document.documentElement.lang ||
      "zh-Hant"
    ).trim();
    return map[lang] || lang.slice(0,8) || "zh";
  }

  function cacheKey(text, target){
    return target + "::" + text;
  }

  async function getIdToken(){
    const auth = window.firebase?.auth?.();
    const user = auth?.currentUser;
    if(!user || user.isAnonymous) throw new Error("Google 登入後才能使用翻譯功能");
    return user.getIdToken();
  }

  async function translate(text){
    if (window.WT_ENHANCEMENTS?.isFeatureBlocked && await window.WT_ENHANCEMENTS.isFeatureBlocked("translation")) {
      throw new Error("你的帳號目前無法使用聊天翻譯");
    }
    const source = String(text || "").trim().slice(0,2000);
    if(!source) throw new Error("沒有可翻譯的內容");

    const config = getConfig();
    const endpoint = String(config.translationUrl || "").trim().replace(/\/+$/,"");
    if(!endpoint) throw new Error("翻譯服務尚未設定");

    const target = targetLanguage();
    const key = cacheKey(source,target);
    if(memoryCache.has(key)) return memoryCache.get(key);

    const token = await getIdToken();
    const response = await fetch(endpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+token
      },
      body:JSON.stringify({
        text:source,
        targetLanguage:target
      })
    });

    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(String(data?.error?.message || "翻譯服務失敗"));

    const translated = String(data?.translatedText || "").trim();
    if(!translated) throw new Error("翻譯服務沒有返回內容");

    memoryCache.set(key,translated);
    return translated;
  }

  async function translateMessage(button){
    const messageId=String(button?.dataset?.chatTranslate || "");
    const article=document.getElementById("chat-message-"+messageId);
    const original=String(button?.dataset?.chatOriginal || "");
    const panel=article?.querySelector(".wt2-chat-translation");
    if(!messageId||!article||!original||!panel)return;

    if(panel.classList.contains("show")){
      panel.classList.remove("show");
      button.textContent="[翻譯]";
      return;
    }

    button.disabled=true;
    button.textContent="翻譯中…";
    try{
      const translated=await translate(original);
      panel.innerHTML="<small>翻譯</small><div>"+escapeHtml(translated)+"</div>";
      panel.classList.add("show");
      button.textContent="[收起翻譯]";
    }catch(error){
      panel.innerHTML="<small>翻譯失敗</small><div>"+escapeHtml(error?.message||"無法翻譯")+"</div>";
      panel.classList.add("show","error");
      button.textContent="[翻譯]";
    }finally{
      button.disabled=false;
    }
  }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  window.WT2_TRANSLATOR = {
    translate,
    translateMessage,
    targetLanguage,
    clearCache(){memoryCache.clear();}
  };
})();