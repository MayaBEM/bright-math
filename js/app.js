/* Bright EngMath Word Quest — app logic */
"use strict";

/* ================= State & storage ================= */
const STORE_KEY = "bem-wordquest-v1";

function blankSetState() {
  return {
    learned: {},
    activities: {
      learn: { done: false },
      match: { done: false, best: 0 },
      listen: { done: false, best: 0 },
      challenge: { done: false, best: 0, stars: 0, pct: 0 }
    },
    review: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      WQ_SETS.forEach(set => { if (!s.sets[set.id]) s.sets[set.id] = blankSetState(); });
      return s;
    }
  } catch (e) { /* corrupted -> start fresh */ }
  const s = { name: "", sets: {} };
  WQ_SETS.forEach(set => { s.sets[set.id] = blankSetState(); });
  return s;
}

const state = loadState();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

/* ================= Helpers ================= */
const $ = sel => document.querySelector(sel);
const app = () => $("#app");

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function getSet(id) { return WQ_SETS.find(s => s.id === id); }
function setState(id) { return state.sets[id]; }
function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function starsHTML(n, total = 3, cls = "") {
  let out = `<span class="stars ${cls}" role="img" aria-label="${n} of ${total} stars">`;
  for (let i = 0; i < total; i++) out += `<span class="${i < n ? "on" : "off"}">⭐</span>`;
  return out + "</span>";
}
function toast(msg) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ================= Audio (Web Speech) ================= */
let voices = [];
function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
function pickVoice() {
  const prefs = ["en-GB", "en-US", "en"];
  for (const p of prefs) {
    const v = voices.find(v => v.lang && v.lang.startsWith(p) && /google|samantha|daniel|serena|karen/i.test(v.name))
          || voices.find(v => v.lang && v.lang.startsWith(p));
    if (v) return v;
  }
  return null;
}
let activeAudioBtn = null;
function speak(text, slow, btn) {
  if (!window.speechSynthesis) { toast("Audio is not supported on this browser."); return; }
  speechSynthesis.cancel();                       // prevent overlap
  if (activeAudioBtn) activeAudioBtn.classList.remove("playing");
  const u = new SpeechSynthesisUtterance(text.replace(/-/g, " "));
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = (v && v.lang) || "en-GB";
  u.rate = slow ? 0.55 : 0.92;
  u.pitch = 1.05;
  if (btn) {
    activeAudioBtn = btn;
    btn.classList.add("playing");
    u.onend = u.onerror = () => { btn.classList.remove("playing"); if (activeAudioBtn === btn) activeAudioBtn = null; };
  }
  speechSynthesis.speak(u);
}

/* ================= Theme & router ================= */
function applyTheme(theme) { document.body.dataset.theme = theme || "island"; renderDecor(theme || "island"); }

function renderDecor(theme) {
  const layer = $("#bgDecor");
  if (!layer || layer.dataset.theme === theme) return;
  layer.dataset.theme = theme;
  let html = "";
  if (theme === "future") {
    for (let i = 0; i < 14; i++)
      html += `<span class="decor-star" style="left:${Math.random() * 96}%;top:${Math.random() * 90}%;animation-delay:${(Math.random() * 4).toFixed(1)}s"></span>`;
    html += `<span class="decor-orbit" style="width:340px;height:340px;left:-120px;top:-100px"></span>`;
    html += `<span class="decor-orbit" style="width:260px;height:260px;right:-90px;bottom:6%;animation-duration:120s"></span>`;
    html += `<span class="decor-glow" style="width:220px;height:220px;background:#8b5cf6;left:-70px;top:30%"></span>`;
    html += `<span class="decor-glow" style="width:200px;height:200px;background:#22c8e6;right:-60px;top:5%"></span>`;
  } else {
    html += `<span class="decor-cloud" style="top:7%;animation-delay:-6s"></span>`;
    html += `<span class="decor-cloud" style="top:16%;transform:scale(.7);animation-delay:-22s;animation-duration:55s"></span>`;
    for (let i = 0; i < 5; i++)
      html += `<span class="decor-leaf" style="left:${Math.random() * 92}%;top:${12 + Math.random() * 55}%;animation-delay:${-(Math.random() * 20).toFixed(1)}s"></span>`;
    for (let i = 0; i < 4; i++)
      html += `<span class="decor-coin" style="left:${Math.random() * 92}%;top:${20 + Math.random() * 55}%;animation-delay:${-(Math.random() * 25).toFixed(1)}s"></span>`;
    html += `<span class="decor-wave"></span><span class="decor-wave w2"></span>`;
  }
  layer.innerHTML = html;
}

