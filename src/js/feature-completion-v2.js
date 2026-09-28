(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS || {};
  const $ = id => document.getElementById(id);
  const core = window.WT_CORE || null;

  const SEARCH_KEY = "wt_platform_search_history_v2";
  const HISTORY_KEY = "wt_watch_history_v2";
  const FAV_KEY = "wt_favorites_v1";
  const ROOMS_KEY = "wt_recent_rooms_v2";

  let searchObserver = null;
  let resultsObserver = null;
  let lastVideoKey = "";
  let lastHistoryWrite = 0;
  let lastOnlineRecovery = 0;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]
    ));
  }

  function toast(message) {
    try {
      if (typeof wt.toast === "function") return wt.toast(message);
      if (typeof window.toast === "function") return window.toast(message);
    } catch (_) {}
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "");
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function state() {
    return core?.state || {};
  }

  function roomVideo() {
    const v = state()?.room?.video;
    return v && typeof v === "object" ? v : null;
  }

  function inRoom() {
    const view = $("roomView");
    return Boolean(view && !view.classList.contains("hidden"));
  }

  function platformLabel(platform) {
    return ({
      youtube:"YouTube",
      vimeo:"Vimeo",
      dailymotion:"Dailymotion",
      twitch:"Twitch"
    })[String(platform || "").toLowerCase()] || String(platform || "平台");
  }

  function formatDate(value) {
    const d = new Date(Number(value) || 0);
    return Number.isFinite(d.getTime()) && d.getTime() > 0 ? d.toLocaleString("zh-TW") : "—";
  }

  function formatTime(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    return h ? [h, m, s].map((v, i) => i === 0 ? String(v) : String(v).padStart(2, "0")).join(":") : String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function searchHistory() {
    const value = readJson(SEARCH_KEY, []);
    if (!Array.isArray(value)) return [];
    return value.filter(x => x && typeof x === "object" && x.query).slice(0, 40);
  }

  function saveSearchHistory(platform, query) {
    const p = String(platform || "").trim().toLowerCase();
    const q = String(query || "").trim();
    if (!q || !["youtube","vimeo","dailymotion","twitch"].includes(p)) return;
    const now = Date.now();
    const list = searchHistory();
    const found = list.find(x => x.platform === p && x.query.toLowerCase() === q.toLowerCase());
    const item = {
      platform:p,
      query:q.slice(0,100),
      lastAt:now,
      count:Number(found?.count || 0) + 1
    };
    const next = [item].concat(list.filter(x => !(x.platform === p && String(x.query).toLowerCase() === q.toLowerCase())));
    writeJson(SEARCH_KEY, next.slice(0,40));
  }

  function clearSearchHistoryItem(platform, query) {
    const p = String(platform || "").toLowerCase();
    const q = String(query || "");
    writeJson(SEARCH_KEY, searchHistory().filter(x => !(x.platform === p && x.query === q)));
  }

  function clearAllSearchHistory() {
    localStorage.removeItem(SEARCH_KEY);
  }

  function renderUnifiedSearchHistory(filterQuery = "") {
    const box = $("modalSearchHistory");
    if (!box) return;

    const f = String(filterQuery || "").trim().toLowerCase();
    const list = searchHistory()
      .filter(x => !f || String(x.query || "").toLowerCase().includes(f))
      .sort((a,b) => Number(b.lastAt || 0) - Number(a.lastAt || 0))
      .slice(0, 16);

    if (!list.length) {
      box.innerHTML = f
        ? '<span class="muted">沒有符合的最近搜尋。</span>'
        : '<span class="muted">還沒有搜尋紀錄。</span>';
      return;
    }

    box.innerHTML =
      '<span class="muted">最近搜尋：</span> ' +
      list.map(x =>
        '<span class="wt-v2-search-chip" style="display:inline-flex;align-items:center;gap:2px;margin:2px">' +
          '<button type="button" class="wt-search-history-chip" data-wt-v2-search="' + esc(x.query) + '" data-wt-v2-platform="' + esc(x.platform) + '">' +
            esc(platformLabel(x.platform)) + ' · ' + esc(x.query) +
          '</button>' +
          '<button type="button" class="wt-search-history-delete" data-wt-v2-search-delete="' + esc(x.query) + '" data-wt-v2-platform="' + esc(x.platform) + '" aria-label="刪除搜尋紀錄" title="刪除搜尋紀錄">×</button>' +
        '</span>'
      ).join("") +
      '<button type="button" class="wt-search-history-delete" data-wt-v2-search-clear-all title="清除全部搜尋紀錄">清除全部</button>';

    box.querySelectorAll("[data-wt-v2-search]").forEach(button => {
      button.addEventListener("click", () => {
        const select = $("sourceTypeModal");
        const input = $("modalVideoSearchInput");
        if (select) select.value = button.dataset.wtV2Platform || "youtube";
        if (input) input.value = button.dataset.wtV2Search || "";
        updatePlatformSearchUI();
        setTimeout(() => $("modalSearchVideoBtn")?.click(), 20);
      });
    });

    box.querySelectorAll("[data-wt-v2-search-delete]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        clearSearchHistoryItem(button.dataset.wtV2Platform, button.dataset.wtV2SearchDelete);
        renderUnifiedSearchHistory($("modalVideoSearchInput")?.value || "");
      });
    });

    box.querySelector("[data-wt-v2-search-clear-all]")?.addEventListener("click", () => {
      clearAllSearchHistory();
      renderUnifiedSearchHistory($("modalVideoSearchInput")?.value || "");
    });
  }

  function updatePlatformSearchUI() {
    const platform = String($("sourceTypeModal")?.value || "youtube").toLowerCase();
    const history = searchHistory().filter(x => x.platform === platform);
    const twitchToggleId = "wtV2TwitchLiveOnly";
    const box = $("modalSearchHistory");
    const area = $("modalVideoSearchArea");
    if (!area) return;

    let toggle = $(twitchToggleId);
    if (platform === "twitch") {
      if (!toggle) {
        const label = document.createElement("label");
        label.id = twitchToggleId + "Wrap";
        label.style.cssText = "display:inline-flex;align-items:center;gap:7px;margin-top:8px;font-size:12px";
        label.innerHTML = '<input id="' + twitchToggleId + '" type="checkbox"> 只搜尋目前直播頻道';
        area.insertBefore(label, box || null);
        toggle = label.querySelector("input");
        if (toggle) {
          toggle.addEventListener("change", () => {
            window.__WT_TWITCH_LIVE_ONLY__ = toggle.checked;
          });
        }
      }
      if (toggle) toggle.checked = window.__WT_TWITCH_LIVE_ONLY__ === true;
    } else {
      $(twitchToggleId + "Wrap")?.remove();
      window.__WT_TWITCH_LIVE_ONLY__ = false;
    }

    if (box) {
      const q = String($("modalVideoSearchInput")?.value || "").trim();
      renderUnifiedSearchHistory(q);
      if (history.length && !q) {
        box.dataset.platformHistoryReady = "1";
      }
    }
  }

  function hookSearch() {
    const platform = $("sourceTypeModal");
    const input = $("modalVideoSearchInput");
    const button = $("modalSearchVideoBtn");
    if (platform && !platform.dataset.wtV2Bound) {
      platform.dataset.wtV2Bound = "1";
      platform.addEventListener("change", () => {
        updatePlatformSearchUI();
        setTimeout(() => renderUnifiedSearchHistory(input?.value || ""), 50);
      });
    }
    if (input && !input.dataset.wtV2Bound) {
      input.dataset.wtV2Bound = "1";
      input.addEventListener("input", () => renderUnifiedSearchHistory(input.value));
    }
    if (button && !button.dataset.wtV2Bound) {
      button.dataset.wtV2Bound = "1";
      button.addEventListener("click", () => {
        const p = String(platform?.value || "youtube").toLowerCase();
        const q = String(input?.value || "").trim();
        if (q) saveSearchHistory(p, q);
        [50,180,600,1200].forEach(delay => setTimeout(() => {
          renderUnifiedSearchHistory(input?.value || "");
          decorateSearchResults();
        }, delay));
      }, true);
    }
    updatePlatformSearchUI();
  }

  function favorites() {
    const value = readJson(FAV_KEY, {});
    return value && typeof value === "object" ? value : {};
  }

  function favoriteKey(video) {
    if (!video) return "";
    return String(video.platform || "youtube").toLowerCase() + ":" + String(video.id || video.url || "");
  }

  function toggleFavorite(video) {
    const key = favoriteKey(video);
    if (!key) return false;
    const map = favorites();
    if (map[key]) {
      delete map[key];
      writeJson(FAV_KEY, map);
      toast("已取消收藏");
      return false;
    }
    map[key] = {
      key,
      id:String(video.id || ""),
      platform:String(video.platform || "youtube").toLowerCase(),
      title:String(video.title || "未命名影片").slice(0,200),
      thumbnail:String(video.thumbnail || "").slice(0,2000),
      channel:String(video.channel || "").slice(0,100),
      url:video.url ? String(video.url).slice(0,2000) : "",
      twitchType:video.twitchType ? String(video.twitchType) : "",
      savedAt:Date.now()
    };
    writeJson(FAV_KEY, map);
    toast("已加入收藏");
    return true;
  }

  function buildFavoriteButton(video) {
    const key = favoriteKey(video);
    if (!key) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tiny-btn wt-v2-favorite-btn";
    button.dataset.wtFavoriteKey = key;
    const active = Boolean(favorites()[key]);
    button.textContent = active ? "★ 已收藏" : "☆ 收藏";
    button.title = active ? "取消收藏" : "加入收藏";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const enabled = toggleFavorite(video);
      button.textContent = enabled ? "★ 已收藏" : "☆ 收藏";
      button.title = enabled ? "取消收藏" : "加入收藏";
    });
    return button;
  }

  function decorateSearchResults() {
    const container = $("modalVideoSearchResults");
    if (!container) return;
    const results = Array.isArray(state().searchResults) ? state().searchResults : [];
    container.querySelectorAll("[data-video-play]").forEach(playButton => {
      const id = String(playButton.dataset.videoPlay || "");
      const video = results.find(x => String(x?.id || "") === id);
      if (!video || playButton.parentElement?.querySelector('[data-wt-favorite-key="' + CSS.escape(favoriteKey(video)) + '"]')) return;
      const button = buildFavoriteButton(video);
      if (button) playButton.parentElement?.appendChild(button);
    });
  }

  function watchHistory() {
    const value = readJson(HISTORY_KEY, []);
    if (!Array.isArray(value)) return [];
    return value.filter(x => x && x.id && x.platform).slice(0, 50);
  }

  async function readPlayerPosition() {
    const s = state();
    const player = s.player;
    if (!player) return 0;
    if (s.playerType === "youtube") return Number($("directVideo")?.currentTime || 0);
    if (s.playerType === "vimeo" && typeof player.getCurrentTime === "function") return Number(await player.getCurrentTime().catch(() => 0)) || 0;
    if (s.playerType === "dailymotion" && typeof player.getState === "function") return Number((await player.getState().catch(() => null))?.videoTime || 0) || 0;
    if (s.playerType === "twitch" && typeof player.getCurrentTime === "function") return Number(player.getCurrentTime()) || 0;
    return 0;
  }

  async function recordWatchHistory(force = false) {
    if (!inRoom()) return;
    const video = roomVideo();
    if (!video?.id) return;
    const key = favoriteKey(video);
    const now = Date.now();
    if (!force && now - lastHistoryWrite < 4500) return;

    let position = 0;
    try { position = await readPlayerPosition(); } catch (_) {}
    const list = watchHistory();
    const current = {
      id:String(video.id),
      platform:String(video.platform || "youtube").toLowerCase(),
      title:String(video.title || "未命名影片").slice(0,200),
      thumbnail:String(video.thumbnail || "").slice(0,2000),
      channel:String(video.channel || "").slice(0,100),
      url:video.url ? String(video.url).slice(0,2000) : "",
      twitchType:video.twitchType ? String(video.twitchType) : "",
      lastWatchedAt:now,
      position:Number.isFinite(position) ? Math.max(0,position) : 0
    };

    const next = [current].concat(list.filter(x => favoriteKey(x) !== key)).slice(0,50);
    writeJson(HISTORY_KEY, next);
    lastHistoryWrite = now;
    lastVideoKey = key;
  }

  function removeWatchHistory(key) {
    writeJson(HISTORY_KEY, watchHistory().filter(x => favoriteKey(x) !== key));
  }

  function removeRecentRoom(roomId) {
    const id = String(roomId || "").toUpperCase();
    if (!id) return;
    writeJson(ROOMS_KEY, readJson(ROOMS_KEY, []).filter(x => String(x?.id || "").toUpperCase() !== id));
  }

  function modal(id, title, body) {
    let m = $(id);
    if (!m) {
      m = document.createElement("div");
      m.id = id;
      m.className = "modal hidden";
      m.setAttribute("aria-hidden", "true");
      m.innerHTML = '<div class="modal-card wt-v2-card"><div class="wt-v2-head"><div class="panel-title"></div><button type="button" class="tiny-btn" data-wt-v2-close>關閉</button></div><div class="wt-v2-body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener("click", e => { if (e.target === m) closeModal(id); });
      m.querySelector("[data-wt-v2-close]")?.addEventListener("click", () => closeModal(id));
    }
    m.querySelector(".panel-title").textContent = title;
    m.querySelector(".wt-v2-body").innerHTML = body;
    m.classList.remove("hidden");
    m.hidden = false;
    m.style.removeProperty("display");
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("wt-modal-open");
    return m.querySelector(".wt-v2-body");
  }

  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.add("hidden");
    m.hidden = true;
    m.style.setProperty("display","none","important");
    m.setAttribute("aria-hidden","true");
    if (!document.querySelector(".modal:not(.hidden)")) document.body.classList.remove("wt-modal-open");
  }

  function openHistory() {
    const history = watchHistory();
    const rooms = Array.isArray(readJson(ROOMS_KEY, [])) ? readJson(ROOMS_KEY, []).filter(Boolean).slice(0,30) : [];
    const body = modal("wtV2HistoryModal","觀看與房間紀錄",
      '<div class="wt-v2-tabs"><button type="button" class="tiny-btn primary" data-wt-v2-tab="videos">最近觀看</button><button type="button" class="tiny-btn" data-wt-v2-tab="rooms">最近房間</button></div>' +
      '<div id="wtV2HistoryContent"></div>'
    );
    const content = body.querySelector("#wtV2HistoryContent");

    const render = tab => {
      body.querySelectorAll("[data-wt-v2-tab]").forEach(b => b.classList.toggle("primary", b.dataset.wtV2Tab === tab));
      if (tab === "rooms") {
        content.innerHTML = rooms.length
          ? '<div class="wt-v2-list">' + rooms.map(x =>
              '<div class="wt-v2-row"><div><strong>' + esc(x.name || "一起看") + '</strong><div class="small muted">' + esc(String(x.id || "").toUpperCase()) + ' · ' + esc(formatDate(x.at || x.joinedAt || 0)) + '</div></div><div class="wt-v2-actions"><button type="button" class="tiny-btn primary" data-wt-v2-room="' + esc(x.id || "") + '">加入</button><button type="button" class="tiny-btn danger" data-wt-v2-room-del="' + esc(x.id || "") + '">刪除</button></div></div>'
            ).join("") + '</div>'
          : '<div class="wt-v2-empty">目前沒有最近房間。</div>';
        content.querySelectorAll("[data-wt-v2-room]").forEach(b => b.onclick = () => {
          location.href = location.pathname + "?room=" + encodeURIComponent(String(b.dataset.wtV2Room || "").toUpperCase());
        });
        content.querySelectorAll("[data-wt-v2-room-del]").forEach(b => b.onclick = () => {
          removeRecentRoom(b.dataset.wtV2Room);
          openHistory();
          setTimeout(() => body.querySelector('[data-wt-v2-tab="rooms"]')?.click(), 0);
        });
      } else {
        content.innerHTML = history.length
          ? '<div class="wt-v2-list">' + history.map(x => {
              const key = favoriteKey(x);
              return '<div class="wt-v2-row"><div style="min-width:0;flex:1"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(x.title || "未命名影片") + '</strong><div class="small muted">' + esc(platformLabel(x.platform)) + ' · ' + esc(x.channel || "") + ' · ' + esc(formatDate(x.lastWatchedAt || 0)) + '</div></div><div class="wt-v2-actions"><button type="button" class="tiny-btn primary" data-wt-v2-video="' + esc(key) + '">播放</button><button type="button" class="tiny-btn danger" data-wt-v2-video-del="' + esc(key) + '">刪除</button></div></div>';
            }).join("") + '</div>'
          : '<div class="wt-v2-empty">目前還沒有觀看紀錄。進入房間播放影片後會自動記錄。</div>';
        content.querySelectorAll("[data-wt-v2-video]").forEach(b => b.onclick = async () => {
          const item = history.find(x => favoriteKey(x) === b.dataset.wtV2Video);
          if (!item) return;
          try {
            if (inRoom() && typeof core?.changeVideo === "function") {
              await core.changeVideo(item);
              closeModal("wtV2HistoryModal");
            } else if (typeof core?.createRoomWithVideo === "function") {
              await core.createRoomWithVideo(item);
              closeModal("wtV2HistoryModal");
            }
          } catch (error) {
            toast(error?.message || "播放紀錄影片失敗");
          }
        });
        content.querySelectorAll("[data-wt-v2-video-del]").forEach(b => b.onclick = () => {
          removeWatchHistory(b.dataset.wtV2Video);
          openHistory();
        });
      }
    };

    body.querySelectorAll("[data-wt-v2-tab]").forEach(b => b.addEventListener("click", () => render(b.dataset.wtV2Tab)));
    render("videos");
  }

  function openHealth() {
    const s = state();
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const video = $("directVideo");
    const err = video?.error;
    const buffered = video?.buffered?.length ? (video.buffered.end(video.buffered.length - 1) - (video.currentTime || 0)) : 0;
    const body = modal("wtV2HealthModal","播放與同步診斷",
      '<div class="wt-v2-stat-grid">' +
        '<div class="wt-v2-stat"><span>網路</span><strong>' + esc(navigator.onLine ? "線上" : "離線") + '</strong></div>' +
        '<div class="wt-v2-stat"><span>連線類型</span><strong>' + esc(conn?.effectiveType || "未知") + '</strong></div>' +
        '<div class="wt-v2-stat"><span>播放器</span><strong>' + esc(s.playerType || "尚未載入") + '</strong></div>' +
        '<div class="wt-v2-stat"><span>同步</span><strong>' + esc($("syncStatus")?.textContent || "尚未同步") + '</strong></div>' +
      '</div>' +
      '<div class="wt-v2-list">' +
        '<div class="wt-v2-row"><span>RTT</span><strong>' + esc(conn?.rtt != null ? String(conn.rtt) + " ms" : "—") + '</strong></div>' +
        '<div class="wt-v2-row"><span>下載速率</span><strong>' + esc(conn?.downlink != null ? String(conn.downlink) + " Mbps" : "—") + '</strong></div>' +
        '<div class="wt-v2-row"><span>目前時間</span><strong>' + esc(formatTime(await readPlayerPosition())) + '</strong></div>' +
        '<div class="wt-v2-row"><span>緩衝量</span><strong>' + esc(video ? Math.max(0,buffered).toFixed(1) + " 秒" : "—") + '</strong></div>' +
        '<div class="wt-v2-row"><span>媒體錯誤</span><strong>' + esc(err ? "code " + err.code : "無") + '</strong></div>' +
        '<div class="wt-v2-row"><span>頁面版本</span><strong>' + esc(window.__WATCHTOGETHER_BUILD__ || "—") + '</strong></div>' +
      '</div>' +
      '<div class="panel-title" style="margin-top:16px">字幕</div>' +
      '<div id="wtV2CaptionArea"></div>' +
      '<div class="wt-v2-actions"><button type="button" class="secondary-btn" id="wtV2SyncNow">立即同步</button><button type="button" class="secondary-btn" id="wtV2Recover">重新檢查播放器</button><button type="button" class="tiny-btn" id="wtV2Refresh">重新整理診斷</button></div>'
    );

    renderCaptionControl(body);
    body.querySelector("#wtV2SyncNow").onclick = () => {
      $("manualSyncBtn")?.click();
      toast("已要求立即同步");
    };
    body.querySelector("#wtV2Recover").onclick = async () => {
      try {
        if (String(s.playerType || "") === "youtube" && typeof core?.refreshYoutubeStreamIfNeeded === "function") {
          const ok = await core.refreshYoutubeStreamIfNeeded("diagnostic");
          toast(ok ? "已重新檢查 YouTube 串流" : "目前不需要重新載入串流");
        } else {
          $("manualSyncBtn")?.click();
          toast("已重新檢查同步狀態");
        }
      } catch (error) {
        toast(error?.message || "播放器檢查失敗");
      }
      openHealth();
    };
    body.querySelector("#wtV2Refresh").onclick = openHealth;
  }

  function renderCaptionControl(body) {
    const area = body.querySelector("#wtV2CaptionArea");
    const video = $("directVideo");
    if (!area || !video?.textTracks?.length) {
      if (area) area.innerHTML = '<div class="small muted">目前播放器沒有可控制的字幕軌。若來源本身提供字幕，瀏覽器才會在這裡顯示。</div>';
      return;
    }
    const tracks = Array.from(video.textTracks);
    area.innerHTML = '<select id="wtV2CaptionSelect" style="width:100%"><option value="-1">關閉字幕</option>' +
      tracks.map((track,index) => '<option value="' + index + '">' + esc(track.label || track.language || ("字幕 " + (index + 1))) + '</option>').join("") +
      '</select>';
    const select = area.querySelector("#wtV2CaptionSelect");
    select.value = String(Math.max(-1, tracks.findIndex(t => t.mode === "showing")));
    select.addEventListener("change", () => {
      const wanted = Number(select.value);
      tracks.forEach((track,index) => { track.mode = index === wanted ? "showing" : "disabled"; });
    });
  }

  function ensureCurrentFavorite() {
    if (!inRoom()) return;
    const action = $("changeSourceBtn")?.parentElement;
    const video = roomVideo();
    if (!action || !video?.id || $("wtV2CurrentFavorite")) return;
    const button = document.createElement("button");
    button.id = "wtV2CurrentFavorite";
    button.type = "button";
    button.className = "secondary-btn";
    button.addEventListener("click", () => {
      toggleFavorite(video);
      updateCurrentFavoriteLabel();
    });
    action.appendChild(button);
    updateCurrentFavoriteLabel();
  }

  function updateCurrentFavoriteLabel() {
    const button = $("wtV2CurrentFavorite");
    const video = roomVideo();
    if (!button || !video) return;
    const active = Boolean(favorites()[favoriteKey(video)]);
    button.textContent = active ? "★ 已收藏" : "☆ 收藏目前影片";
    button.title = active ? "取消收藏" : "收藏目前影片";
  }

  function ensureTopbar() {
    const bar = document.querySelector(".topbar-right");
    if (!bar) return;

    if (!$("wtV2HistoryBtn")) {
      const button = document.createElement("button");
      button.id = "wtV2HistoryBtn";
      button.type = "button";
      button.className = "wt-nav-btn";
      button.textContent = "🕘 歷史";
      button.title = "觀看與房間紀錄";
      button.addEventListener("click", openHistory);
      const anchor = $("googleLoginBtn");
      bar.insertBefore(button, anchor || null);
    }

    if (!$("wtV2HealthBtn")) {
      const button = document.createElement("button");
      button.id = "wtV2HealthBtn";
      button.type = "button";
      button.className = "wt-nav-btn";
      button.textContent = "🩺 播放狀態";
      button.title = "播放、網路與同步診斷";
      button.addEventListener("click", openHealth);
      const anchor = $("googleLoginBtn");
      bar.insertBefore(button, anchor || null);
    }
  }

  function installResultsObserver() {
    const container = $("modalVideoSearchResults");
    if (!container) return;
    if (resultsObserver && resultsObserver.target === container) return;
    try { resultsObserver?.observer?.disconnect(); } catch (_) {}
    const observer = new MutationObserver(() => decorateSearchResults());
    observer.observe(container,{childList:true,subtree:true});
    resultsObserver = {target:container,observer};
    decorateSearchResults();
  }

  function installModalObserver() {
    const modal = $("sourceModal");
    if (!modal) return;
    if (modal.dataset.wtV2Observer) return;
    modal.dataset.wtV2Observer = "1";
    const observer = new MutationObserver(() => {
      if (!modal.classList.contains("hidden") && !modal.hidden) {
        hookSearch();
        installResultsObserver();
        renderUnifiedSearchHistory($("modalVideoSearchInput")?.value || "");
      }
    });
    observer.observe(modal,{attributes:true,attributeFilter:["class","hidden","style"]});
    searchObserver = observer;
  }

  function installNetworkHooks() {
    if (window.__WT_V2_NETWORK_HOOKS__) return;
    window.__WT_V2_NETWORK_HOOKS__ = true;

    window.addEventListener("online",() => {
      const now = Date.now();
      if (now - lastOnlineRecovery < 3000) return;
      lastOnlineRecovery = now;
      setTimeout(() => {
        $("manualSyncBtn")?.click();
        toast("網路已恢復，已重新檢查同步");
      },700);
    });

    window.addEventListener("offline",() => toast("目前離線，影片同步與聊天可能暫停"));
  }

  function installWatchTracking() {
    if (window.__WT_V2_WATCH_TRACK__) return;
    window.__WT_V2_WATCH_TRACK__ = true;
    setInterval(() => {
      const s = state();
      const video = roomVideo();
      if (!video?.id) return;
      const key = favoriteKey(video);
      if (key !== lastVideoKey || s.isPlaying) void recordWatchHistory(key !== lastVideoKey);
    },5000);
  }

  function installRoomChangeWatch() {
    if (window.__WT_V2_ROOM_WATCH__) return;
    window.__WT_V2_ROOM_WATCH__ = true;
    setInterval(() => {
      if (inRoom()) {
        ensureCurrentFavorite();
        updateCurrentFavoriteLabel();
        installResultsObserver();
      } else {
        $("wtV2CurrentFavorite")?.remove();
      }
    },1000);
  }

  function injectCss() {
    if ($("wtV2Style")) return;
    const style = document.createElement("style");
    style.id = "wtV2Style";
    style.textContent = [
      ".wt-v2-card{width:min(900px,calc(100vw - 24px));max-height:90vh;overflow:auto}",
      ".wt-v2-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}",
      ".wt-v2-body{min-width:0}",
      ".wt-v2-tabs,.wt-v2-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".wt-v2-list{display:grid;gap:8px;margin-top:12px}",
      ".wt-v2-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(15,23,42,.3)}",
      ".wt-v2-row>div:first-child{min-width:0}",
      ".wt-v2-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}",
      ".wt-v2-stat{padding:11px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(15,23,42,.3)}",
      ".wt-v2-stat span{display:block;font-size:11px;color:#94a3b8}.wt-v2-stat strong{display:block;margin-top:4px;word-break:break-word}",
      ".wt-v2-empty{padding:18px;text-align:center;color:#94a3b8}",
      "@media(max-width:700px){.wt-v2-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wt-v2-row{align-items:flex-start;flex-direction:column}.wt-v2-actions{width:100%}}",
      "@media(max-width:430px){.wt-v2-stat-grid{grid-template-columns:1fr}}"
    ].join("");
    document.head.appendChild(style);
  }

  function init() {
    injectCss();
    ensureTopbar();
    hookSearch();
    installModalObserver();
    installResultsObserver();
    installNetworkHooks();
    installWatchTracking();
    installRoomChangeWatch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded",init,{once:true});
  } else {
    init();
  }

  window.WT_FEATURE_COMPLETION_V2 = {
    openHistory,
    openHealth,
    saveSearchHistory,
    recordWatchHistory,
    toggleFavorite
  };
})();