/* BCOG 100 practice site — the study logic.
   ---------------------------------------------------------------------------
   Pure functions, and nothing else: no fetch, no storage, no DOM. This file
   decides what a topic's status is, which items go into a mastery check, and
   which items come back for review. app.js calls it; source.js never does.

   It loads in two places. In the browser, index.html includes it before
   app.js and it defines a global `STUDY`. Under Node it is a CommonJS module,
   which is how test/study.test.js exercises it with no dependencies:

       node test/study.test.js

   Dates are accepted as anything `new Date()` understands -- an ISO string,
   a number of milliseconds, a Date -- so the storage layer can keep whatever
   shape it likes. */

(function (root, factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
  } else {
    root.STUDY = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY = 86400000;

  /* A mastered topic comes back for review this many days after the later of
     its last passing check and its last successful review answer. */
  var LAPSE_DAYS = 14;

  /* A mastery check is this many multiple-choice items, or every one the
     topic has when it has fewer. */
  var CHECK_SIZE = 10;

  function ms(d) {
    if (d === null || d === undefined || d === "") { return 0; }
    if (typeof d === "number") { return d; }
    var t = +new Date(d);
    return isNaN(t) ? 0 : t;
  }

  function shuffle(a, random) {
    random = random || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function percent(correct, total) {
    return total ? Math.round(correct * 100 / total) : 0;
  }

  /* Exactly the level passes. Compared in integers, because 7 / 10 * 100 is
     70.00000000000001 in floating point and 0.9 * 10 is not 9. */
  function passes(correct, total, level) {
    return total > 0 && correct * 100 >= level * total;
  }

  /* ---- topic status ------------------------------------------------- */

  /* topicStatus(checks, reviewOk, level, now[, lapsed])
       checks    [{date, correct, total}] -- every check the student has run
                 on this topic, in any order
       reviewOk  the date of the last review item from this topic answered
                 right, or null
       level     the student's mastery level, a percentage (70, 80, 90, 100)
       now       the current time
       lapsed    the date of the last review item from this topic answered
                 wrong, or null. A wrong review answer puts a mastered topic
                 straight into "review" without waiting out the 14 days.

     Returns {state, lastScore, lastDate}. The state is:
       "untried"     no check yet
       "practicing"  the latest check scored below the level
       "mastered"    the latest check passed, and fewer than LAPSE_DAYS have
                     run since the later of that check and reviewOk, and no
                     wrong review answer has come since
       "review"      the latest check passed but the time has run out, or a
                     review answer was wrong since
     The state is recomputed from the raw record every time it is asked for,
     which is what lets a change of level update every topic at once. */
  function topicStatus(checks, reviewOk, level, now, lapsed) {
    var list = (checks || []).slice().sort(function (a, b) {
      return ms(a.date) - ms(b.date);
    });
    if (!list.length) {
      return { state: "untried", lastScore: null, lastDate: null };
    }
    var latest = list[list.length - 1];
    var score = { correct: latest.correct, total: latest.total,
                  percent: percent(latest.correct, latest.total) };
    var out = { state: "practicing", lastScore: score, lastDate: latest.date };
    if (!passes(latest.correct, latest.total, level)) { return out; }

    var anchor = Math.max(ms(latest.date), ms(reviewOk));
    if (ms(lapsed) > anchor) { out.state = "review"; return out; }
    if (ms(now) - anchor >= LAPSE_DAYS * DAY) { out.state = "review"; return out; }
    out.state = "mastered";
    return out;
  }

  /* ---- sampling a mastery check ------------------------------------- */

  /* Items ranked for a check: never-answered items first, then by how long
     ago they were last answered, oldest first. Random within a tier. An item
     recorded before `seen` dates existed counts as answered long ago. */
  function rankForCheck(items, history, random) {
    var keyed = items.map(function (it) {
      var st = history ? history(it.id) : null;
      return { it: it, tier: st ? 1 : 0, seen: st ? ms(st.seen) : 0, r: random() };
    });
    keyed.sort(function (a, b) {
      return (a.tier - b.tier) || (a.seen - b.seen) || (a.r - b.r);
    });
    return keyed.map(function (k) { return k.it; });
  }

  /* An item with no claim ids is its own claim, so two such items never
     block each other and one never blocks a claim-bearing item. */
  function claimsOf(it) {
    return (it.claims && it.claims.length) ? it.claims : ["item:" + it.id];
  }

  /* sampleCheck(items, history, opts)
       items    a topic's items; short-answer items are ignored
       history  function(id) -> the item's saved state or null
       opts.n   the check size (default CHECK_SIZE)
       opts.random  a random() for tests

     Picks up to n multiple-choice items: one per claim where the topic has
     that many claims, at least one application item where it has one, unseen
     items first and then the least recently seen. When the topic has n items
     or fewer the check is simply all of them. When it has more items than
     distinct claims, the shortfall is filled from the best-ranked remainder.
     The result is shuffled. */
  function sampleCheck(items, history, opts) {
    opts = opts || {};
    var n = opts.n || CHECK_SIZE;
    var random = opts.random || Math.random;
    var mc = (items || []).filter(function (it) { return it.type === "mc"; });
    if (mc.length <= n) { return shuffle(mc.slice(), random); }

    var ranked = rankForCheck(mc, history, random);
    var used = {};
    var out = [];
    function free(it) {
      return claimsOf(it).every(function (c) { return !used[c]; });
    }
    function take(it) {
      out.push(it);
      claimsOf(it).forEach(function (c) { used[c] = true; });
    }

    var application = ranked.filter(function (it) {
      return it.kind === "application";
    })[0];
    if (application) { take(application); }

    ranked.forEach(function (it) {
      if (out.length < n && out.indexOf(it) === -1 && free(it)) { take(it); }
    });
    ranked.forEach(function (it) {
      if (out.length < n && out.indexOf(it) === -1) { out.push(it); }
    });
    return shuffle(out, random);
  }

  /* ---- sampling cumulative review ----------------------------------- */

  /* sampleReview(candidates, history, n[, random])
       candidates  [{item, slug, topicKey, review, topicLast}]
                   item       the item itself
                   slug       its module
                   review     true when its topic's status is "review"
                   topicLast  when the topic was last practiced (any date form)
       history     function(slug, id) -> the item's saved state or null
       n           how many to return

     Order: items from topics due for review; then items whose last answer
     was wrong; then everything else, from the topics practiced longest ago.
     Within a topic, items the student has not seen come first. Ties are
     random. Returns the first n candidates in that order. */
  function sampleReview(candidates, history, n, random) {
    random = random || Math.random;
    var keyed = (candidates || []).map(function (c) {
      var st = history ? history(c.slug, c.item.id) : null;
      var tier = c.review ? 0 : (st && st.last === 0 ? 1 : 2);
      return { c: c, tier: tier, topicLast: ms(c.topicLast),
               seen: st ? 1 : 0, r: random() };
    });
    keyed.sort(function (a, b) {
      return (a.tier - b.tier) || (a.topicLast - b.topicLast) ||
             (a.seen - b.seen) || (a.r - b.r);
    });
    return keyed.slice(0, Math.max(0, n)).map(function (k) { return k.c; });
  }

  /* ---- keys and grouping -------------------------------------------- */

  /* The key a topic's progress is stored under. A pool's index is not stable
     -- a lab pool is being appended to every module, and pools may be
     reordered -- so the key is a slug of the pool's title instead, which
     survives both. The one lab pool a module has is keyed "lab" whatever it
     is called, so renaming it to name the lab keeps its history. Titles
     arrive HTML-escaped from the exporter, so tags and entities are removed
     before slugging. */
  function topicKey(title, isLab) {
    if (isLab) { return "lab"; }
    var text = String(title || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
      .toLowerCase();
    var slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "untitled";
  }

  /* groupPools(pools) -> [{label, lab, indices}]
     Topics are grouped under their lecture, from each pool's `lectures`
     (the first lecture named is the one it is filed under). The lab pool is
     its own group, labeled "Lab", after the lectures. Pools naming no lecture
     go in "Other", at the end. */
  function groupPools(pools) {
    var lectures = {};
    var order = [];
    var lab = [];
    var other = [];
    (pools || []).forEach(function (pool, i) {
      if (pool.lab) { lab.push(i); return; }
      var lec = pool.lectures && pool.lectures.length ? String(pool.lectures[0]) : "";
      if (!lec) { other.push(i); return; }
      if (!lectures[lec]) { lectures[lec] = []; order.push(lec); }
      lectures[lec].push(i);
    });
    order.sort(function (a, b) {
      var pa = a.split(".").map(Number), pb = b.split(".").map(Number);
      for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var d = (pa[i] || 0) - (pb[i] || 0);
        if (d) { return d; }
      }
      return 0;
    });
    var out = order.map(function (lec) {
      return { label: "Lecture " + lec, lecture: lec, lab: false, indices: lectures[lec] };
    });
    if (lab.length) { out.push({ label: "Lab", lecture: null, lab: true, indices: lab }); }
    if (other.length) { out.push({ label: "Other", lecture: null, lab: false, indices: other }); }
    return out;
  }

  return {
    DAY: DAY,
    LAPSE_DAYS: LAPSE_DAYS,
    CHECK_SIZE: CHECK_SIZE,
    ms: ms,
    shuffle: shuffle,
    percent: percent,
    passes: passes,
    topicStatus: topicStatus,
    sampleCheck: sampleCheck,
    sampleReview: sampleReview,
    topicKey: topicKey,
    groupPools: groupPools
  };
}));