const routes = {};
let current = { screen: "home", setId: null };
function go(screen, setId, extra) {
  if (window.speechSynthesis) speechSynthesis.cancel();
  current = { screen, setId };
  const set = setId ? getSet(setId) : null;
  applyTheme(set ? set.theme : "island");
  routes[screen](setId, extra);
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

/* Shared chrome */
function chrome(inner, backTo) {
  const back = backTo
    ? `<button class="btn-icon" id="backBtn" aria-label="Go back">←</button>`
    : "";
  return `
    <header class="topbar">
      ${back}
      <a class="brand-mark" href="#" id="brandHome" aria-label="Bright EngMath home">
        <span class="brand-badge" aria-hidden="true">B</span> Bright EngMath
      </a>
      <span class="spacer"></span>
    </header>
    <main class="screen" id="screenRoot">${inner}</main>
    <footer class="footer">Learn, practise, and grow with <strong>Bright EngMath</strong>. ✨</footer>`;
}
function bindChrome(backTo) {
  $("#brandHome").addEventListener("click", e => { e.preventDefault(); go("home"); });
  const b = $("#backBtn");
  if (b) b.addEventListener("click", backTo);
}

/* ================= HOME ================= */
routes.home = function () {
  const cards = WQ_SETS.map(set => {
    const ss = setState(set.id);
    const done = Object.values(ss.activities).filter(a => a.done).length;
    const pct = Math.round(done / 4 * 100);
    const started = done > 0 || Object.keys(ss.learned).length > 0;
    return `
      <article class="set-card ${set.theme}">
        <span class="set-emoji" aria-hidden="true">${set.emoji}</span>
        <div>
          <span class="set-label">Set ${set.num}</span>
          <h3>${esc(set.name)}</h3>
          <div class="set-th th">${esc(set.nameTh)}</div>
        </div>
        <div class="set-meta">
          <span class="chip">${set.words.length} words</span>
          <span class="chip">${starsHTML(ss.activities.challenge.stars)}</span>
        </div>
        <div class="set-progress">
          <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(set.name)} progress"><i style="width:${pct}%"></i></div>
          <span class="progress-label">${pct}%</span>
        </div>
        <button class="btn" data-set="${set.id}">${started ? "Continue" : "Start Learning"} →</button>
      </article>`;
  }).join("");

  app().innerHTML = chrome(`
    <section class="hero">
      <span class="hero-kicker">Vocabulary Quest ✦ P4–P6</span>
      <h1>Bright EngMath<br><span class="quest">Word Quest</span></h1>
      <p class="hero-sub">Learn, listen, read and spell new English words — and collect stars along the way!</p>
      <div class="path-preview" aria-label="Learning path">
        <span class="step">📖 Learn</span><span class="arrow" aria-hidden="true">→</span>
        <span class="step">🧩 Read &amp; Match</span><span class="arrow" aria-hidden="true">→</span>
        <span class="step">🎧 Listen &amp; Type</span><span class="arrow" aria-hidden="true">→</span>
        <span class="step">🏆 Final Challenge</span>
      </div>
    </section>
    <section class="card name-card">
      <label for="nameInput">Your name / ชื่อของหนู</label>
      <div class="name-row">
        <input class="input" id="nameInput" type="text" autocomplete="off" maxlength="30"
               placeholder="Type your name…" value="${esc(state.name)}">
      </div>
      <p class="hello-line" id="helloLine">${state.name ? "Hello, " + esc(state.name) + "! Ready for an adventure? 🌟" : ""}</p>
    </section>
    <section class="set-grid stagger">${cards}</section>
  `);
  bindChrome();

  const input = $("#nameInput");
  input.addEventListener("input", () => {
    state.name = input.value.trim();
    save();
    $("#helloLine").textContent = state.name ? `Hello, ${state.name}! Ready for an adventure? 🌟` : "";
  });
  document.querySelectorAll(".set-card .btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!state.name) {
        input.focus();
        toast("Please type your name first! ✏️");
        return;
      }
      go("overview", btn.dataset.set);
    });
  });
};

/* ================= SET OVERVIEW ================= */
function activityUnlocked(ss, actId) {
  const order = ["learn", "match", "listen", "challenge"];
  const i = order.indexOf(actId);
  if (i === 0) return true;
  return ss.activities[order[i - 1]].done;
}
function activityProgressText(set, ss, actId) {
  const a = ss.activities[actId];
  if (actId === "learn") {
    const n = Object.keys(ss.learned).length;
    return `${n}/${set.words.length} words learned`;
  }
  if (actId === "challenge" && a.done) return `Best: ${a.pct}% ${"⭐".repeat(a.stars)}`;
  if (a.done) return `Best: ${a.best}/${set.words.length}`;
  return "";
}

