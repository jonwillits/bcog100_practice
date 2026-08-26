/* BCOG 100 practice site — the interface.
   ---------------------------------------------------------------------------
   Reads questions and progress through SOURCE and PROGRESS, defined in
   source.js, and touches neither the network nor storage itself. Keeping that
   line clean is what makes moving the questions behind an API a one-file
   change. */

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
  { id: "unseen", label: "Not yet tried" },
  { id: "missed", label: "Missed last time" }
];

var el = {};
["view-modules", "view-module", "module-grid", "wipe", "back", "mod-title",
 "mod-sub", "setup", "pools", "kinds", "levels", "focus", "start", "all-on",
 "avail", "runbar", "runtrack", "count", "tally", "fill", "stage", "boot"
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

var queue = [], at = 0, right = 0, answered = 0, missed = [];

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

function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
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

  // The item count comes from the index, so a card can report progress on a
  // module the student has not opened in this visit.
  var stats = PROGRESS.moduleStats(row.slug, row.itemIds);
  var total = row.items;
  var meta = make("span", "m");

  if (stats.seen === 0) {
    meta.textContent = plural(total, "question", "questions") +
                       " · " + plural(row.pools, "topic", "topics");
  } else {
    meta.textContent = Math.min(stats.seen, total) + " of " + total + " tried" +
                       (stats.missed ? " · " + stats.missed + " to revisit" : "");
    var mini = make("div", "mini");
    var fill = make("i");
    fill.style.width = Math.min(stats.seen / Math.max(total, 1), 1) * 100 + "%";
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
  el.stage.innerHTML = "";
  endRun();
  show("module");
  el.viewModule.scrollIntoView({ block: "start" });

  SOURCE.module(row).then(function (data) {
    bank = data;
    items = [];
    data.pools.forEach(function (pool, pi) {
      pool.items.forEach(function (item) {
        item.poolIndex = pi;
        item.poolTitle = pool.title;
        items.push(item);
      });
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

    el.modSub.textContent =
      plural(items.length, "question", "questions") + " across " +
      plural(data.pools.length, "topic", "topics") +
      ". Nothing here is graded or recorded anywhere but this browser.";
    buildControls();
    el.setup.hidden = false;
    refreshAvailable();
  }, function (err) {
    el.modSub.textContent = "";
    el.stage.innerHTML = "";
    el.stage.appendChild(make("p", "empty",
      "These questions could not be loaded. " + err.message));
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

function buildControls() {
  el.pools.innerHTML = "";
  el.kinds.innerHTML = "";
  el.levels.innerHTML = "";
  el.focus.innerHTML = "";

  bank.pools.forEach(function (pool, i) {
    var c = chip("", true, function (on) { toggle(selPools, i, on); });
    c.innerHTML = pool.title;
    el.pools.appendChild(c);
  });
  kinds.forEach(function (k) {
    el.kinds.appendChild(chip(KIND_LABEL[k] || k, true, function (on) {
      toggle(selKinds, k, on);
    }));
  });
  levels.forEach(function (lv) {
    el.levels.appendChild(chip(LEVEL_LABEL[lv] || lv, true, function (on) {
      toggle(selLevels, lv, on);
    }));
  });

  // Focus is one choice, not a set: pressing one releases the others, and
  // pressing the pressed one is a no-op rather than leaving none selected.
  FOCUS.forEach(function (f) {
    var b = chip(f.label, f.id === selFocus, function (on, self) {
      if (!on) { self.setAttribute("aria-pressed", "true"); return; }
      selFocus = f.id;
      Array.prototype.forEach.call(el.focus.children, function (other) {
        if (other !== self) { other.setAttribute("aria-pressed", "false"); }
      });
    });
    el.focus.appendChild(b);
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
    if (selFocus === "unseen") { return !state; }
    return !!state && state.last === 0;    // "missed"
  });
}

function refreshAvailable() {
  var n = pick().length;
  el.avail.textContent = n
    ? plural(n, "question selected", "questions selected")
    : "No questions match these filters";
  el.start.disabled = n === 0;
}

/* ---- a run -------------------------------------------------------- */

function begin(list) {
  queue = shuffle(list.slice());
  at = 0; right = 0; answered = 0; missed = [];
  el.runbar.hidden = false;
  el.runtrack.hidden = false;
  render();
  // The filter panel stays open above the question, so on a phone the first
  // question would otherwise start below the fold.
  el.runbar.scrollIntoView({ block: "start" });
}

function endRun() {
  queue = []; at = 0; right = 0; answered = 0; missed = [];
  el.runbar.hidden = true;
  el.runtrack.hidden = true;
}

function progress() {
  el.count.textContent = queue.length
    ? "Question " + Math.min(at + 1, queue.length) + " of " + queue.length
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
  var p = rich("p", "tagline", item.poolTitle);
  p.appendChild(document.createTextNode(rest));
  return p;
}

function nextButton(label) {
  var b = make("button", "btn", label);
  b.type = "button";
  b.addEventListener("click", function () { at++; render(); });
  return b;
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
      PROGRESS.record(bank.slug, item.id, !!opt.correct);
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
    foot.appendChild(make("span", "src", "From: " + item.source.join("; ")));
    foot.appendChild(nextButton(at + 1 >= queue.length ? "See results" : "Next question"));
    card.appendChild(foot);

    var announce = make("p", "sr", chosen.correct ? "Correct." : "Not correct.");
    announce.setAttribute("role", "status");
    card.appendChild(announce);
  }
}

function renderSA(card, item) {
  var area = make("textarea");
  area.setAttribute("aria-label", "Your answer");
  area.placeholder = "Write an answer, then compare it with the model answer.";
  card.appendChild(area);

  var foot = make("div", "foot");
  var showBtn = make("button", "btn", "Show a model answer");
  showBtn.type = "button";
  foot.appendChild(showBtn);
  foot.appendChild(make("span", "src", "From: " + item.source.join("; ")));
  card.appendChild(foot);

  showBtn.addEventListener("click", function () {
    if (card.querySelector(".model")) { return; }
    answered++;
    PROGRESS.recordSeen(bank.slug, item.id);

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
    foot.insertBefore(
      nextButton(at + 1 >= queue.length ? "See results" : "Next question"),
      foot.firstChild);
    progress();
  });
}

function renderDone() {
  var scored = right + missed.length;
  var box = make("section", "card done");

  var h = make("h3", null, "Set complete");
  h.style.margin = "0";
  h.style.fontSize = "1.05rem";
  box.appendChild(h);

  box.appendChild(make("p", "score", scored ? right + " / " + scored : "—"));

  var note = make("p", "sub", scored
    ? "Multiple-choice questions answered correctly. Short-answer questions are self-scored."
    : "Short-answer questions are self-scored, so there is no score for this set.");
  note.style.marginBottom = "1.2rem";
  box.appendChild(note);

  var row = make("div", "row");
  row.style.justifyContent = "center";

  if (missed.length) {
    var again = make("button", "btn", "Retry the " + missed.length + " missed");
    again.type = "button";
    again.addEventListener("click", function () { begin(missed); });
    row.appendChild(again);
  }

  var same = make("button", "btn ghost", "Practice this selection again");
  same.type = "button";
  same.addEventListener("click", function () { begin(pick()); });
  row.appendChild(same);

  var back = make("button", "btn ghost", "Choose another module");
  back.type = "button";
  back.addEventListener("click", function () { go(null); });
  row.appendChild(back);

  box.appendChild(row);
  el.stage.appendChild(box);
  refreshAvailable();
}

/* ---- routing ------------------------------------------------------ */

/* A module is addressable, so a student can bookmark the one they are working
   on and the browser's back button behaves. */

function go(slug) {
  var want = slug ? "#/m/" + slug : "#/";
  if (location.hash === want) { route(); } else { location.hash = want; }
}

function route() {
  var m = /^#\/m\/([A-Za-z0-9_-]+)$/.exec(location.hash || "");
  if (m) {
    var row = null;
    index.modules.forEach(function (r) { if (r.slug === m[1]) { row = r; } });
    if (row && row.file) { openModule(row); return; }
  }
  entry = null;
  endRun();
  renderGrid();
  show("modules");
}

/* ---- boot --------------------------------------------------------- */

el.back.addEventListener("click", function () { go(null); });
el.start.addEventListener("click", function () { begin(pick()); });

el.allOn.addEventListener("click", function () {
  selPools = bank.pools.map(function (_, i) { return i; });
  selKinds = kinds.slice();
  selLevels = levels.slice();
  selFocus = "all";
  buildControls();
  refreshAvailable();
});

/* Clearing progress is irreversible, so it takes two clicks rather than a
   modal dialog: the first arms the button, the second does it. */
var wipeArmed = false;
el.wipe.addEventListener("click", function () {
  if (!wipeArmed) {
    wipeArmed = true;
    el.wipe.textContent = "Click again to clear everything";
    setTimeout(function () {
      wipeArmed = false;
      el.wipe.textContent = "Clear saved progress";
    }, 5000);
    return;
  }
  wipeArmed = false;
  el.wipe.textContent = "Clear saved progress";
  PROGRESS.clearAll();
  index.modules.forEach(function (r) { delete r.itemIds; });
  renderGrid();
});

window.addEventListener("hashchange", function () { if (index) { route(); } });

SOURCE.index().then(function (data) {
  index = data;
  el.boot.hidden = true;
  route();
}, function (err) {
  el.boot.textContent = "The question list could not be loaded. " + err.message;
});
