(() => {
  "use strict";

  let history = [];
  const $ = (id) => document.getElementById(id);

  function context() {
    return window.WT_ADMIN_CONTEXT || null;
  }

  function endpoint() {
    const cfg = window.WATCHTOGETHER_CONFIG || {};
    const raw = String(cfg.adminControlUrl || cfg.aiBugDetectorUrl || cfg.youtubeStreamProxyUrl || "").trim();
    if (!raw) return "";
    if (/\/ai\/analyze\/?$/.test(raw)) return raw.replace(/\/ai\/analyze\/?$/, "/agent");
    return raw.replace(/\/+$/, "") + "/agent";
  }

  async function token() {
    const user = window.firebase?.auth?.().currentUser;
    if (!user || user.isAnonymous) throw new Error("請先登入管理員帳號");
    return user.getIdToken();
  }

  function render(text, kind = "assistant") {
    const output = $("aiAgentChat");
    if (!output) return;
    const item = document.createElement("div");
    item.className = "ai-agent-message " + kind;
    item.textContent = String(text || "");
    output.appendChild(item);
    output.scrollTop = output.scrollHeight;
  }

  function renderAction(action, args, needsConfirmation) {
    const box = $("aiAgentAction");
    if (!box) return;
    if (!action || action === "none") {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    box.classList.remove("hidden");
    box.textContent =
      "建議操作： " + action + "\n" +
      "參數： " + JSON.stringify(args || {}, null, 2) + "\n" +
      (needsConfirmation ? "需要你確認後才會執行。" : "此操作不需要額外確認。");
  }

  async function ask(prompt) {
    const clean = String(prompt || "").trim().slice(0, 2000);
    if (!clean) return;

    const ctx = context();
    if (!ctx?.isAuthorized?.()) throw new Error("Admin 權限尚未確認");
    if (!ctx.hasPermission?.("ai.agent")) throw new Error("目前帳號沒有 ai.agent 權限");

    const url = endpoint();
    if (!url) throw new Error("尚未設定 AI Agent 服務網址");

    history.push({role:"user", content:clean});
    render(clean, "user");

    const response = await fetch(url, {
      method:"POST",
      cache:"no-store",
      credentials:"omit",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + await token()
      },
      body:JSON.stringify({
        messages:history.slice(-12),
        snapshot:ctx.snapshot?.()
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) {
      throw new Error(String(data?.message || data?.error || "AI Agent 失敗").slice(0,500));
    }

    history.push({role:"assistant", content:String(data.message || "")});
    render(String(data.message || "沒有回覆。"), "assistant");

    let args = {};
    try { args = JSON.parse(String(data.actionArgs || "{}")); } catch (_) { args = {}; }
    renderAction(data.action, args, data.requiresConfirmation === true);

    if (data.action && data.action !== "none") {
      const result = await maybeExecute(data.action, args, data.requiresConfirmation === true);
      if (result) {
        render(result, "tool");
        history.push({role:"tool", content:result});
      }
    }
  }

  async function maybeExecute(action, args, needsConfirmation) {
    const ctx = context();
    if (!ctx?.executeAction) return "目前版本只會提出管理操作，尚未提供執行介面。";

    const permissionMap = {
      set_user_restriction:"users.restrict",
      clear_user_restriction:"users.restrict",
      set_feature_flag:"settings.edit",
      assign_role:"roles.manage",
      set_override:"roles.manage",
      set_whitelist:"whitelist.manage",
      delete_audit:"audit.delete"
    };

    const permission = permissionMap[action];
    if (!permission || !ctx.hasPermission?.(permission)) {
      return "已攔截：目前管理員沒有執行 " + action + " 所需權限。";
    }

    if (needsConfirmation) {
      const ok = window.confirm(
        "AI Agent 建議執行：\n\n" +
        action + "\n" +
        JSON.stringify(args || {}, null, 2) +
        "\n\n確定要執行嗎？"
      );
      if (!ok) return "你取消了這次 AI 管理操作。";
    }

    try {
      await ctx.executeAction(action, args || {});
      return "已完成： " + action;
    } catch (error) {
      return "執行失敗：" + String(error?.message || error).slice(0,500);
    }
  }

  function clear() {
    history = [];
    const output = $("aiAgentChat");
    if (output) output.innerHTML = "";
    renderAction("none", {}, false);
  }

  function bind() {
    const send = async () => {
      const input = $("aiAgentInput");
      const button = $("aiAgentSend");
      const status = $("aiAgentStatus");
      const value = String(input?.value || "").trim();
      if (!value) return;
      if (input) input.value = "";
      if (button) button.disabled = true;
      if (status) status.textContent = "AI Agent 處理中…";
      try {
        await ask(value);
        if (status) status.textContent = "完成";
      } catch (error) {
        render(String(error?.message || error), "error");
        if (status) status.textContent = "未完成";
      } finally {
        if (button) button.disabled = false;
      }
    };

    $("aiAgentSend")?.addEventListener("click", () => void send());
    $("aiAgentInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void send();
      }
    });
    $("aiAgentClear")?.addEventListener("click", clear);
  }

  function boot() {
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {once:true});
  } else {
    boot();
  }

  window.WT_ADMIN_AI_AGENT = {ask,clear};
})();