routes.overview = function (setId) {
  const set = getSet(setId);
  const ss = setState(setId);
  const cards = WQ_ACTIVITIES.map((act, i) => {
    const a = ss.activities[act.id];
    const unlocked = activityUnlocked(ss, act.id);
    const status = a.done ? "done" : unlocked ? "avail" : "locked";
    const statusLabel = a.done ? "✓ Completed" : unlocked ? "● Ready to play" : "🔒 Locked";
    const progText = activityProgressText(set, ss, act.id);
    const cta = a.done ? "Play again" : act.id === "learn" && Object.keys(ss.learned).length ? "Continue" : "Start";
    return `
      ${i > 0 ? '<div class="path-link" aria-hidden="true"></div>' : ""}
      <div class="activity-card ${a.done ? "completed" : ""} ${unlocked ? "" : "locked"}">
        <div class="activity-icon" aria-hidden="true">${act.icon}</div>
        <div class="activity-body">
          <h3>${act.title}</h3>
          <p class="desc">${act.desc}${progText ? ` <strong>· ${progText}</strong>` : ""}</p>
          <span class="activity-status ${status}">${statusLabel}</span>
        </div>
        <div class="activity-cta">
          <button class="btn ${unlocked ? (a.done ? "btn-secondary" : "btn-primary") : "btn-locked"}" data-act="${act.id}" ${unlocked ? "" : "disabled"}>${unlocked ? cta : "🔒 Locked"}</button>
        </div>
      </div>`;
  }).join("");

  app().innerHTML = chrome(`
    <section class="overview-head">
      <div class="set-emoji" aria-hidden="true">${set.emoji}</div>
      <h2>Set ${set.num}: ${esc(set.name)}</h2>
      <p class="th">${esc(set.nameTh)} · ${set.words.length} words</p>
      <p class="hero-sub" style="margin-top:8px">${esc(set.tagline)}</p>
    </section>
    <section class="activity-path stagger">${cards}</section>
  `, true);
  bindChrome(() => go("home"));

  document.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", () => go(btn.dataset.act, setId));
  });
};

/* ================= LEARN ================= */
routes.learn = function (setId) {
  const set = getSet(setId);
  const ss = setState(setId);
  let idx = 0;
  // resume at first unlearned word
  const firstNew = set.words.findIndex(w => !ss.learned[w.id]);
  if (firstNew > 0) idx = firstNew;
  let dir = 1;

  app().innerHTML = chrome(`
    <div class="quiz-top">
      <span class="quiz-count" id="learnCount"></span>
      <div class="progress pg-accent" aria-hidden="true"><i id="learnBar"></i></div>
    </div>
    <div id="learnCardHolder"></div>
    <nav class="learn-nav" aria-label="Word navigation">
      <button class="btn-icon" id="prevBtn" aria-label="Previous word">←</button>
      <span class="quiz-count" id="navCount"></span>
      <button class="btn-icon" id="nextBtn" aria-label="Next word">→</button>
    </nav>
  `, true);
  bindChrome(() => go("overview", setId));

  function learnedCount() { return set.words.filter(w => ss.learned[w.id]).length; }

  function render() {
    const w = set.words[idx];
    const isLearned = !!ss.learned[w.id];
    $("#learnCount").textContent = `⭐ ${learnedCount()}/${set.words.length} learned`;
    $("#navCount").textContent = `${idx + 1} / ${set.words.length}`;
    $("#learnBar").style.width = `${(learnedCount() / set.words.length) * 100}%`;

    $("#learnCardHolder").innerHTML = `
      <article class="card learn-card ${isLearned ? "is-learned" : ""} ${dir < 0 ? "swap-back" : ""}">
        <span class="word-num">${idx + 1} / ${set.words.length}</span>
        <span class="learned-flag">✓ Learned</span>
        <div class="word-visual" aria-hidden="true">${w.icon}</div>
        <h2 class="word-en" lang="en">${esc(w.word)}</h2>
        <div class="word-ipa" aria-label="Pronunciation">${esc(w.ipa)}</div>
        <div class="word-th th" lang="th">${esc(w.th)}</div>
        <p class="word-ex" lang="en"><span class="ex-label">Example</span>“${esc(w.ex)}”</p>
        <div class="audio-row">
          <button class="btn btn-audio" id="playBtn" aria-label="Play the word ${esc(w.word)}">🔊 Listen</button>
          <button class="btn btn-secondary" id="slowBtn" aria-label="Play slowly">🐢 Slow</button>
        </div>
        <div class="learn-mark">
          <button class="btn ${isLearned ? "btn-secondary" : "btn-primary"}" id="markBtn">
            ${isLearned ? "✓ Learned — tap to unmark" : "⭐ Mark as learned"}
          </button>
        </div>
      </article>`;

    $("#playBtn").addEventListener("click", e => speak(w.word, false, e.currentTarget));
    $("#slowBtn").addEventListener("click", e => speak(w.word, true, e.currentTarget));
    $("#markBtn").addEventListener("click", () => {
      if (ss.learned[w.id]) delete ss.learned[w.id];
      else {
        ss.learned[w.id] = true;
        if (!reducedMotion()) sparkleAt($("#markBtn"));
      }
      if (learnedCount() === set.words.length && !ss.activities.learn.done) {
        ss.activities.learn.done = true;
        save();
        toast("Amazing! You learned every word! 🎉");
        setTimeout(() => go("overview", setId), 900);
        return;
      }
      ss.activities.learn.done = learnedCount() === set.words.length;
      save();
      // advance to next unlearned word after marking
      if (ss.learned[w.id]) {
        const next = set.words.findIndex((x, k) => k > idx && !ss.learned[x.id]);
        const first = set.words.findIndex(x => !ss.learned[x.id]);
        if (next > -1) { dir = 1; idx = next; }
        else if (first > -1) { dir = -1; idx = first; }
      }
      render();
    });
    $("#prevBtn").disabled = idx === 0;
    $("#nextBtn").disabled = idx === set.words.length - 1;
  }

  $("#prevBtn").addEventListener("click", () => { if (idx > 0) { dir = -1; idx--; render(); } });
  $("#nextBtn").addEventListener("click", () => { if (idx < set.words.length - 1) { dir = 1; idx++; render(); } });

  // swipe support
  let sx = null;
  $("#learnCardHolder").addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, { passive: true });
  $("#learnCardHolder").addEventListener("touchend", e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (dx < -55 && idx < set.words.length - 1) { dir = 1; idx++; render(); }
    else if (dx > 55 && idx > 0) { dir = -1; idx--; render(); }
    sx = null;
  }, { passive: true });

  render();
};

