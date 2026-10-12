/* BCOG 100 practice site — the interface.
   ---------------------------------------------------------------------------
   Reads questions and progress through SOURCE and PROGRESS, defined in
   source.js, and touches neither the network nor storage itself. Keeping that
   line clean is what makes moving the questions behind an API a one-file
   change. The study logic -- what a topic's status is, which items go into a
   check, which come back for review -- is in study.js, as STUDY, and is pure.

   Since 2026-10-11 the topic is the unit of progress. A student checks a
   topic (ten items, one per claim, unseen first), it counts as mastered at or
   above their chosen level, it comes back for review after fourteen days, and
   each practice set mixes in review items from topics already worked. */

"use strict";

var LEVEL_LABEL = { core: "Core", standard: "Standard", stretch: "Stretch" };
var LEVEL_ORDER = ["core", "standard", "stretch"];

var KIND_LABEL = {
  "definition-term": "Definition",
  "definition-reverse": "Term",
  "comparison": "Comparison",
  "application": "Application",
  "short-answer": "Short answer"
};

var FOCUS = [
  { id: "all", label: "All questions" },
  { id: "missed", label: "Missed last time" }
];

var SIZES = [10, 15, 25, "all"];
var DEFAULT_SIZE = 15;

var MASTERY_LEVELS = [70, 80, 90, 100];
var REVIEW_SHARES = [0, 10, 20, 30, 40, 50];

/* "Prepare for a quiz" checks every topic in a lecture at once. A full check
   per topic would run to forty items for a four-topic lecture, so each topic
   contributes this many instead; a lecture of four topics is twenty items. */
var QUIZ_PER_TOPIC = 5;

/* Status, as text and a symbol together. Colour is applied by class in the
   stylesheet and is never the only signal. */
var STATUS = {
  untried:    { symbol: "○", label: "Not tried" },
  practicing: { symbol: "◔", label: "Practicing" },
  mastered:   { symbol: "✓", label: "Mastered" },
  review:     { symbol: "↻", label: "Review due" }
};

var el = {};
["view-modules", "view-module", "view-settings", "module-grid", "wipe", "back",
 "mod-title", "mod-sub", "setup", "topics", "quiz-panel", "quiz-lectures",
 "sizes", "kinds", "levels", "focus", "start", "all-on", "none-on", "mod-reset",
 "avail", "runbar", "runtrack", "count", "tally", "fill", "stage", "boot",
 "settings-open", "settings-open-2", "settings-close", "settings-title",
 "set-level", "set-share", "set-scope"
].forEach(function (id) {
  el[id.replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); })] =
    document.getElementById(id);
});

/* ---- state -------------------------------------------------------- */

var index = null;          // index.json
var entry = null;          // the current module's row in index.modules
var bank = null;           // the current module's full JSON
var items = [];            // that module's items, flattened, pool info attached
var kinds = [];
var levels = [];
var selPools = [], selKinds = [], selLevels = [], selFocus = "all";
var selSize = DEFAULT_SIZE;
var topicStatusEls = [];   // one status span per pool, refreshed in place

var queue = [], at = 0, right = 0, answered = 0, missed = [];
var mode = { kind: "practice" };   // or {kind:"check", poolIndex} or {kind:"quiz", lecture, indices}
var reviewIds = {};                // ids in the current queue that are review items

var settingsOpener = null;

/* ---- small helpers ------------------------------------------------ */

function show(view) {
  el.viewModules.hidden = view !== "modules";
  el.viewModule.hidden = view !== "module";
}

function make(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text !== undefined) { n.textContent = text; }
  return n;
}

/* Every display string that came out of a bank is already HTML-escaped by the
   exporter, with the banks' three emphasis markers turned into tags. So it is
   assigned as markup, never as text -- textContent would render "Mind &amp;
   Brain" literally. Text this file writes itself uses textContent as usual. */
