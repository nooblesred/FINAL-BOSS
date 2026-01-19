/* =========================
   PhotoSpark — app.js
   Option A: loads prompts from data.json

   Includes:
   - Versioned cache reset (DATA_VERSION)
   - Debounced search (smooth for 10k+)
   - No repeats (New Prompt avoids last)
   - Smart relax when pool empty
   - Daily prompt opens in modal (like Timer)
   - Favorites with folders (create + assign + All folder)
   ========================= */

document.addEventListener("DOMContentLoaded", () => {
  // -------- CONFIG --------
  const PROMPTS_URL = "data.json";

  // IMPORTANT: Bump this whenever you upload a new/changed data.json
  const DATA_VERSION = "2026-01-19-15000";

  const CACHE_KEY = `ps_prompts_cache_${DATA_VERSION}`;

  const LS = {
    favData: "ps_fav_data_v2",      // map of favorites keyed by promptKey
    favFolders: "ps_fav_folders_v2",// { order:[id], folders:{id:{name,created}}, assign:{promptKey:[id]}}
    hist: "ps_hist_v1",
    streak: "ps_streak_v1",
    streakDate: "ps_streak_date_v1",
    lastPromptKey: "ps_last_prompt_key_v1",
    uiFavFolder: "ps_ui_fav_folder_v1"
  };

  // -------- ELEMENTS --------
  const $ = (id) => document.getElementById(id);

  const el = {
    // Tabs
    tabs: Array.from(document.querySelectorAll(".tab")),
    panels: {
      prompt: $("tab-prompt"),
      favorites: $("tab-favorites"),
      history: $("tab-history")
    },

    // Filters
    category: $("categorySelect"),
    diff: $("diffSelect"),
    terrain: $("terrainSelect"),
    search: $("searchInput"),

    // Pills
    pillCat: $("pillCat"),
    pillDiff: $("pillDiff"),
    pillTerrain: $("pillTerrain"),
    pillMode: $("pillMode"),

    // Prompt display
    title: $("promptTitle"),
    text: $("promptText"),
    constraints: $("constraints"),
    noteLine: $("noteLine"),

    // Buttons
    newBtn: $("newBtn"),
    dailyBtn: $("dailyBtn"),
    timerBtn: $("timerBtn"),
    saveBtn: $("saveBtn"),
    doneBtn: $("doneBtn"),
    shareBtn: $("shareBtn"),

    // Stats
    streakNum: $("streakNum"),
    favNum: $("favNum"),
    histNum: $("histNum"),

    // Lists
    favoritesList: $("favoritesList"),
    historyList: $("historyList"),
    clearFavBtn: $("clearFavBtn"),
    clearHistBtn: $("clearHistBtn"),

    // Overlays (existing)
    loadingOverlay: $("loadingOverlay"),
    timerOverlay: $("timerOverlay"),

    // Timer controls
    closeTimerBtn: $("closeTimerBtn"),
    stopTimerBtn: $("stopTimerBtn"),
    timeLeft: $("timeLeft"),
    timerHint: $("timerHint"),

    // Toast
    toast: $("toast")
  };

  // -------- STATE --------
  let PROMPTS = [];
  let current = null;

  // Timer state
  let timerId = null;
  let timerEnd = null;

  // Favorites UI state
  let activeFavFolder = localStorage.getItem(LS.uiFavFolder) || "all"; // "all" or folderId

  // Daily modal state
  let dailyCandidate = null;

  // -------- UI HELPERS --------
  function showLoading(show) {
    if (!el.loadingOverlay) return;
    el.loadingOverlay.classList.toggle("hidden", !show);
    el.loadingOverlay.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    setTimeout(() => el.toast.classList.remove("show"), 1400);
  }

  // -------- STORAGE HELPERS --------
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function save(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  // -------- DEBOUNCE --------
  function debounce(fn, waitMs = 220) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), waitMs);
    };
  }

  // -------- PROMPT HELPERS --------
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function normalizeTerrain(p) {
    if (Array.isArray(p.terrain)) return p.terrain;
    if (typeof p.terrain === "string" && p.terrain) return [p.terrain];
    return [];
  }

  function buildHay(p) {
    const terr = normalizeTerrain(p);
    const cons = Array.isArray(p.constraints) ? p.constraints : [];
    return [
      p.title || "",
      p.text || "",
      p.cat || "",
      p.diff || "",
      ...terr,
      ...cons
    ].join(" ").toLowerCase();
  }

  function normalizePrompt(raw) {
    const p = {
      cat: String(raw.cat || "Any"),
      diff: String(raw.diff || "Easy"),
      terrain: normalizeTerrain(raw),
      title: String(raw.title || "Untitled"),
      text: String(raw.text || ""),
      constraints: Array.isArray(raw.constraints) ? raw.constraints.map(String) : []
    };
    p._hay = buildHay(p);
    return p;
  }

  function promptKey(p) {
    // stable enough for no-repeats + favorites
    return `${p.cat}||${p.diff}||${p.title}`.toLowerCase();
  }

  // -------- FILTERING (strict pool) --------
  function strictPool() {
    const c = el.category?.value ?? "any";
    const d = el.diff?.value ?? "any";
    const t = el.terrain?.value ?? "any";
    const q = (el.search?.value || "").trim().toLowerCase();

    return PROMPTS.filter(p => {
      const catOk = (c === "any" || p.cat === c);
      const diffOk = (d === "any" || p.diff === d);
      const terrOk = (t === "any" || p.terrain.includes(t));
      if (!catOk || !diffOk || !terrOk) return false;
      if (!q) return true;
      return p._hay.includes(q);
    });
  }

  function baseModeLabel() {
    return (el.search?.value || "").trim() ? "SEARCH" : "RANDOM";
  }

  // Smart relax: drop search → diff → cat → terrain
  function relaxedPool() {
    const original = {
      c: el.category?.value ?? "any",
      d: el.diff?.value ?? "any",
      t: el.terrain?.value ?? "any",
      q: (el.search?.value || "").trim()
    };

    let arr = strictPool();
    if (arr.length) return { arr, mode: baseModeLabel(), relaxed: false };

    if (original.q && el.search) {
      el.search.value = "";
      arr = strictPool();
      if (arr.length) { toast("No matches — search cleared."); return { arr, mode: "RELAXED", relaxed: true }; }
    }

    if (original.d !== "any" && el.diff) {
      el.diff.value = "any";
      arr = strictPool();
      if (arr.length) { toast("No matches — difficulty set to Any."); return { arr, mode: "RELAXED", relaxed: true }; }
    }

    if (original.c !== "any" && el.category) {
      el.category.value = "any";
      arr = strictPool();
      if (arr.length) { toast("No matches — category set to Any."); return { arr, mode: "RELAXED", relaxed: true }; }
    }

    if (original.t !== "any" && el.terrain) {
      el.terrain.value = "any";
      arr = strictPool();
      if (arr.length) { toast("No matches — terrain set to Any."); return { arr, mode: "RELAXED", relaxed: true }; }
    }

    // restore
    if (el.category) el.category.value = original.c;
    if (el.diff) el.diff.value = original.d;
    if (el.terrain) el.terrain.value = original.t;
    if (el.search) el.search.value = original.q;

    return { arr: [], mode: baseModeLabel(), relaxed: false };
  }

  // Prefer exact terrain matches first (when terrain filter is set)
  function terrainPreferred(arr) {
    const t = el.terrain?.value ?? "any";
    if (t === "any") return arr;
    const exact = arr.filter(p => p.terrain.includes(t));
    return exact.length ? exact : arr;
  }

  // -------- DAILY deterministic pick --------
  function dailyKey() {
    const q = (el.search?.value || "").trim().toLowerCase();
    const c = el.category?.value ?? "any";
    const d = el.diff?.value ?? "any";
    const t = el.terrain?.value ?? "any";
    return `${new Date().toDateString()}|${c}|${d}|${t}|${q}`;
  }

  function deterministicPick(arr, key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return arr[h % arr.length];
  }

  // -------- RENDERING --------
  function updateStats() {
    const favMap = load(LS.favData, {});
    const favCount = Object.keys(favMap).length;
    const hist = load(LS.hist, []);
    const s = Number(localStorage.getItem(LS.streak) || "0");

    if (el.streakNum) el.streakNum.textContent = String(s);
    if (el.favNum) el.favNum.textContent = String(favCount);
    if (el.histNum) el.histNum.textContent = String(hist.length);
  }

  function renderPrompt(p, modeLabel) {
    current = p;

    if (el.pillCat) el.pillCat.textContent = p.cat.toUpperCase();
    if (el.pillDiff) el.pillDiff.textContent = p.diff.toUpperCase();
    if (el.pillTerrain) el.pillTerrain.textContent = (p.terrain[0] || "Any").toUpperCase();
    if (el.pillMode) el.pillMode.textContent = modeLabel;

    if (el.title) el.title.textContent = p.title;
    if (el.text) el.text.textContent = p.text;

    if (el.constraints) {
      el.constraints.innerHTML = "";
      (p.constraints || []).forEach(x => {
        const li = document.createElement("li");
        li.textContent = x;
        el.constraints.appendChild(li);
      });
    }

    // Save button state
    const favMap = load(LS.favData, {});
    const key = promptKey(p);
    const isFav = !!favMap[key];
    if (el.saveBtn) el.saveBtn.textContent = isFav ? "★ Saved" : "☆ Save";

    // Notes
    if (el.noteLine) {
      if (modeLabel === "DAILY") el.noteLine.textContent = "Daily: stays the same all day for your current filters/search.";
      else if ((el.search?.value || "").trim()) el.noteLine.textContent = "Search is active: prompts are chosen only from matches.";
      else el.noteLine.textContent = "Tip: Tap Done after you shoot to build your streak.";
    }

    // store last prompt for no-repeat
    localStorage.setItem(LS.lastPromptKey, promptKey(p));

    updateStats();
  }

  function pushHistory(p) {
    const hist = load(LS.hist, []);
    const entry = { cat: p.cat, diff: p.diff, title: p.title, text: p.text, ts: Date.now() };
    const next = [entry, ...hist.filter(h => h.title !== p.title)].slice(0, 120);
    save(LS.hist, next);
    renderHistory();
    updateStats();
  }

  // -------- FAVORITES + FOLDERS DATA --------
  function ensureFolderStore() {
    const store = load(LS.favFolders, null);
    if (store && store.folders && store.order && store.assign) return store;

    const fresh = { order: [], folders: {}, assign: {} };
    save(LS.favFolders, fresh);
    return fresh;
  }

  function newFolderId() {
    return `f_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function getFolderName(id, store) {
    if (id === "all") return "All";
    return store?.folders?.[id]?.name || "Folder";
  }

  function setActiveFavFolder(id) {
    activeFavFolder = id;
    localStorage.setItem(LS.uiFavFolder, id);
    renderFavorites();
  }

  function promptAssignedToFolder(key, folderId, store) {
    const list = store.assign[key] || [];
    return list.includes(folderId);
  }

  function setPromptFolders(key, folderIds) {
    const store = ensureFolderStore();
    store.assign[key] = Array.from(new Set(folderIds)).filter(Boolean);
    save(LS.favFolders, store);
  }

  function getPromptFolders(key) {
    const store = ensureFolderStore();
    return store.assign[key] || [];
  }

  // -------- FAVORITES UI (render) --------
  function renderFavorites() {
    if (!el.favoritesList) return;

    const favMap = load(LS.favData, {});
    const store = ensureFolderStore();

    // Build list of favorites (array)
    const favs = Object.entries(favMap).map(([k, v]) => ({ key: k, ...v }));
    favs.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    // Filter by active folder
    let filtered = favs;
    if (activeFavFolder !== "all") {
      filtered = favs.filter(f => (store.assign[f.key] || []).includes(activeFavFolder));
    }

    // Folder bar (chips + new folder)
    const folderChips = [
      `<button class="secondary" type="button" data-fol="all" ${activeFavFolder==="all" ? 'style="opacity:1"' : 'style="opacity:.75"'}>All</button>`
    ];

    store.order.forEach(id => {
      const name = store.folders[id]?.name || "Folder";
      folderChips.push(
        `<button class="secondary" type="button" data-fol="${id}" ${activeFavFolder===id ? 'style="opacity:1"' : 'style="opacity:.75"'}>${escapeHtml(name)}</button>`
      );
    });

    const header = `
      <div class="item" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          ${folderChips.join("")}
          <button class="ghost" type="button" data-action="newFolder">+ Folder</button>
          <button class="ghost" type="button" data-action="manageFolders">Manage</button>
        </div>
        <small>${activeFavFolder==="all" ? "Showing all saved prompts." : `Showing folder: ${escapeHtml(getFolderName(activeFavFolder, store))}`}</small>
      </div>
    `;

    // Empty state
    if (!favs.length) {
      el.favoritesList.innerHTML = header + `<div class="item"><small>No favorites yet. Save prompts you want to repeat.</small></div>`;
      updateStats();
      return;
    }

    // Render prompts
    const items = filtered.map(f => {
      const folders = (store.assign[f.key] || []).map(id => getFolderName(id, store));
      const folderLine = folders.length ? folders.map(n => `<span class="pill subtle">${escapeHtml(n)}</span>`).join(" ") : `<span class="pill subtle">Unfiled</span>`;
      return `
        <div class="item">
          <strong>${escapeHtml(f.title)}</strong>
          <small>${escapeHtml(f.cat)} • ${escapeHtml(f.diff)} • ${(f.terrain && f.terrain[0]) ? escapeHtml(f.terrain[0]) : "Any"}</small>
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">${folderLine}</div>
          <div class="miniRow" style="margin-top:10px;">
            <button class="secondary" type="button" data-action="loadFav" data-key="${encodeURIComponent(f.key)}">Load</button>
            <button class="secondary" type="button" data-action="foldersFav" data-key="${encodeURIComponent(f.key)}">Folders</button>
            <button class="secondary" type="button" data-action="removeFav" data-key="${encodeURIComponent(f.key)}">Remove</button>
          </div>
        </div>
      `;
    }).join("");

    el.favoritesList.innerHTML = header + items;
    updateStats();
  }

  function renderHistory() {
    if (!el.historyList) return;
    const hist = load(LS.hist, []);
    if (!hist.length) {
      el.historyList.innerHTML = `<div class="item"><small>No history yet. Tap New Prompt to start.</small></div>`;
      updateStats();
      return;
    }

    el.historyList.innerHTML = hist.map(h => `
      <div class="item">
        <strong>${escapeHtml(h.title)}</strong>
        <small>${escapeHtml(h.cat)} • ${escapeHtml(h.diff)}</small>
        <div class="miniRow" style="margin-top:10px;">
          <button class="secondary" type="button" data-action="loadHist" data-title="${encodeURIComponent(h.title)}">Load</button>
        </div>
      </div>
    `).join("");

    updateStats();
  }

  // -------- CORE ACTIONS --------
  function pickNoRepeat(arr) {
    const lastKey = localStorage.getItem(LS.lastPromptKey) || "";
    if (arr.length <= 1) return arr[0];

    const preferred = terrainPreferred(arr);
    for (let tries = 0; tries < 10; tries++) {
      const p = pick(preferred);
      if (promptKey(p) !== lastKey) return p;
    }
    return pick(preferred);
  }

  function newPrompt() {
    const result = relaxedPool();
    const arr = result.arr;

    if (!arr.length) {
      toast("No prompts available yet.");
      return;
    }

    const p = pickNoRepeat(arr);
    renderPrompt(p, result.mode);
    pushHistory(p);
  }

  // DAILY: now opens in modal (box), like timer
  function openDailyModal() {
    const arr = strictPool();
    if (!arr.length) {
      toast("No matches for Daily. Adjust filters/search.");
      return;
    }
    const preferred = terrainPreferred(arr);
    dailyCandidate = deterministicPick(preferred, dailyKey());
    ensureDailyOverlay();
    fillDailyOverlay(dailyCandidate);
    showOverlay("psDailyOverlay", true);
  }

  function applyDailyCandidate() {
    if (!dailyCandidate) return;
    renderPrompt(dailyCandidate, "DAILY");
    pushHistory(dailyCandidate);
    toast("Daily prompt loaded");
    showOverlay("psDailyOverlay", false);
  }

  // Save / favorite now opens folder picker
  function onSaveClicked() {
    if (!current) return;
    openFolderPickerForPrompt(current);
  }

  function markDone() {
    const today = new Date().toDateString();
    const last = localStorage.getItem(LS.streakDate);
    let s = Number(localStorage.getItem(LS.streak) || "0");

    if (last !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      s = (last === yesterday) ? (s + 1) : 1;
      localStorage.setItem(LS.streak, String(s));
      localStorage.setItem(LS.streakDate, today);
      toast(`Done! Streak: ${s}`);
    } else {
      toast("Already marked done today.");
    }
    updateStats();
  }

  async function copyCurrent() {
    if (!current) return;

    const txt =
`PhotoSpark Prompt — ${current.title}
${current.cat} • ${current.diff} • ${(current.terrain.join(", ") || "Any")}

${current.text}

Constraints:
- ${(current.constraints || []).join("\n- ")}`;

    try {
      await navigator.clipboard.writeText(txt);
      toast("Copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Copied");
    }
  }

  // -------- TABS --------
  function setTab(name) {
    el.tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    Object.entries(el.panels).forEach(([k, panel]) => panel.classList.toggle("active", k === name));
  }

  // -------- LIST CLICK HANDLERS --------
  function onFavoritesClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;

    const fol = btn.getAttribute("data-fol");
    if (fol) {
      setActiveFavFolder(fol);
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;

    if (action === "newFolder") {
      openFolderManager({ mode: "create" });
      return;
    }
    if (action === "manageFolders") {
      openFolderManager({ mode: "manage" });
      return;
    }

    const key = decodeURIComponent(btn.dataset.key || "");
    if (!key) return;

    const favMap = load(LS.favData, {});
    const f = favMap[key];

    if (action === "loadFav") {
      if (!f) return;
      // Try to find canonical prompt
      const p = PROMPTS.find(p => promptKey(p) === key) || normalizePrompt(f);
      renderPrompt(p, "FAVORITE");
      setTab("prompt");
      return;
    }

    if (action === "removeFav") {
      if (!favMap[key]) return;
      delete favMap[key];
      save(LS.favData, favMap);

      const store = ensureFolderStore();
      delete store.assign[key];
      save(LS.favFolders, store);

      renderFavorites();
      updateStats();

      // update save btn if this was current
      if (current && promptKey(current) === key && el.saveBtn) el.saveBtn.textContent = "☆ Save";
      toast("Removed");
      return;
    }

    if (action === "foldersFav") {
      if (!f) return;
      const p = PROMPTS.find(p => promptKey(p) === key) || normalizePrompt(f);
      openFolderPickerForPrompt(p);
      return;
    }
  }

  function onHistoryClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action !== "loadHist") return;

    const title = decodeURIComponent(btn.dataset.title || "");
    if (!title) return;

    const hist = load(LS.hist, []);
    const h = hist.find(x => x.title === title);
    if (!h) return;

    const p = PROMPTS.find(p => p.title === h.title) || normalizePrompt({ ...h, terrain: ["Any"], constraints: ["(From history)"] });
    renderPrompt(p, "HISTORY");
    setTab("prompt");
  }

  // -------- TIMER (existing overlay) --------
  function openTimer() {
    if (!el.timerOverlay) return toast("Timer UI not found.");
    el.timerOverlay.classList.remove("hidden");
  }
  function closeTimer() {
    if (!el.timerOverlay) return;
    el.timerOverlay.classList.add("hidden");
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    timerEnd = null;
    if (el.timeLeft) el.timeLeft.textContent = "00:00";
    if (el.timerHint) el.timerHint.textContent = "Not started";
    toast("Timer stopped");
  }

  function startTimer(min) {
    if (timerId) clearInterval(timerId);
    timerEnd = Date.now() + min * 60000;
    if (el.timerHint) el.timerHint.textContent = `Shooting for ${min} min`;
    tickTimer();
    timerId = setInterval(tickTimer, 250);
    toast(`${min} min timer started`);
  }

  function tickTimer() {
    if (!timerEnd) return;
    const ms = Math.max(0, timerEnd - Date.now());
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    if (el.timeLeft) el.timeLeft.textContent = `${mm}:${ss}`;
    if (ms <= 0) {
      stopTimer();
      toast("Time! Pick your best shot.");
    }
  }

  // -------- DAILY OVERLAY (auto-create if missing) --------
  function ensureDailyOverlay() {
    if (document.getElementById("psDailyOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "psDailyOverlay";
    overlay.className = "overlay hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Daily prompt");

    overlay.innerHTML = `
      <div class="modal">
        <div class="modalHead">
          <strong>Daily Prompt</strong>
          <button class="ghost" type="button" data-action="closeDaily" aria-label="Close">✕</button>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          <span class="pill" id="psDailyCat">—</span>
          <span class="pill subtle" id="psDailyDiff">—</span>
          <span class="pill subtle" id="psDailyTerrain">—</span>
        </div>

        <h3 style="margin:6px 0 6px; font-size:18px;" id="psDailyTitle">—</h3>
        <p class="muted" style="margin:0 0 10px;" id="psDailyText">—</p>

        <div class="mini">
          <div class="miniLabel">Quick constraints</div>
          <ul id="psDailyConstraints"></ul>
        </div>

        <div class="row" style="margin-top:12px;">
          <button type="button" data-action="useDaily">Use this</button>
          <button class="secondary" type="button" data-action="copyDaily">Copy</button>
          <button class="secondary" type="button" data-action="saveDaily">☆ Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // close on outside tap
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) showOverlay("psDailyOverlay", false);
    });

    // internal button actions
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === "closeDaily") showOverlay("psDailyOverlay", false);
      if (action === "useDaily") applyDailyCandidate();
      if (action === "copyDaily") copyDailyCandidate();
      if (action === "saveDaily") saveDailyCandidate();
    });
  }

  function fillDailyOverlay(p) {
    const cat = $("psDailyCat");
    const diff = $("psDailyDiff");
    const terr = $("psDailyTerrain");
    const title = $("psDailyTitle");
    const text = $("psDailyText");
    const ul = $("psDailyConstraints");

    if (cat) cat.textContent = p.cat.toUpperCase();
    if (diff) diff.textContent = p.diff.toUpperCase();
    if (terr) terr.textContent = (p.terrain[0] || "Any").toUpperCase();
    if (title) title.textContent = p.title;
    if (text) text.textContent = p.text;

    if (ul) {
      ul.innerHTML = "";
      (p.constraints || []).forEach(c => {
        const li = document.createElement("li");
        li.textContent = c;
        ul.appendChild(li);
      });
    }

    // Update Save button label inside daily modal
    const favMap = load(LS.favData, {});
    const key = promptKey(p);
    const isFav = !!favMap[key];
    const saveBtn = document.querySelector("#psDailyOverlay button[data-action='saveDaily']");
    if (saveBtn) saveBtn.textContent = isFav ? "★ Saved" : "☆ Save";
  }

  async function copyDailyCandidate() {
    if (!dailyCandidate) return;
    const p = dailyCandidate;
    const txt =
`PhotoSpark Daily — ${p.title}
${p.cat} • ${p.diff} • ${(p.terrain.join(", ") || "Any")}

${p.text}

Constraints:
- ${(p.constraints || []).join("\n- ")}`;

    try {
      await navigator.clipboard.writeText(txt);
      toast("Copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Copied");
    }
  }

  function saveDailyCandidate() {
    if (!dailyCandidate) return;
    openFolderPickerForPrompt(dailyCandidate, { fromDaily: true });
  }

  function showOverlay(id, show) {
    const o = document.getElementById(id);
    if (!o) return;
    o.classList.toggle("hidden", !show);
  }

  // -------- FOLDER PICKER (auto-create) --------
  function ensureFolderPickerOverlay() {
    if (document.getElementById("psFolderOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "psFolderOverlay";
    overlay.className = "overlay hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Choose folders");

    overlay.innerHTML = `
      <div class="modal">
        <div class="modalHead">
          <strong>Save to folders</strong>
          <button class="ghost" type="button" data-action="closeFolders" aria-label="Close">✕</button>
        </div>

        <div class="muted" style="margin:6px 0 10px;">
          Choose folders for this prompt. “All” shows everything.
        </div>

        <div id="psFolderPromptTitle" style="font-weight:900;margin-bottom:10px;">—</div>

        <div id="psFolderList" style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto;padding-right:2px;"></div>

        <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,.12);padding-top:12px;">
          <label class="field field-full">
            <span>New folder name</span>
            <input id="psNewFolderName" type="text" placeholder="e.g., Night ideas, Desert hard, Portrait mood" />
          </label>
          <div class="row" style="margin-top:10px;">
            <button class="secondary" type="button" data-action="createFolder">+ Create</button>
          </div>
        </div>

        <div class="row" style="margin-top:14px;">
          <button type="button" data-action="saveFolders">Save</button>
          <button class="secondary" type="button" data-action="saveUnfiled">Save (no folder)</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) showOverlay("psFolderOverlay", false);
    });

    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.dataset.action;
      if (!action) return;

      if (action === "closeFolders") showOverlay("psFolderOverlay", false);
      if (action === "createFolder") createFolderFromOverlay();
      if (action === "saveFolders") saveFoldersFromOverlay({ assign: true });
      if (action === "saveUnfiled") saveFoldersFromOverlay({ assign: false });
    });
  }

  let folderOverlayPrompt = null; // prompt object currently being filed

  function openFolderPickerForPrompt(p) {
    folderOverlayPrompt = p;
    ensureFolderPickerOverlay();

    const titleEl = $("psFolderPromptTitle");
    if (titleEl) titleEl.textContent = p.title;

    renderFolderCheckboxesForPrompt(p);
    // clear input
    const inp = $("psNewFolderName");
    if (inp) inp.value = "";

    showOverlay("psFolderOverlay", true);
  }

  function renderFolderCheckboxesForPrompt(p) {
    const list = $("psFolderList");
    if (!list) return;

    const store = ensureFolderStore();
    const key = promptKey(p);
    const assigned = new Set(store.assign[key] || []);

    // Build checkbox list
    const rows = store.order.map(id => {
      const name = store.folders[id]?.name || "Folder";
      const checked = assigned.has(id) ? "checked" : "";
      return `
        <label style="display:flex;align-items:center;gap:10px;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px 12px;background:rgba(0,0,0,.18);">
          <input type="checkbox" data-fid="${id}" ${checked} />
          <span style="font-weight:850;">${escapeHtml(name)}</span>
        </label>
      `;
    }).join("");

    list.innerHTML = rows || `<div class="item"><small>No folders yet. Create one below.</small></div>`;
  }

  function createFolderFromOverlay() {
    const inp = $("psNewFolderName");
    const name = (inp?.value || "").trim();
    if (!name) return toast("Type a folder name first.");

    const store = ensureFolderStore();
    const id = newFolderId();
    store.folders[id] = { name, created: Date.now() };
    store.order.unshift(id);
    save(LS.favFolders, store);

    if (inp) inp.value = "";
    renderFolderCheckboxesForPrompt(folderOverlayPrompt || current);
    renderFavorites();
    toast("Folder created");
  }

  function saveFoldersFromOverlay({ assign }) {
    if (!folderOverlayPrompt) return;

    const p = folderOverlayPrompt;
    const key = promptKey(p);

    // Always save prompt as favorite (data)
    const favMap = load(LS.favData, {});
    favMap[key] = {
      cat: p.cat,
      diff: p.diff,
      terrain: p.terrain,
      title: p.title,
      text: p.text,
      constraints: p.constraints,
      ts: favMap[key]?.ts || Date.now()
    };
    save(LS.favData, favMap);

    // Folder assignment
    if (assign) {
      const list = $("psFolderList");
      const checked = [];
      if (list) {
        list.querySelectorAll("input[type='checkbox']").forEach(cb => {
          if (cb.checked) checked.push(cb.getAttribute("data-fid"));
        });
      }
      setPromptFolders(key, checked);
    } else {
      // unfiled: remove assignments
      setPromptFolders(key, []);
    }

    // update buttons + ui
    if (el.saveBtn && current && promptKey(current) === key) el.saveBtn.textContent = "★ Saved";

    // daily modal save label update if open
    if (dailyCandidate && promptKey(dailyCandidate) === key) fillDailyOverlay(dailyCandidate);

    renderFavorites();
    updateStats();
    toast("Saved");
    showOverlay("psFolderOverlay", false);
  }

  // -------- FOLDER MANAGER (simple) --------
  function ensureFolderManagerOverlay() {
    if (document.getElementById("psFolderManagerOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "psFolderManagerOverlay";
    overlay.className = "overlay hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Manage folders");

    overlay.innerHTML = `
      <div class="modal">
        <div class="modalHead">
          <strong>Manage folders</strong>
          <button class="ghost" type="button" data-action="closeManage" aria-label="Close">✕</button>
        </div>

        <div class="muted" style="margin:6px 0 10px;">
          Rename or delete folders. “All” is automatic.
        </div>

        <div id="psManageFolderList" style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto;padding-right:2px;"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) showOverlay("psFolderManagerOverlay", false);
    });

    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "closeManage") showOverlay("psFolderManagerOverlay", false);

      if (action === "renameFolder") {
        const id = btn.dataset.id;
        const inp = document.querySelector(`#psManageFolderList input[data-id="${id}"]`);
        const name = (inp?.value || "").trim();
        if (!name) return toast("Name can’t be empty.");
        const store = ensureFolderStore();
        if (!store.folders[id]) return;
        store.folders[id].name = name;
        save(LS.favFolders, store);
        renderFavorites();
        toast("Renamed");
      }

      if (action === "deleteFolder") {
        const id = btn.dataset.id;
        const store = ensureFolderStore();
        if (!store.folders[id]) return;
        // remove folder
        delete store.folders[id];
        store.order = store.order.filter(x => x !== id);
        // remove assignments
        Object.keys(store.assign).forEach(k => {
          store.assign[k] = (store.assign[k] || []).filter(fid => fid !== id);
          if (!store.assign[k].length) delete store.assign[k];
        });
        save(LS.favFolders, store);
        if (activeFavFolder === id) setActiveFavFolder("all");
        renderFolderManagerList();
        renderFavorites();
        toast("Deleted");
      }
    });
  }

  function openFolderManager() {
    ensureFolderManagerOverlay();
    renderFolderManagerList();
    showOverlay("psFolderManagerOverlay", true);
  }

  function renderFolderManagerList() {
    const list = $("psManageFolderList");
    if (!list) return;

    const store = ensureFolderStore();
    if (!store.order.length) {
      list.innerHTML = `<div class="item"><small>No folders yet. Create one from the Save modal.</small></div>`;
      return;
    }

    list.innerHTML = store.order.map(id => {
      const name = store.folders[id]?.name || "Folder";
      return `
        <div class="item">
          <small>Folder</small>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
            <input data-id="${id}" type="text" value="${escapeAttr(name)}" style="flex:1;" />
            <button class="secondary" type="button" data-action="renameFolder" data-id="${id}">Save</button>
          </div>
          <div class="miniRow" style="margin-top:10px;">
            <button class="secondary" type="button" data-action="deleteFolder" data-id="${id}">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // -------- UTIL: escaping --------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  // -------- DATA LOADING --------
  async function fetchPrompts() {
    const res = await fetch(PROMPTS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${PROMPTS_URL} (${res.status})`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error("data.json must be an array of prompt objects");
    return json.map(normalizePrompt);
  }

  async function loadPrompts() {
    const cached = load(CACHE_KEY, null);
    if (Array.isArray(cached) && cached.length) {
      PROMPTS = cached;
      renderFavorites();
      renderHistory();
      updateStats();
      newPrompt();

      // background refresh (safe)
      fetchPrompts()
        .then(fresh => { PROMPTS = fresh; save(CACHE_KEY, PROMPTS); })
        .catch(() => {});
      return;
    }

    showLoading(true);
    try {
      const fresh = await fetchPrompts();
      PROMPTS = fresh;
      save(CACHE_KEY, PROMPTS);
      renderFavorites();
      renderHistory();
      updateStats();
      newPrompt();
    } finally {
      showLoading(false);
    }
  }

  // -------- EVENTS --------
  function wireEvents() {
    // Tabs
    el.tabs.forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));

    // Main actions
    el.newBtn?.addEventListener("click", newPrompt);
    el.dailyBtn?.addEventListener("click", openDailyModal);
    el.saveBtn?.addEventListener("click", onSaveClicked);
    el.doneBtn?.addEventListener("click", markDone);
    el.shareBtn?.addEventListener("click", copyCurrent);

    // Filters
    el.category?.addEventListener("change", newPrompt);
    el.diff?.addEventListener("change", newPrompt);
    el.terrain?.addEventListener("change", newPrompt);
    el.search?.addEventListener("input", debounce(newPrompt, 220));

    // Favorites / history clicks
    el.favoritesList?.addEventListener("click", onFavoritesClick);
    el.historyList?.addEventListener("click", onHistoryClick);

    el.clearFavBtn?.addEventListener("click", () => {
      localStorage.removeItem(LS.favData);
      localStorage.removeItem(LS.favFolders);
      renderFavorites();
      updateStats();
      toast("Favorites cleared");
      // update save button if needed
      if (el.saveBtn) el.saveBtn.textContent = "☆ Save";
    });

    el.clearHistBtn?.addEventListener("click", () => {
      localStorage.removeItem(LS.hist);
      renderHistory();
      updateStats();
      toast("History cleared");
    });

    // Timer controls (existing overlay)
    el.timerBtn?.addEventListener("click", openTimer);
    el.closeTimerBtn?.addEventListener("click", closeTimer);
    el.stopTimerBtn?.addEventListener("click", stopTimer);

    document.querySelectorAll(".tbtn").forEach(b => {
      b.addEventListener("click", () => startTimer(Number(b.dataset.min)));
    });

    el.timerOverlay?.addEventListener("click", (e) => {
      if (e.target === el.timerOverlay) closeTimer();
    });

    // Escape closes overlays
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeTimer();
        showOverlay("psDailyOverlay", false);
        showOverlay("psFolderOverlay", false);
        showOverlay("psFolderManagerOverlay", false);
      }
    });
  }

  // -------- INIT --------
  wireEvents();
  loadPrompts().catch(err => {
    showLoading(false);
    if (el.title) el.title.textContent = "Couldn’t load prompts";
    if (el.text) el.text.textContent = "Check that data.json exists in the repo root and is valid JSON.";
    toast(err.message);
    console.error(err);
  });

  // Make sure favorites/history render even before prompts loaded
  renderFavorites();
  renderHistory();
  updateStats();

  // Ensure overlays exist lazily (only create when needed)
});