function sparkleAt(el) {
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 5; i++) {
    const s = document.createElement("span");
    s.className = "sparkle";
    s.textContent = ["✨", "⭐", "🌟"][i % 3];
    s.style.left = r.left + r.width / 2 + "px";
    s.style.top = r.top + window.scrollY + "px";
    s.style.setProperty("--sx", (Math.random() * 90 - 45) + "px");
    s.style.setProperty("--sy", (-30 - Math.random() * 60) + "px");
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 800);
  }
}

/* ================= Generic quiz runner (match) ================= */
routes.match = function (setId) {
  const set = getSet(setId);
  const ss = setState(setId);
  const order = shuffle(set.words);
  let qi = 0, score = 0;
  const wrong = [];

  function question() {
    const w = order[qi];
    const distract = shuffle(set.words.filter(x => x.id !== w.id)).slice(0, 3);
    const opts = shuffle([w, ...distract]);
    const keys = ["A", "B", "C", "D"];

    app().innerHTML = chrome(`
      <div class="quiz-top">
        <span class="quiz-count">Q ${qi + 1}/${order.length}</span>
        <div class="progress pg-accent" aria-hidden="true"><i style="width:${(qi / order.length) * 100}%"></i></div>
        <span class="quiz-score" aria-label="Score">⭐ ${score}</span>
      </div>
      <section class="card q-word">
        <p class="q-prompt">🧩 Read &amp; Match · What does this word mean?</p>
        <h2 class="word-en" lang="en">${esc(w.word)}</h2>
        <div class="word-ipa">${esc(w.ipa)}</div>
        <button class="btn btn-secondary mt-4" id="hearBtn" aria-label="Hear the word">🔊 Hear it</button>
      </section>
      <div class="answers" role="group" aria-label="Answer choices">
        ${opts.map((o, i) => `
          <button class="answer-btn" data-id="${o.id}" lang="th">
            <span class="key" aria-hidden="true">${keys[i]}</span>
            <span>${esc(o.th)}</span>
            <span class="mark" aria-hidden="true"></span>
          </button>`).join("")}
      </div>
      <div id="fbZone"></div>
    `, true);
    bindChrome(() => go("overview", setId));
    $("#hearBtn").addEventListener("click", e => speak(w.word, false, e.currentTarget));

    document.querySelectorAll(".answer-btn").forEach(btn => {
      btn.addEventListener("click", () => answer(btn, w));
    });
  }

  function answer(btn, w) {
    document.querySelectorAll(".answer-btn").forEach(b => { b.disabled = true; b.classList.add("dim"); });
    const ok = btn.dataset.id === w.id;
    btn.classList.remove("dim");
    if (ok) {
      score++;
      btn.classList.add("correct");
      btn.querySelector(".mark").textContent = "✓";
      if (!reducedMotion()) sparkleAt(btn);
    } else {
      wrong.push(w.id);
      btn.classList.add("wrong");
      btn.querySelector(".mark").textContent = "✗";
      const right = document.querySelector(`.answer-btn[data-id="${w.id}"]`);
      right.classList.remove("dim");
      right.classList.add("correct");
      right.querySelector(".mark").textContent = "✓";
    }
    $("#fbZone").innerHTML = `
      <div class="feedback ${ok ? "good" : "bad"}" role="status">
        <span class="fb-icon" aria-hidden="true">${ok ? "🎉" : "💪"}</span>
        <div>
          <div class="fb-title">${ok ? "Correct! Great job!" : "Not quite — keep going!"}</div>
          <div class="fb-detail" lang="th"><strong lang="en">${esc(w.word)}</strong> = <span class="th">${esc(w.th)}</span></div>
        </div>
      </div>
      <div class="quiz-next">
        <button class="btn btn-primary btn-block btn-lg" id="nextQ">${qi + 1 < order.length ? "Next question →" : "See my score 🏁"}</button>
      </div>`;
    $("#nextQ").focus();
    $("#nextQ").addEventListener("click", () => {
      qi++;
      if (qi < order.length) question();
      else finishSimple("match", setId, score, order.length, wrong);
    });
  }

  question();
};

