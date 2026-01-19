/* =========================
   PhotoSpark — app.js
   Option A: loads prompts from data.json

   Includes:
   (1) Versioned cache reset (DATA_VERSION)
   (2) Debounced search (smooth for 10k)
   (3) No repeats (New Prompt avoids showing same prompt twice)
   (4) Smart relax + terrain preference when pool is empty / small
   ========================= */

document.addEventListener("DOMContentLoaded", () => {
  // -------- CONFIG --------
  const PROMPTS_URL = "data.json";

  // BUMP THIS whenever you replace/expand data.json
  const DATA_VERSION = "2026-01-19-15000";

  const CACHE_KEY = `ps_prompts_cache_${DATA_VERSION}`;

  const LS = {
    fav: "ps_fav_v1",
    hist: "ps_hist_v1",
    streak: "ps_streak_v1",
    streakDate: "ps_streak_date_v1",
    lastPromptKey: "ps_last_prompt_key_v1"
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

    // Overlays
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

  // -------- UI HELPERS --------
  function showLoading(show) {
    if (!el.loadingOverlay) return;
    el.loadingOverlay.classList.toggle("hidden", !show);
    el.loadingOverlay.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function showTimer(show) {
    if (!el.timerOverlay) return;
    el.timerOverlay.classList.toggle("hidden", !show);
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
    // stable enough for "no repeats" even with duplicates
    return `${p.cat}||${p.diff}||${p.title}`.toLowerCase();
  }

  // -------- FILTERING (strict pool) --------
  function strictPool() {
    const c = el.category.value;
    const d = el.diff.value;
    const t = el.terrain.value;
    const q = (el.search.value || "").trim().toLowerCase();

    return PROMPTS.filter(p => {
      const catOk = (c === "any" || p.cat === c);
      const diffOk = (d === "any" || p.diff === d);
      const terrOk = (t === "any" || p.terrain.includes(t));
      if (!catOk || !diffOk || !terrOk) return false;
      if (!q) return true;
      return p._hay.includes(q);
    });
  }

  // -------- (4) SMART RELAX POOL --------
  function relaxedPool() {
    // Start strict, then relax in order if empty
    const original = {
      c: el.category.value,
      d: el.diff.value,
      t: el.terrain.value,
      q: (el.search.value || "").trim()
    };

    let arr = strictPool();
    if (arr.length) return { arr, mode: baseModeLabel(), relaxed: false };

    // 1) drop search
    if (original.q) {
      el.search.value = "";
      arr = strictPool();
      if (arr.length) {
        toast("No matches — search cleared.");
        return { arr, mode: "RELAXED", relaxed: true };
      }
    }

    // 2) drop difficulty
    if (original.d !== "any") {
      el.diff.value = "any";
      arr = strictPool();
      if (arr.length) {
        toast("No matches — difficulty set to Any.");
        return { arr, mode: "RELAXED", relaxed: true };
      }
    }

    // 3) drop category
    if (original.c !== "any") {
      el.category.value = "any";
      arr = strictPool();
      if (arr.length) {
        toast("No matches — category set to Any.");
        return { arr, mode: "RELAXED", relaxed: true };
      }
    }

    // 4) drop terrain
    if (original.t !== "any") {
      el.terrain.value = "any";
      arr = strictPool();
      if (arr.length) {
        toast("No matches — terrain set to Any.");
        return { arr, mode: "RELAXED", relaxed: true };
      }
    }

    // Still empty: restore (rare; means PROMPTS empty)
    el.category.value = original.c;
    el.diff.value = original.d;
    el.terrain.value = original.t;
    el.search.value = original.q;

    return { arr: [], mode: baseModeLabel(), relaxed: false };
  }

  function baseModeLabel() {
    return (el.search.value || "").trim() ? "SEARCH" : "RANDOM";
  }

  // Prefer exact terrain matches first (when terrain filter is set)
  function terrainPreferred(arr) {
    const t = el.terrain.value;
    if (t === "any") return arr;
    const exact = arr.filter(p => p.terrain.includes(t));
    return exact.length ? exact : arr;
  }

  // -------- DAILY deterministic pick --------
  function dailyKey() {
    const q = (el.search.value || "").trim().toLowerCase();
    return `${new Date().toDateString()}|${el.category.value}|${el.diff.value}|${el.terrain.value}|${q}`;
  }

  function deterministicPick(arr, key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return arr[h % arr.length];
  }

  // -------- RENDERING --------
  function updateStats() {
    const favs = load(LS.fav, []);
    const hist = load(LS.hist, []);
    const s = Number(localStorage.getItem(LS.streak) || "0");

    el.streakNum.textContent = String(s);
    el.favNum.textContent = String(favs.length);
    el.histNum.textContent = String(hist.length);
  }

  function renderPrompt(p, modeLabel) {
    current = p;

    const primaryTerrain = (p.terrain[0] || "Any").toUpperCase();
    el.pillCat.textContent = p.cat.toUpperCase();
    el.pillDiff.textContent = p.diff.toUpperCase();
    el.pillTerrain.textContent = primaryTerrain;
    el.pillMode.textContent = modeLabel;

    el.title.textContent = p.title;
    el.text.textContent = p.text;

    el.constraints.innerHTML = "";
    (p.constraints || []).forEach(x => {
      const li = document.createElement("li");
      li.textContent = x;
      el.constraints.appendChild(li);
    });

    const favs = load(LS.fav, []);
    const isFav = favs.some(x => x.title === p.title && x.cat === p.cat);
    el.saveBtn.textContent = isFav ? "★ Saved" : "☆ Save";

    if (modeLabel === "DAILY") {
      el.noteLine.textContent = "Daily: stays the same all day for your current filters/search.";
    } else if ((el.search.value || "").trim()) {
      el.noteLine.textContent = "Search is active: prompts are chosen only from matches.";
    } else {
      el.noteLine.textContent = "Tip: Tap Done after you shoot to build your streak.";
    }

    // store last prompt key for "no repeats"
    localStorage.setItem(LS.lastPromptKey, promptKey(p));

    updateStats();
  }

  function pushHistory(p) {
    const hist = load(LS.hist, []);
    const entry = { cat: p.cat, diff: p.diff, title: p.title, text: p.text, ts: Date.now() };
    const next = [entry, ...hist.filter(h => h.title !== p.title)].slice(0, 80);
    save(LS.hist, next);
    renderHistory();
    updateStats();
  }

  function renderFavorites() {
    const favs = load(LS.fav, []);
    el.favoritesList.innerHTML = favs.length
      ? ""
      : `<div class="item"><small>No favorites yet. Save prompts you want to repeat.</small></div>`;

    favs.forEach(f => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <strong>${f.title}</strong>
        <small>${f.cat} • ${f.diff}</small>
        <div class="miniRow">
          <button class="secondary" type="button" data-action="load" data-title="${encodeURIComponent(f.title)}">Load</button>
          <button class="secondary" type="button" data-action="remove" data-title="${encodeURIComponent(f.title)}">Remove</button>
        </div>
      `;
      el.favoritesList.appendChild(div);
    });
  }

  function renderHistory() {
    const hist = load(LS.hist, []);
    el.historyList.innerHTML = hist.length
      ? ""
      : `<div class="item"><small>No history yet. Tap New Prompt to start.</small></div>`;

    hist.forEach(h => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <strong>${h.title}</strong>
        <small>${h.cat} • ${h.diff}</small>
        <div class="miniRow">
          <button class="secondary" type="button" data-action="loadHist" data-title="${encodeURIComponent(h.title)}">Load</button>
        </div>
      `;
      el.historyList.appendChild(div);
    });
  }

  // -------- CORE ACTIONS --------
  // (3) No repeats: re-pick a few times if same prompt as last
  function pickNoRepeat(arr) {
    const lastKey = localStorage.getItem(LS.lastPromptKey) || "";
    if (arr.length <= 1) return arr[0];

    // Prefer exact terrain matches first (4)
    const preferred = terrainPreferred(arr);

    for (let tries = 0; tries < 8; tries++) {
      const p = pick(preferred);
      if (promptKey(p) !== lastKey) return p;
    }
    // fallback
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

  function dailyPrompt() {
    const arr = strictPool();
    if (!arr.length) {
      toast("No matches for Daily. Adjust filters/search.");
      return;
    }
    // still prefer terrain if set (small improvement)
    const preferred = terrainPreferred(arr);
    const p = deterministicPick(preferred, dailyKey());
    renderPrompt(p, "DAILY");
    pushHistory(p);
    toast("Daily prompt loaded");
  }

  function toggleFavorite() {
    if (!current) return;

    const favs = load(LS.fav, []);
    const idx = favs.findIndex(x => x.title === current.title && x.cat === current.cat);

    if (idx >= 0) {
      favs.splice(idx, 1);
      toast("Removed from favorites");
    } else {
      favs.unshift({ cat: current.cat, diff: current.diff, title: current.title, text: current.text });
      toast("Saved");
    }

    save(LS.fav, favs.slice(0, 1000));
    renderFavorites();

    const isFav = load(LS.fav, []).some(x => x.title === current.title && x.cat === current.cat);
    el.saveBtn.textContent = isFav ? "★ Saved" : "☆ Save";
    updateStats();
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
    Object.entries(el.panels).forEach(([k, panel]) => {
      panel.classList.toggle("active", k === name);
    });
  }

  // -------- LIST CLICK HANDLERS --------
  function listHandler(e) {
    const btn = e.target.closest("button");
    if (!btn) return;

    const action = btn.dataset.action;
    if (!action) return;

    const title = decodeURIComponent(btn.dataset.title || "");

    if (action === "load") {
      const favs = load(LS.fav, []);
      const f = favs.find(x => x.title === title);
      if (!f) return;

      const p = PROMPTS.find(p => p.title === f.title && p.cat === f.cat);
      if (p) {
        renderPrompt(p, "FAVORITE");
        setTab("prompt");
      }
    }

    if (action === "remove") {
      const favs = load(LS.fav, []);
      const idx = favs.findIndex(x => x.title === title);
      if (idx >= 0) {
        favs.splice(idx, 1);
        save(LS.fav, favs);
        renderFavorites();
        updateStats();
        toast("Removed");
      }
    }

    if (action === "loadHist") {
      const hist = load(LS.hist, []);
      const h = hist.find(x => x.title === title);
      if (!h) return;

      const p = PROMPTS.find(p => p.title === h.title);
      if (p) {
        renderPrompt(p, "HISTORY");
        setTab("prompt");
      }
    }
  }

  // -------- TIMER --------
  function openTimer() { showTimer(true); }
  function closeTimer() { showTimer(false); }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    timerEnd = null;
    el.timeLeft.textContent = "00:00";
    el.timerHint.textContent = "Not started";
    toast("Timer stopped");
  }

  function startTimer(min) {
    if (timerId) clearInterval(timerId);
    timerEnd = Date.now() + min * 60000;
    el.timerHint.textContent = `Shooting for ${min} min`;
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
    el.timeLeft.textContent = `${mm}:${ss}`;
    if (ms <= 0) {
      stopTimer();
      toast("Time! Pick your best shot.");
    }
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

      // background refresh
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
    el.newBtn.addEventListener("click", newPrompt);
    el.dailyBtn.addEventListener("click", dailyPrompt);
    el.saveBtn.addEventListener("click", toggleFavorite);
    el.doneBtn.addEventListener("click", markDone);
    el.shareBtn.addEventListener("click", copyCurrent);

    // Filters: changing filters = new prompt from new pool
    el.category.addEventListener("change", newPrompt);
    el.diff.addEventListener("change", newPrompt);
    el.terrain.addEventListener("change", newPrompt);

    // Debounced search
    el.search.addEventListener("input", debounce(newPrompt, 220));

    // Lists
    el.favoritesList.addEventListener("click", listHandler);
    el.historyList.addEventListener("click", listHandler);

    el.clearFavBtn.addEventListener("click", () => {
      localStorage.removeItem(LS.fav);
      renderFavorites();
      updateStats();
      toast("Favorites cleared");
    });

    el.clearHistBtn.addEventListener("click", () => {
      localStorage.removeItem(LS.hist);
      renderHistory();
      updateStats();
      toast("History cleared");
    });

    // Timer
    el.timerBtn.addEventListener("click", openTimer);
    el.closeTimerBtn.addEventListener("click", closeTimer);
    el.stopTimerBtn.addEventListener("click", stopTimer);

    document.querySelectorAll(".tbtn").forEach(b => {
      b.addEventListener("click", () => startTimer(Number(b.dataset.min)));
    });

    el.timerOverlay.addEventListener("click", (e) => {
      if (e.target === el.timerOverlay) closeTimer();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.timerOverlay.classList.contains("hidden")) closeTimer();
    });
  }

  // -------- INIT --------
  wireEvents();
  loadPrompts().catch(err => {
    showLoading(false);
    el.title.textContent = "Couldn’t load prompts";
    el.text.textContent = "Check that data.json exists in the repo root and is valid JSON.";
    toast(err.message);
    console.error(err);
  });
});