function rich(tag, cls, markup) {
  var n = make(tag, cls);
  n.innerHTML = markup;
  return n;
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function shuffle(a) { return STUDY.shuffle(a); }

function button(cls, label, onClick) {
  var b = make("button", cls, label);
  b.type = "button";
  if (onClick) { b.addEventListener("click", onClick); }
  return b;
}

/* An irreversible action takes two clicks rather than a modal dialog: the
   first arms the button and renames it, the second does it, and five seconds
   of nothing disarms it. */
function armable(b, idleText, armedText, action) {
  var armed = false, timer = null;
  b.textContent = idleText;
  b.addEventListener("click", function () {
    if (!armed) {
      armed = true;
      b.textContent = armedText;
      timer = setTimeout(function () { armed = false; b.textContent = idleText; }, 5000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    b.textContent = idleText;
    action();
  });
  return b;
}

/* ---- progress lookups ---------------------------------------------- */

function settings() { return PROGRESS.settings(); }

/* A history function for STUDY's samplers, backed by one read of storage. */
function historyOf(slug) {
  var map = PROGRESS.itemsOf(slug);
  return function (id) { return map[id] || null; };
}

function statusOf(slug, key) {
  var t = PROGRESS.topic(slug, key);
  return STUDY.topicStatus(t.checks, t.reviewOk, settings().masteryLevel, Date.now(), t.lapsed);
}

function statusLine(st) {
  var s = st.lastScore;
  var score = s ? s.percent + "% (" + s.correct + " of " + s.total + ")" : "";
  switch (st.state) {
    case "mastered":   return "Mastered · " + score;
    case "review":     return "Review due · last " + (s ? s.percent + "%" : "");
    case "practicing": return "Practicing · last " + score;
    default:           return "Not tried";
  }
}

function fillStatus(span, st) {
  // Replace only the status classes, so a caller's own class survives.
  var keep = span.className.split(/\s+/).filter(function (c) {
    return c && c !== "status" && !/^st-/.test(c);
  });
  span.className = keep.concat(["status", "st-" + st.state]).join(" ");
  span.innerHTML = "";
  var sym = make("span", "sym", STATUS[st.state].symbol);
  sym.setAttribute("aria-hidden", "true");
  span.appendChild(sym);
  span.appendChild(document.createTextNode(statusLine(st)));
}

/* Attach to a module's pools and items what the interface needs to know about
   them: the topic key progress is stored under, and each item's module and
   topic, so a review item from another module carries its own context. */
function annotate(data, row) {
  if (data._annotated) { return data; }
  data.pools.forEach(function (pool, pi) {
    pool.key = STUDY.topicKey(pool.title, pool.lab);
    pool.items.forEach(function (item) {
      item.poolIndex = pi;
      item.poolTitle = pool.title;
      item.topicKey = pool.key;
      item.slug = data.slug;
      item.module = data.module;
    });
  });
  data._annotated = true;
  return data;
}

/* Topic counts for a module from its stored topic records alone, so the grid
   can report them before the module is downloaded. */
function topicCounts(slug) {
  var recs = PROGRESS.topics(slug);
  var level = settings().masteryLevel;
  var now = Date.now();
  var out = { mastered: 0, review: 0, practicing: 0 };
  Object.keys(recs).forEach(function (key) {
    var t = recs[key];
    var st = STUDY.topicStatus(t.checks, t.reviewOk, level, now, t.lapsed);
    if (out[st.state] !== undefined) { out[st.state] += 1; }
  });
  return out;
}

function countsText(topics, counts) {
  var parts = [plural(topics, "topic", "topics")];
  if (counts.mastered) { parts.push(counts.mastered + " mastered"); }
  if (counts.review) { parts.push(counts.review + " review due"); }
  return parts.join(" · ");
}

/* ---- module grid -------------------------------------------------- */

function moduleCard(row) {
  var li = make("li");
  var b = make("button", "card-mod");
  b.type = "button";

  b.appendChild(make("span", "n", "Module " + row.module));
  b.appendChild(rich("span", "t", row.title));

  if (!row.file) {
    b.disabled = true;
    b.appendChild(make("span", "m", "Not available yet"));
    li.appendChild(b);
    return li;
  }

  var counts = topicCounts(row.slug);
  var meta = make("span", "m", countsText(row.pools, counts));
  if (counts.mastered) {
    var mini = make("div", "mini");
    var fill = make("i");
    fill.style.width = Math.min(counts.mastered / Math.max(row.pools, 1), 1) * 100 + "%";
    mini.appendChild(fill);
    b.appendChild(mini);
  }

  b.appendChild(meta);
  b.addEventListener("click", function () { go(row.slug); });
  li.appendChild(b);
  return li;
}

function renderGrid() {
  el.moduleGrid.innerHTML = "";
  index.modules.forEach(function (row) {
    el.moduleGrid.appendChild(moduleCard(row));
  });
}

/* ---- opening a module --------------------------------------------- */

function openModule(row) {
  entry = row;
  el.modTitle.innerHTML = "";
  el.modTitle.appendChild(document.createTextNode("Module " + row.module + " — "));
  el.modTitle.appendChild(rich("span", null, row.title));
  el.modSub.textContent = "Loading…";
  el.setup.hidden = true;
  el.quizPanel.hidden = true;
  el.stage.innerHTML = "";
  endRun();
  show("module");
  el.viewModule.scrollIntoView({ block: "start" });

  SOURCE.module(row).then(function (data) {
    bank = annotate(data, row);
    items = [];
    data.pools.forEach(function (pool) {
      pool.items.forEach(function (item) { items.push(item); });
    });

    // Remembering the ids lets the module grid report real progress next time
    // it is drawn, without downloading every module.
    row.itemIds = items.map(function (it) { return it.id; });

    kinds = [];
    items.forEach(function (it) {
      var k = it.type === "sa" ? "short-answer" : it.kind;
      if (kinds.indexOf(k) === -1) { kinds.push(k); }
    });
    levels = LEVEL_ORDER.filter(function (lv) {
      return items.some(function (it) { return it.difficulty === lv; });
    });

    selPools = data.pools.map(function (_, i) { return i; });
    selKinds = kinds.slice();
    selLevels = levels.slice();
    selFocus = "all";

    renderModuleSub();
    buildTopics();
    buildControls();
    buildQuiz();
    el.setup.hidden = false;
    refreshAvailable();
  }, function (err) {
    el.modSub.textContent = "";
    el.stage.innerHTML = "";
    el.stage.appendChild(make("p", "empty",
      "These questions could not be loaded. " + err.message));
  });
}

function renderModuleSub() {
  var groups = STUDY.groupPools(bank.pools);
  var lectures = groups.filter(function (g) { return g.lecture; }).length;
  var hasLab = groups.some(function (g) { return g.lab; });
  var shape = [];
  if (lectures) { shape.push(plural(lectures, "lecture", "lectures")); }
  if (hasLab) { shape.push("the lab"); }
  var counts = topicCounts(bank.slug);
  var parts = [plural(bank.pools.length, "topic", "topics") +
               (shape.length ? " across " + shape.join(" and ") : "")];
  if (counts.mastered) { parts.push(counts.mastered + " mastered"); }
  if (counts.review) { parts.push(counts.review + " review due"); }
  el.modSub.textContent =
    parts.join(" · ") + ". Nothing here is graded or recorded anywhere but this browser.";
}

/* ---- topics ------------------------------------------------------- */

function buildTopics() {
  el.topics.innerHTML = "";
  topicStatusEls = [];
  var groups = STUDY.groupPools(bank.pools);
  groups.forEach(function (group) {
    var sec = make("section", "group");
    var label = group.lab ? "Module " + bank.module + " lab" : group.label;
    sec.appendChild(make("h4", "group-title", label));
    group.indices.forEach(function (pi) { sec.appendChild(topicRow(pi)); });
    el.topics.appendChild(sec);
  });
}

function topicRow(pi) {
  var pool = bank.pools[pi];
  var row = make("div", "topic");

  var pickBtn = chip("", selPools.indexOf(pi) !== -1, function (on) {
    toggle(selPools, pi, on);
  });
  pickBtn.className = "chip topic-pick";
  pickBtn.innerHTML = pool.title;
  row.appendChild(pickBtn);

  var status = make("span", "status");
  fillStatus(status, statusOf(bank.slug, pool.key));
  topicStatusEls[pi] = status;
  row.appendChild(status);

  var acts = make("span", "acts");
  acts.appendChild(button("link", "Check this topic", function () { startCheck(pi); }));
  acts.appendChild(armable(button("link"), "Reset", "Click again to reset", function () {
    PROGRESS.resetTopic(bank.slug, pool.key, pool.items.map(function (it) { return it.id; }));
    refreshStatuses();
    refreshAvailable();
  }));
  row.appendChild(acts);
  return row;
}

function refreshTopicStatuses() {
  if (!bank) { return; }
  bank.pools.forEach(function (pool, pi) {
    if (topicStatusEls[pi]) { fillStatus(topicStatusEls[pi], statusOf(bank.slug, pool.key)); }
  });
}

/* Everything on screen that depends on progress or on the mastery level. */
function refreshStatuses() {
  if (!el.viewModules.hidden && index) { renderGrid(); }
  if (!el.viewModule.hidden && bank) {
    refreshTopicStatuses();
    renderModuleSub();
  }
}

function setPoolChips() {
  Array.prototype.forEach.call(el.topics.querySelectorAll(".topic-pick"), function (c, i) {
    c.setAttribute("aria-pressed", selPools.indexOf(i) !== -1 ? "true" : "false");
  });
}

/* ---- filters ------------------------------------------------------ */

function chip(label, on, onToggle) {
  var b = make("button", "chip", label);
  b.type = "button";
  b.setAttribute("aria-pressed", on ? "true" : "false");
  b.addEventListener("click", function () {
    var next = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", next ? "true" : "false");
    onToggle(next, b);
    refreshAvailable();
  });
  return b;
}

/* One choice among several: pressing one releases the others, and pressing
   the pressed one is a no-op rather than leaving none selected. */
function radioChips(container, options, current, onPick) {
  container.innerHTML = "";
  options.forEach(function (opt) {
    var b = chip(opt.label, opt.value === current, function (on, self) {
      if (!on) { self.setAttribute("aria-pressed", "true"); return; }
      Array.prototype.forEach.call(container.children, function (other) {
        if (other !== self) { other.setAttribute("aria-pressed", "false"); }
      });
      onPick(opt.value);
    });
    container.appendChild(b);
  });
}

function buildControls() {
  radioChips(el.sizes, SIZES.map(function (n) {
    return { value: n, label: n === "all" ? "All" : String(n) };
  }), selSize, function (v) { selSize = v; });

  radioChips(el.focus, FOCUS.map(function (f) {
    return { value: f.id, label: f.label };
  }), selFocus, function (v) { selFocus = v; });

  el.kinds.innerHTML = "";
  kinds.forEach(function (k) {
    el.kinds.appendChild(chip(KIND_LABEL[k] || k, selKinds.indexOf(k) !== -1, function (on) {
      toggle(selKinds, k, on);
    }));
  });
  el.levels.innerHTML = "";
  levels.forEach(function (lv) {
    el.levels.appendChild(chip(LEVEL_LABEL[lv] || lv, selLevels.indexOf(lv) !== -1, function (on) {
      toggle(selLevels, lv, on);
    }));
  });
}

function toggle(list, value, on) {
  var i = list.indexOf(value);
  if (on && i === -1) { list.push(value); }
  if (!on && i !== -1) { list.splice(i, 1); }
}

function pick() {
  return items.filter(function (it) {
    var k = it.type === "sa" ? "short-answer" : it.kind;
    if (selPools.indexOf(it.poolIndex) === -1) { return false; }
    if (selKinds.indexOf(k) === -1) { return false; }
    if (selLevels.indexOf(it.difficulty) === -1) { return false; }
    if (selFocus === "all") { return true; }
    var state = PROGRESS.itemState(bank.slug, it.id);
    return !!state && state.last === 0;    // "missed"
  });
}

function refreshAvailable() {
  if (!bank) { return; }
  var n = pick().length;
  el.avail.textContent = n
    ? plural(n, "question selected", "questions selected")
    : "No questions match these filters";
  el.start.disabled = n === 0;
}

/* ---- the quiz preset ---------------------------------------------- */

function buildQuiz() {
  var groups = STUDY.groupPools(bank.pools).filter(function (g) { return g.lecture; });
  el.quizLectures.innerHTML = "";
  if (!groups.length) { el.quizPanel.hidden = true; return; }
  groups.forEach(function (g) {
    el.quizLectures.appendChild(button("btn ghost", g.label, function () {
      startQuiz(g);
    }));
  });
  el.quizPanel.hidden = false;
}

function startQuiz(group) {
  var list = [];
  group.indices.forEach(function (pi) {
    var pool = bank.pools[pi];
    var eligible = pool.items.filter(function (it) {
      return it.type === "mc" && (it.difficulty === "core" || it.difficulty === "standard");
    });
    list = list.concat(STUDY.sampleCheck(eligible, historyOf(bank.slug), { n: QUIZ_PER_TOPIC }));
  });
  if (!list.length) { return; }
  begin(list, { kind: "quiz", lecture: group.lecture, label: group.label, indices: group.indices });
}

/* ---- a mastery check ---------------------------------------------- */

function startCheck(pi) {
  var pool = bank.pools[pi];
  var list = STUDY.sampleCheck(pool.items, historyOf(bank.slug));
  if (!list.length) {
    el.stage.innerHTML = "";
    el.stage.appendChild(make("p", "empty",
      "This topic has no multiple-choice questions to check with."));
    return;
  }
  begin(list, { kind: "check", poolIndex: pi });
}

/* ---- a practice set, with cumulative review ----------------------- */

/* Review candidates: every multiple-choice item from a topic the student has
   practiced (any item history), other than the topics selected here, in this
   module and in every other module within the review scope. Other modules are
   downloaded only if they have saved progress, through the cache in SOURCE;
   one that fails to load is skipped. */
function reviewCandidates() {
  var s = settings();
  var practiced = PROGRESS.modulesWithProgress();
  var scope = s.reviewScope
    ? practiced.filter(function (slug) { return s.reviewScope.indexOf(slug) !== -1; })
    : practiced;
  var rows = index.modules.filter(function (r) { return r.file && scope.indexOf(r.slug) !== -1; });

  return Promise.all(rows.map(function (r) {
    return SOURCE.module(r).then(function (d) { return annotate(d, r); },
                                 function () { return null; });
  })).then(function (mods) {
    var cands = [];
    var level = s.masteryLevel;
    var now = Date.now();
    mods.forEach(function (d) {
      if (!d) { return; }
      var map = PROGRESS.itemsOf(d.slug);
      var topics = PROGRESS.topics(d.slug);
      d.pools.forEach(function (pool, pi) {
        if (d.slug === bank.slug && selPools.indexOf(pi) !== -1) { return; }
        var last = 0, practicedHere = false;
        pool.items.forEach(function (it) {
          var st = map[it.id];
          if (st) { practicedHere = true; last = Math.max(last, STUDY.ms(st.seen)); }
        });
        if (!practicedHere) { return; }
        var t = topics[pool.key] || { checks: [], reviewOk: null, lapsed: null };
        var status = STUDY.topicStatus(t.checks, t.reviewOk, level, now, t.lapsed);
        pool.items.forEach(function (it) {
          if (it.type !== "mc") { return; }
          cands.push({ item: it, slug: d.slug, topicKey: pool.key,
                       review: status.state === "review", topicLast: last });
        });
      });
    });
    return cands;
  });
}

function startPractice() {
  var sel = shuffle(pick().slice());
  if (!sel.length) { return; }
  var share = settings().reviewShare;
  var all = selSize === "all";
  var size = all ? sel.length : selSize;
  var want = Math.round(size * share / 100);
  var ownCount = all ? sel.length : Math.min(sel.length, size - want);

  el.start.disabled = true;
  el.avail.textContent = "Preparing the set…";

  var gather = want > 0 ? reviewCandidates() : Promise.resolve([]);
  gather.then(function (cands) {
    var review = want > 0
      ? STUDY.sampleReview(cands, function (slug, id) { return PROGRESS.itemState(slug, id); }, want)
      : [];
    // Too few candidates: the rest of the set comes from the selection.
    if (!all && review.length < want) {
      ownCount = Math.min(sel.length, size - review.length);
    }
    var ids = {};
    var list = sel.slice(0, ownCount);
    review.forEach(function (c) { ids[c.item.id] = true; list.push(c.item); });
    begin(list, { kind: "practice" }, ids);
    refreshAvailable();
  }, function () {
    begin(sel.slice(0, all ? sel.length : Math.min(sel.length, size)), { kind: "practice" });
    refreshAvailable();
  });
}

/* ---- a run -------------------------------------------------------- */

function begin(list, newMode, review) {
  mode = newMode || { kind: "practice" };
  reviewIds = review || {};
  queue = shuffle(list.slice());
  at = 0; right = 0; answered = 0; missed = [];
  el.runbar.hidden = false;
  el.runtrack.hidden = false;
  render();
  // The panels stay open above the question, so on a phone the first
  // question would otherwise start below the fold.
  el.runbar.scrollIntoView({ block: "start" });
}

function endRun() {
  queue = []; at = 0; right = 0; answered = 0; missed = [];
  reviewIds = {};
  mode = { kind: "practice" };
  el.runbar.hidden = true;
  el.runtrack.hidden = true;
}

function runLabel() {
  if (mode.kind === "check") { return "Check"; }
  if (mode.kind === "quiz") { return "Quiz check"; }
  return "Question";
}

function progress() {
  el.count.textContent = queue.length
    ? runLabel() + " " + Math.min(at + 1, queue.length) + " of " + queue.length
    : "";
  el.tally.textContent = answered ? right + " of " + answered + " correct" : "";
  el.fill.style.width = queue.length
    ? (Math.min(at, queue.length) / queue.length * 100) + "%"
    : "0%";
}

function tagline(item) {
  var k = item.type === "sa" ? "short-answer" : item.kind;
  var rest = " · " + (KIND_LABEL[k] || k) +
             (item.difficulty ? " · " + (LEVEL_LABEL[item.difficulty] || item.difficulty) : "");
  var p = make("p", "tagline");
  if (reviewIds[item.id]) {
    p.appendChild(make("span", "review-tag", "Review · Module " + item.module + " · "));
  }
  p.appendChild(rich("span", null, item.poolTitle));
  p.appendChild(document.createTextNode(rest));
  return p;
}

function nextButton(label) {
  return button("btn", label, function () { at++; render(); });
}

/* The item's id and its source entries, shown only after an answer. The id is
   for us, when a student reports a question; the claim ids are the reading
   outline's, for anyone who wants to look the point up. Restored 2026-10-11
   at Jon's request, reversing the spec's decision to drop the footer. */
function reference(item) {
  var span = make("span", "src", item.id);
  if (item.source && item.source.length) {
    span.appendChild(document.createTextNode(" · "));
    span.appendChild(rich("span", null, item.source.join("; ")));
  }
  return span;
}

function render() {
  progress();
  el.stage.innerHTML = "";
  if (!queue.length) { return; }
  if (at >= queue.length) { renderDone(); return; }

  var item = queue[at];
  var card = make("section", "card");
  card.appendChild(tagline(item));

  var stem = make("p", "stem");
  stem.innerHTML = item.stem;
  card.appendChild(stem);

  if (item.type === "mc") { renderMC(card, item); } else { renderSA(card, item); }

  el.stage.appendChild(card);
  var first = card.querySelector(".opt, textarea");
  if (first) { first.focus(); }
}

function renderMC(card, item) {
  var list = make("ul", "opts");
  var order = shuffle(item.options.map(function (_, i) { return i; }));
  var settled = false;
  var buttons = [];

  order.forEach(function (idx, position) {
    var opt = item.options[idx];
    var li = make("li");
    var b = make("button", "opt");
    b.type = "button";

    var mark = make("span", "mark", "ABCDEFGH".charAt(position));
    mark.setAttribute("aria-hidden", "true");
    var text = make("span");
    text.innerHTML = opt.text;

    b.appendChild(mark);
    b.appendChild(text);
    li.appendChild(b);
    list.appendChild(li);
    buttons.push({ button: b, li: li, opt: opt });

    b.addEventListener("click", function () {
      if (settled) { return; }
      settled = true;
      answered++;
      if (opt.correct) { right++; } else { missed.push(item); }
      PROGRESS.record(item.slug, item.id, !!opt.correct);
      // A review item feeds back into its own topic: right restarts that
      // topic's 14-day clock, wrong sends a mastered topic back to review.
      // Neither adds a check score.
      if (reviewIds[item.id]) {
        if (opt.correct) { PROGRESS.recordReviewOk(item.slug, item.topicKey); }
        else { PROGRESS.recordLapse(item.slug, item.topicKey); }
        refreshTopicStatuses();
      }
      reveal(buttons, opt, item);
      progress();
    });
  });

  card.appendChild(list);

  function reveal(all, chosen, item) {
    all.forEach(function (e) {
      e.button.disabled = true;
      var isKey = e.opt.correct;
      var isPick = e.opt === chosen;
      if (isKey) {
        e.button.classList.add("correct");
        e.button.querySelector(".mark").textContent = "✓";
      } else if (isPick) {
        e.button.classList.add("wrong");
        e.button.querySelector(".mark").textContent = "✕";
      } else {
        e.button.classList.add("muted");
      }
      // Every option's explanation is shown, not only the two that were in
      // play. Reading why the other distractors fail is most of the value.
      var why = make("p", "why " + (isKey ? "is-right" : "is-wrong"));
      why.innerHTML = e.opt.why;
      e.li.appendChild(why);
    });

    var foot = make("div", "foot");
    var next = nextButton(at + 1 >= queue.length ? "See results" : "Next question");
    foot.appendChild(reference(item));
    foot.appendChild(next);
    card.appendChild(foot);

    var announce = make("p", "sr", chosen.correct ? "Correct." : "Not correct.");
    announce.setAttribute("role", "status");
    card.appendChild(announce);

    // The chosen option is now disabled and would drop keyboard focus on the
    // page body, so move it to the one button that is live -- without
    // scrolling, so the explanations stay where the student is reading.
    try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); }
  }
}

function renderSA(card, item) {
  var area = make("textarea");
  area.setAttribute("aria-label", "Your answer");
  area.placeholder = "Write an answer, then compare it with the model answer.";
  card.appendChild(area);

  var foot = make("div", "foot");
  var showBtn = button("btn", "Show a model answer");
  foot.appendChild(showBtn);
  card.appendChild(foot);

  showBtn.addEventListener("click", function () {
    if (card.querySelector(".model")) { return; }
    answered++;
    PROGRESS.recordSeen(item.slug, item.id);

    var box = make("div", "model");
    box.appendChild(make("h3", null, "A model answer"));
    var p = make("p");
    p.innerHTML = item.answer;
    p.style.margin = "0";
    box.appendChild(p);

    if (item.rubric && item.rubric.length) {
      var h2 = make("h3", null, "Check your answer for these");
      h2.style.marginTop = "0.9rem";
      box.appendChild(h2);
      var ul = make("ul");
      item.rubric.forEach(function (point) {
        var li = make("li");
        li.innerHTML = point;
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    card.insertBefore(box, foot);

    // Short answer is self-scored, so it never touches the tally of correct
    // answers — only the count of questions worked.
    showBtn.remove();
    foot.appendChild(reference(item));
    foot.appendChild(nextButton(at + 1 >= queue.length ? "See results" : "Next question"));
    progress();
  });
}

/* ---- results ------------------------------------------------------ */

function doneBox(title) {
  var box = make("section", "card done");
  box.setAttribute("tabindex", "-1");
  var h = make("h3", null, title);
  h.style.margin = "0";
  h.style.fontSize = "1.05rem";
  box.appendChild(h);
  return box;
}

function missedList(box, label) {
  if (!missed.length) { return; }
  var h = make("h4", "done-sub", label || "Missed this time");
  box.appendChild(h);
  var ul = make("ul", "missed");
  missed.forEach(function (it) {
    var li = make("li");
    var t = rich("span", "missed-topic", it.poolTitle);
    li.appendChild(t);
    li.appendChild(document.createTextNode(": "));
    li.appendChild(rich("span", null, it.stem));
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

function finish(box) {
  el.stage.appendChild(box);
  refreshStatuses();
  refreshAvailable();
  box.focus();
}

function renderDone() {
  if (mode.kind === "check") { renderCheckDone(); return; }
  if (mode.kind === "quiz") { renderQuizDone(); return; }
  renderPracticeDone();
}

function renderPracticeDone() {
  var scored = right + missed.length;
  var box = doneBox("Set complete");
  box.appendChild(make("p", "score", scored ? right + " / " + scored : "—"));

  var reviewCount = Object.keys(reviewIds).length;
  var note = make("p", "sub", (scored
    ? "Multiple-choice questions answered correctly. Short-answer questions are self-scored."
    : "Short-answer questions are self-scored, so there is no score for this set.") +
    (reviewCount ? " " + plural(reviewCount, "question was", "questions were") +
                   " review from topics already worked." : ""));
  box.appendChild(note);

  missedList(box);

  var row = make("div", "row center");
  if (missed.length) {
    row.appendChild(button("btn", "Retry the " + missed.length + " missed", function () {
      begin(missed, { kind: "practice" });
    }));
  }
  row.appendChild(button("btn ghost", "Practice this selection again", startPractice));
  row.appendChild(button("btn ghost", "Back to topics", backToTopics));
  box.appendChild(row);
  finish(box);
}

function renderCheckDone() {
  var pool = bank.pools[mode.poolIndex];
  var total = queue.length;
  var level = settings().masteryLevel;
  PROGRESS.recordCheck(bank.slug, pool.key, right, total);

  // Judged from this check alone, so the verdict reads the same whether or
  // not storage took the record.
  var st = STUDY.topicStatus([{ date: new Date().toISOString(), correct: right, total: total }],
                             null, level, Date.now());
  var box = doneBox("Check complete");
  box.appendChild(rich("p", "tagline", pool.title));
  box.appendChild(make("p", "score", right + " / " + total));

  var verdict = make("p", "verdict");
  fillStatus(verdict, st);
  box.appendChild(verdict);

  var pct = STUDY.percent(right, total);
  box.appendChild(make("p", "sub", st.state === "mastered"
    ? pct + "% is at or above the " + level + "% level, so this topic counts as mastered. " +
      "It comes back for review in " + STUDY.LAPSE_DAYS + " days, and review questions from it " +
      "may turn up in practice sets."
    : pct + "% is below the " + level + "% level, so this topic is not yet mastered. " +
      "Practice the questions missed, then check again."));

  missedList(box);

  var row = make("div", "row center");
  if (missed.length) {
    row.appendChild(button("btn", "Practice these", function () {
      begin(missed, { kind: "practice" });
    }));
  }
  row.appendChild(button("btn ghost", "Check again", function () { startCheck(mode.poolIndex); }));
  row.appendChild(button("btn ghost", "Back to topics", backToTopics));
  box.appendChild(row);
  finish(box);
}

function renderQuizDone() {
  var box = doneBox("Quiz check complete · " + mode.label);
  box.appendChild(make("p", "score", right + " / " + queue.length));
  box.appendChild(make("p", "sub",
    "Core and standard questions across every topic in this lecture, which is what the in-class " +
    "quiz draws from. Topic statuses are unchanged; check a topic on its own to master it."));

  var per = {};
  queue.forEach(function (it) {
    var slot = per[it.poolIndex] || (per[it.poolIndex] = { right: 0, total: 0 });
    slot.total += 1;
  });
  queue.forEach(function (it) {
    if (missed.indexOf(it) === -1) { per[it.poolIndex].right += 1; }
  });
  var ul = make("ul", "per-topic");
  mode.indices.forEach(function (pi) {
    var slot = per[pi];
    if (!slot) { return; }
    var li = make("li");
    var ok = slot.right === slot.total;
    var sym = make("span", "sym", ok ? "✓" : "◔");
    sym.setAttribute("aria-hidden", "true");
    li.appendChild(sym);
    li.appendChild(rich("span", null, bank.pools[pi].title));
    li.appendChild(document.createTextNode(": " + slot.right + " of " + slot.total +
                                           (ok ? ", all right" : "")));
    ul.appendChild(li);
  });
  box.appendChild(ul);

  missedList(box);

  var row = make("div", "row center");
  if (missed.length) {
    row.appendChild(button("btn", "Practice these", function () {
      begin(missed, { kind: "practice" });
    }));
  }
  var again = mode;
  row.appendChild(button("btn ghost", "Try this lecture again", function () {
    startQuiz({ lecture: again.lecture, label: again.label, indices: again.indices });
  }));
  row.appendChild(button("btn ghost", "Back to topics", backToTopics));
  box.appendChild(row);
  finish(box);
}

function backToTopics() {
  endRun();
  el.stage.innerHTML = "";
  el.setup.scrollIntoView({ block: "start" });
  var first = el.topics.querySelector("button");
  if (first) { first.focus(); }
}

/* ---- settings ----------------------------------------------------- */

function buildSettings() {
  var s = settings();

  radioChips(el.setLevel, MASTERY_LEVELS.map(function (v) {
    return { value: v, label: v + "%" };
  }), s.masteryLevel, function (v) {
    PROGRESS.setSetting("masteryLevel", v);
    refreshStatuses();
  });

  radioChips(el.setShare, REVIEW_SHARES.map(function (v) {
    return { value: v, label: v + "%" };
  }), s.reviewShare, function (v) {
    PROGRESS.setSetting("reviewShare", v);
  });

  // Scope: one "all" chip, or any set of module chips. Pressing "all" clears
  // the list; pressing a module while "all" is on starts a list with it; an
  // emptied list falls back to "all".
  el.setScope.innerHTML = "";
  var allChip = chip("All modules I've practiced", !s.reviewScope, function (on, self) {
    if (!on) { self.setAttribute("aria-pressed", "true"); return; }
    PROGRESS.setSetting("reviewScope", null);
    buildSettings();
  });
  el.setScope.appendChild(allChip);
  index.modules.forEach(function (row) {
    if (!row.file) { return; }
    var pressed = !!s.reviewScope && s.reviewScope.indexOf(row.slug) !== -1;
    var c = chip("Module " + row.module, pressed, function (on) {
      var scope = (settings().reviewScope || []).slice();
      toggle(scope, row.slug, on);
      PROGRESS.setSetting("reviewScope", scope.length ? scope : null);
      buildSettings();
    });
    el.setScope.appendChild(c);
  });
}

/* The two "Settings" links do nothing while the panel is open, so they are
   hidden with it and come back when it closes -- before focus returns to the
   one that opened it, since a hidden button cannot take focus. */
function showSettingsLinks(on) {
  el.settingsOpen.hidden = !on;
  el.settingsOpen2.hidden = !on;
}

function openSettings(opener) {
  settingsOpener = opener || null;
  buildSettings();
  showSettingsLinks(false);
  el.viewSettings.hidden = false;
  el.viewSettings.scrollIntoView({ block: "start" });
  el.settingsTitle.focus();
}

function closeSettings() {
  if (el.viewSettings.hidden) { return; }
  el.viewSettings.hidden = true;
  showSettingsLinks(true);
  if (settingsOpener && document.body.contains(settingsOpener)) { settingsOpener.focus(); }
  settingsOpener = null;
}

/* ---- routing ------------------------------------------------------ */

/* A module is addressable, so a student can bookmark the one they are working
   on and the browser's back button behaves. */

function go(slug) {
  var want = slug ? "#/m/" + slug : "#/";
  if (location.hash === want) { route(); } else { location.hash = want; }
}

function route() {
  closeSettings();
  var m = /^#\/m\/([A-Za-z0-9_-]+)$/.exec(location.hash || "");
  if (m) {
    var row = null;
    index.modules.forEach(function (r) { if (r.slug === m[1]) { row = r; } });
    if (row && row.file) { openModule(row); return; }
  }
  entry = null;
  bank = null;
  endRun();
  renderGrid();
  show("modules");
}

/* ---- boot --------------------------------------------------------- */

el.back.addEventListener("click", function () { go(null); });
el.start.addEventListener("click", startPractice);

el.allOn.addEventListener("click", function () {
  selPools = bank.pools.map(function (_, i) { return i; });
  setPoolChips();
  refreshAvailable();
});
el.noneOn.addEventListener("click", function () {
  selPools = [];
  setPoolChips();
  refreshAvailable();
});

armable(el.modReset, "Reset this module", "Click again to reset every topic here", function () {
  PROGRESS.resetModule(bank.slug);
  refreshStatuses();
  refreshAvailable();
});

armable(el.wipe, "Clear saved progress", "Click again to clear everything", function () {
  PROGRESS.clearAll();
  index.modules.forEach(function (r) { delete r.itemIds; });
  renderGrid();
});

el.settingsOpen.addEventListener("click", function () { openSettings(el.settingsOpen); });
el.settingsOpen2.addEventListener("click", function () { openSettings(el.settingsOpen2); });
el.settingsClose.addEventListener("click", closeSettings);

window.addEventListener("hashchange", function () { if (index) { route(); } });

SOURCE.index().then(function (data) {
  index = data;
  el.boot.hidden = true;
  route();
}, function (err) {
  el.boot.textContent = "The question list could not be loaded. " + err.message;
});