function finishSimple(actId, setId, score, total, wrong) {
  const ss = setState(setId);
  const a = ss.activities[actId];
  a.done = true;
  a.best = Math.max(a.best || 0, score);
  wrong.forEach(id => { if (!ss.review.includes(id)) ss.review.push(id); });
  save();
  go("miniResult", setId, { actId, score, total });
}

/* Mini result between activities */
routes.miniResult = function (setId, r) {
  const set = getSet(setId);
  const act = WQ_ACTIVITIES.find(a => a.id === r.actId);
  const pct = Math.round(r.score / r.total * 100);
  const msg = pct === 100 ? "Perfect! You're a word master! 🌟"
    : pct >= 70 ? "Great work! Nearly perfect! 💪"
    : pct >= 50 ? "Good try! Practise once more to level up! 🌱"
    : "Keep going — every try makes you stronger! 🌈";
  app().innerHTML = chrome(`
    <section class="results-hero">
      <div style="font-size:3rem" aria-hidden="true">${act.icon}</div>
      <h2>${act.title} complete!</h2>
      <p class="sub">${esc(set.name)}</p>
    </section>
    <section class="card center">
      <div class="cert-stat"><div class="val">${r.score} / ${r.total}</div><div class="lbl">Correct</div></div>
      <div class="progress pg-accent mt-4" aria-hidden="true"><i id="miniBar" style="width:0"></i></div>
      <p class="perf-msg">${msg}</p>
    </section>
    <div class="result-actions">
      <button class="btn btn-primary btn-lg" id="contBtn">Continue the quest →</button>
      <button class="btn btn-secondary" id="retryBtn">🔁 Try again</button>
    </div>
  `, true);
  bindChrome(() => go("overview", setId));
  requestAnimationFrame(() => { $("#miniBar").style.width = pct + "%"; });
  $("#contBtn").addEventListener("click", () => go("overview", setId));
  $("#retryBtn").addEventListener("click", () => go(r.actId, setId));
};

/* ================= LISTEN & TYPE ================= */
function normalizeAns(s) {
  return s.toLowerCase().trim().replace(/[\s-]+/g, " ");
}
function diffHTML(user, correct) {
  const u = user.toLowerCase(), c = correct.toLowerCase();
  let out = "";
  for (let i = 0; i < c.length; i++) {
    const ch = correct[i];
    out += (u[i] === c[i]) ? esc(ch) : `<span class="diff">${esc(ch)}</span>`;
  }
  return out;
}

routes.listen = function (setId) {
  const set = getSet(setId);
  const order = shuffle(set.words);
  let qi = 0, score = 0;
  const wrong = [];

  function question() {
    const w = order[qi];
    let hintUsed = 0;

    app().innerHTML = chrome(`
      <div class="quiz-top">
        <span class="quiz-count">Q ${qi + 1}/${order.length}</span>
        <div class="progress pg-accent" aria-hidden="true"><i style="width:${(qi / order.length) * 100}%"></i></div>
        <span class="quiz-score" aria-label="Score">⭐ ${score}</span>
      </div>
      <section class="card listen-stage">
        <p class="q-prompt">🎧 Listen &amp; Type · Listen and type the word</p>
        <button class="big-audio" id="bigPlay" aria-label="Play the word">🔊</button>
        <div class="listen-tools">
          <button class="btn btn-secondary" id="againBtn">🔁 Listen again</button>
          <button class="btn btn-secondary" id="slowBtn2">🐢 Slow</button>
          <button class="btn btn-ghost" id="hintBtn">💡 Hint</button>
        </div>
        <div class="hint-line" id="hintLine" aria-live="polite">${w.word.replace(/[a-z]/gi, "•").replace(/ /g, "  ")}</div>
        <form class="type-row" id="typeForm">
          <input class="input" id="typeInput" type="text" autocomplete="off" autocapitalize="none"
                 autocorrect="off" spellcheck="false" aria-label="Type the word you hear"
                 placeholder="Type here…">
          <button class="btn btn-primary btn-lg" type="submit">Check ✓</button>
        </form>
        <div id="fbZone"></div>
      </section>
    `, true);
    bindChrome(() => go("overview", setId));

    const play = (slow, btn) => speak(w.word, slow, btn || $("#bigPlay"));
    $("#bigPlay").addEventListener("click", e => play(false, e.currentTarget));
    $("#againBtn").addEventListener("click", () => play(false));
    $("#slowBtn2").addEventListener("click", () => play(true));
    $("#hintBtn").addEventListener("click", () => {
      hintUsed++;
      const reveal = Math.min(hintUsed, w.word.length);
      let shown = "";
      for (let i = 0; i < w.word.length; i++) {
        const ch = w.word[i];
        shown += (i < reveal || ch === " " || ch === "-") ? ch : "•";
      }
      $("#hintLine").textContent = shown;
    });

    $("#typeForm").addEventListener("submit", e => {
      e.preventDefault();
      const raw = $("#typeInput").value;
      if (!raw.trim()) { $("#typeInput").focus(); return; }
      const ok = normalizeAns(raw) === normalizeAns(w.word);
      $("#typeInput").disabled = true;
      e.target.querySelector("button[type=submit]").disabled = true;
      if (ok) { score++; if (!reducedMotion()) sparkleAt($("#typeInput")); }
      else wrong.push(w.id);

      $("#fbZone").innerHTML = `
        <div class="feedback ${ok ? "good" : "bad"}" role="status">
          <span class="fb-icon" aria-hidden="true">${ok ? "🎉" : "✏️"}</span>
          <div>
            <div class="fb-title">${ok ? "Perfect spelling!" : "Almost! Check the spelling:"}</div>
            <div class="fb-detail">
              ${ok ? `<strong lang="en">${esc(w.word)}</strong> = <span class="th" lang="th">${esc(w.th)}</span>` : `
                <span class="spell-compare">
                  <span class="lbl">You typed</span>${esc(raw)}<br>
                  <span class="lbl">Correct</span>${diffHTML(raw, w.word)}
                </span>`}
            </div>
          </div>
        </div>
        <div class="quiz-next">
          <button class="btn btn-primary btn-block btn-lg" id="nextQ">${qi + 1 < order.length ? "Next word →" : "See my score 🏁"}</button>
        </div>`;
      $("#nextQ").focus();
      $("#nextQ").addEventListener("click", () => {
        qi++;
        if (qi < order.length) question();
        else finishSimple("listen", setId, score, order.length, wrong);
      });
    });
  }

  question();
};

/* ================= FINAL CHALLENGE ================= */
routes.challenge = function (setId) {
  const set = getSet(setId);
  const ss = setState(setId);
  const words = shuffle(set.words).slice(0, 10);
  const qs = words.map((w, i) => ({ w, type: i % 2 === 0 ? "read" : "listen" }));
  let qi = 0, score = 0;
  const wrong = [];

  function question() {
    const { w, type } = qs[qi];
    const keys = ["A", "B", "C", "D"];
    let promptHTML, opts;

    if (type === "read") {
      const distract = shuffle(set.words.filter(x => x.id !== w.id)).slice(0, 3);
      opts = shuffle([w, ...distract]).map(o => ({ id: o.id, label: o.th, lang: "th" }));
      promptHTML = `
        <p class="q-prompt">🏆 Final Challenge · Reading — choose the meaning</p>
        <h2 class="word-en" lang="en">${esc(w.word)}</h2>
        <div class="word-ipa">${esc(w.ipa)}</div>`;
    } else {
      const distract = shuffle(set.words.filter(x => x.id !== w.id)).slice(0, 3);
      opts = shuffle([w, ...distract]).map(o => ({ id: o.id, label: o.word, lang: "en" }));
      promptHTML = `
        <p class="q-prompt">🏆 Final Challenge · Listening — choose what you hear</p>
        <button class="big-audio" id="bigPlay" aria-label="Play the word">🔊</button>
        <div class="listen-tools"><button class="btn btn-secondary" id="slowBtn3">🐢 Slow</button></div>`;
    }

    app().innerHTML = chrome(`
      <div class="quiz-top">
        <span class="quiz-count">Q ${qi + 1}/${qs.length}</span>
        <div class="progress" aria-hidden="true"><i style="width:${(qi / qs.length) * 100}%"></i></div>
        <span class="quiz-score" aria-label="Current score">🏆 ${score}</span>
      </div>
      <section class="card q-word">${promptHTML}</section>
      <div class="answers" role="group" aria-label="Answer choices">
        ${opts.map((o, i) => `
          <button class="answer-btn" data-id="${o.id}" lang="${o.lang}" ${o.lang === "en" ? 'style="font-family:var(--font-head)"' : ""}>
            <span class="key" aria-hidden="true">${keys[i]}</span>
            <span>${esc(o.label)}</span>
            <span class="mark" aria-hidden="true"></span>
          </button>`).join("")}
      </div>
      <div id="fbZone"></div>
    `, true);
    bindChrome(() => confirmQuit());
    if (type === "listen") {
      $("#bigPlay").addEventListener("click", e => speak(w.word, false, e.currentTarget));
      $("#slowBtn3").addEventListener("click", () => speak(w.word, true));
    }

    document.querySelectorAll(".answer-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".answer-btn").forEach(b => { b.disabled = true; b.classList.add("dim"); });
        const ok = btn.dataset.id === w.id;
        btn.classList.remove("dim");
        if (ok) {
          score++;
          btn.classList.add("correct");
          btn.querySelector(".mark").textContent = "✓";
          if (!reducedMotion()) sparkleAt(btn);
        } else {
          wrong.push(w.id);
          btn.classList.add("wrong");
          btn.querySelector(".mark").textContent = "✗";
          const right = document.querySelector(`.answer-btn[data-id="${w.id}"]`);
          right.classList.remove("dim");
          right.classList.add("correct");
          right.querySelector(".mark").textContent = "✓";
        }
        $("#fbZone").innerHTML = `
          <div class="feedback ${ok ? "good" : "bad"}" role="status">
            <span class="fb-icon" aria-hidden="true">${ok ? "🎉" : "💪"}</span>
            <div>
              <div class="fb-title">${ok ? "Correct!" : "Good try!"}</div>
              <div class="fb-detail"><strong lang="en">${esc(w.word)}</strong> = <span class="th" lang="th">${esc(w.th)}</span></div>
            </div>
          </div>
          <div class="quiz-next">
            <button class="btn btn-primary btn-block btn-lg" id="nextQ">${qi + 1 < qs.length ? "Next →" : "Finish the quest! 🏁"}</button>
          </div>`;
        $("#nextQ").focus();
        $("#nextQ").addEventListener("click", () => {
          qi++;
          if (qi < qs.length) question();
          else finishChallenge();
        });
      });
    });
  }

  function confirmQuit() { go("overview", setId); }

  function finishChallenge() {
    const total = qs.length;
    const pct = Math.round(score / total * 100);
    const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;
    const a = ss.activities.challenge;
    a.done = true;
    a.best = Math.max(a.best, score);
    a.pct = Math.max(a.pct, pct);
    a.stars = Math.max(a.stars, stars);
    wrong.forEach(id => { if (!ss.review.includes(id)) ss.review.push(id); });
    // words answered correctly can leave review list
    words.forEach(w2 => {
      if (!wrong.includes(w2.id)) {
        const k = ss.review.indexOf(w2.id);
        if (k > -1) ss.review.splice(k, 1);
      }
    });
    save();
    go("results", setId, { score, total, pct, stars, wrong });
  }

  question();
};

/* ================= RESULTS ================= */
function perfMessage(pct) {
  if (pct >= 90) return "Outstanding! You are a Word Quest champion! 🏆";
  if (pct >= 70) return "Great job! Just a little more practice for a perfect score! 🌟";
  if (pct >= 50) return "Good effort! Review the tricky words and try again — you can do it! 💪";
  return "Every explorer needs practice. Review the words and try the quest again! 🌈";
}

routes.results = function (setId, r) {
  const set = getSet(setId);
  const ss = setState(setId);
  const reviewWords = ss.review.map(id => set.words.find(w => w.id === id)).filter(Boolean);
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const starSpans = [0, 1, 2].map(i =>
    `<span class="${i < r.stars ? "" : "off"}" id="rstar${i}" style="${i < r.stars && !reducedMotion() ? `animation:starPop .5s ${0.3 + i * 0.35}s var(--ease-pop) both` : (i < r.stars ? "" : "opacity:.3;filter:grayscale(1)")}">⭐</span>`
  ).join("");

  app().innerHTML = chrome(`
    <section class="results-hero">
      <h2>Quest Complete! 🎉</h2>
      <p class="sub">Final Challenge results</p>
      <div class="result-stars" role="img" aria-label="${r.stars} of 3 stars">${starSpans}</div>
    </section>

    <article class="cert-card" id="certCard">
      <div class="cert-brand">Bright EngMath · Word Quest</div>
      <h3 class="cert-title">Certificate of Achievement</h3>
      <div class="cert-name">${esc(state.name || "Explorer")}</div>
      <div class="cert-set">Set ${set.num}: ${esc(set.name)} ${set.emoji}</div>
      <div class="cert-score-row">
        <div class="cert-stat"><div class="val">${r.score}/${r.total}</div><div class="lbl">Correct</div></div>
        <div class="cert-stat"><div class="val" id="pctVal">0%</div><div class="lbl">Score</div></div>
        <div class="cert-stat"><div class="val">${"⭐".repeat(r.stars) || "—"}</div><div class="lbl">Stars</div></div>
      </div>
      <div class="cert-date">${dateStr} · Learn, practise, and grow with Bright EngMath</div>
    </article>

    <p class="perf-msg">${perfMessage(r.pct)}</p>

    ${reviewWords.length ? `
      <section class="card review-list">
        <h3>📝 Words to review (${reviewWords.length})</h3>
        <div class="review-chip-row">
          ${reviewWords.map(w => `<span class="review-chip" lang="en">${esc(w.word)} · <span class="th" lang="th">${esc(w.th)}</span></span>`).join("")}
        </div>
      </section>` : `
      <section class="card review-list center">
        <h3>🌟 No words to review — amazing!</h3>
      </section>`}

    <div class="result-actions">
      ${reviewWords.length ? `<button class="btn btn-primary btn-lg" id="reviewBtn">📖 Review mistakes</button>` : ""}
      <button class="btn ${reviewWords.length ? "btn-secondary" : "btn-primary btn-lg"}" id="againBtn2">🔁 Try again</button>
      <button class="btn btn-secondary" id="copyBtn">📋 Copy parent report</button>
      <button class="btn btn-ghost" id="homeBtn">🏠 Return to home</button>
    </div>
  `, true);
  bindChrome(() => go("overview", setId));

  // animate percentage
  const pctEl = $("#pctVal");
  if (reducedMotion()) pctEl.textContent = r.pct + "%";
  else {
    let cur = 0;
    const step = Math.max(1, Math.round(r.pct / 30));
    const iv = setInterval(() => {
      cur = Math.min(r.pct, cur + step);
      pctEl.textContent = cur + "%";
      if (cur >= r.pct) clearInterval(iv);
    }, 30);
  }

  if (r.pct >= 80 && !reducedMotion()) confettiBurst();

  const rb = $("#reviewBtn");
  if (rb) rb.addEventListener("click", () => go("review", setId));
  $("#againBtn2").addEventListener("click", () => go("challenge", setId));
  $("#homeBtn").addEventListener("click", () => go("home"));
  $("#copyBtn").addEventListener("click", () => copyReport(set, ss, r));
};

function confettiBurst() {
  const colors = ["#f7b62c", "#0e9bb5", "#6a5cff", "#2fc27d", "#f2739b", "#22c8e6"];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("span");
    p.className = "confetti-piece";
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = (2.2 + Math.random() * 1.6) + "s";
    p.style.animationDelay = (Math.random() * 0.6) + "s";
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 4600);
  }
}

function copyReport(set, ss, r) {
  const learned = Object.keys(ss.learned).length;
  const reviewWords = ss.review.map(id => set.words.find(w => w.id === id)).filter(Boolean);
  const lines = [
    "🌟 Bright EngMath — Word Quest Report",
    "----------------------------------",
    `Student: ${state.name || "-"}`,
    `Set: ${set.num} — ${set.name} (${set.words.length} words)`,
    `Date: ${new Date().toLocaleDateString("en-GB")}`,
    "",
    `📖 Learn the Words: ${learned}/${set.words.length} learned`,
    `🧩 Read & Match best: ${ss.activities.match.best}/${set.words.length}`,
    `🎧 Listen & Type best: ${ss.activities.listen.best}/${set.words.length}`,
    `🏆 Final Challenge: ${r ? `${r.score}/${r.total} (${r.pct}%)` : `${ss.activities.challenge.best} (${ss.activities.challenge.pct}%)`} ${"⭐".repeat(ss.activities.challenge.stars)}`,
    "",
    reviewWords.length
      ? `Words to review: ${reviewWords.map(w => `${w.word} (${w.th})`).join(", ")}`
      : "Words to review: none — excellent! 🎉",
    "",
    "Learn, practise, and grow with Bright EngMath. ✨"
  ];
  const text = lines.join("\n");
  const done = () => toast("Report copied! Ready to share with parents 💌");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); }
  catch (e) { toast("Could not copy automatically."); }
  ta.remove();
}

/* ================= REVIEW MISTAKES ================= */
routes.review = function (setId) {
  const set = getSet(setId);
  const ss = setState(setId);
  const words = ss.review.map(id => set.words.find(w => w.id === id)).filter(Boolean);
  if (!words.length) { go("overview", setId); return; }
  let idx = 0;

  function render() {
    const w = words[idx];
    app().innerHTML = chrome(`
      <div class="quiz-top">
        <span class="quiz-count">Review ${idx + 1} of ${words.length}</span>
        <div class="progress pg-accent" aria-hidden="true"><i style="width:${((idx + 1) / words.length) * 100}%"></i></div>
      </div>
      <article class="card learn-card">
        <span class="word-num">📝 Review</span>
        <div class="word-visual" aria-hidden="true">${w.icon}</div>
        <h2 class="word-en" lang="en">${esc(w.word)}</h2>
        <div class="word-ipa">${esc(w.ipa)}</div>
        <div class="word-th th" lang="th">${esc(w.th)}</div>
        <p class="word-ex" lang="en"><span class="ex-label">Example</span>“${esc(w.ex)}”</p>
        <div class="audio-row">
          <button class="btn btn-audio" id="playBtn" aria-label="Play the word">🔊 Listen</button>
          <button class="btn btn-secondary" id="slowBtn" aria-label="Play slowly">🐢 Slow</button>
        </div>
      </article>
      <nav class="learn-nav" aria-label="Review navigation">
        <button class="btn-icon" id="prevBtn" aria-label="Previous word" ${idx === 0 ? "disabled" : ""}>←</button>
        <span class="quiz-count">${idx + 1} / ${words.length}</span>
        ${idx === words.length - 1
          ? `<button class="btn btn-primary" id="doneBtn">Done ✓</button>`
          : `<button class="btn-icon" id="nextBtn" aria-label="Next word">→</button>`}
      </nav>
    `, true);
    bindChrome(() => go("overview", setId));
    $("#playBtn").addEventListener("click", e => speak(w.word, false, e.currentTarget));
    $("#slowBtn").addEventListener("click", e => speak(w.word, true, e.currentTarget));
    const pb = $("#prevBtn"); if (pb) pb.addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
    const nb = $("#nextBtn"); if (nb) nb.addEventListener("click", () => { idx++; render(); });
    const db = $("#doneBtn"); if (db) db.addEventListener("click", () => go("overview", setId));
  }
  render();
};

/* ================= Boot ================= */
document.addEventListener("DOMContentLoaded", () => go("home"));
