/* Tests for study.js. Node only, no dependencies:

       node test/study.test.js

   Exits 1 on the first failure. */

"use strict";

var assert = require("assert");
var STUDY = require("../study.js");

var DAY = STUDY.DAY;
var NOW = Date.parse("2026-10-11T12:00:00Z");
var passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log("ok  " + name);
}

/* A deterministic random() so sampling tests are repeatable. */
function seeded(seed) {
  var s = seed || 1;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function check(daysAgo, correct, total) {
  return { date: new Date(NOW - daysAgo * DAY).toISOString(), correct: correct, total: total };
}

function status(checks, reviewOk, level, lapsed) {
  return STUDY.topicStatus(checks, reviewOk, level, NOW, lapsed);
}

/* ---- topicStatus -------------------------------------------------- */

test("no checks is untried", function () {
  var s = status([], null, 90);
  assert.strictEqual(s.state, "untried");
  assert.strictEqual(s.lastScore, null);
});

test("a check below the level is practicing, with the score kept", function () {
  var s = status([check(1, 7, 10)], null, 90);
  assert.strictEqual(s.state, "practicing");
  assert.deepStrictEqual(s.lastScore, { correct: 7, total: 10, percent: 70 });
});

test("exactly the level passes", function () {
  assert.strictEqual(status([check(1, 9, 10)], null, 90).state, "mastered");
  assert.strictEqual(status([check(1, 7, 10)], null, 70).state, "mastered");
  assert.strictEqual(status([check(1, 8, 10)], null, 80).state, "mastered");
  assert.strictEqual(status([check(1, 10, 10)], null, 100).state, "mastered");
});

test("one short of the level does not pass", function () {
  assert.strictEqual(status([check(1, 8, 10)], null, 90).state, "practicing");
  assert.strictEqual(status([check(1, 9, 10)], null, 100).state, "practicing");
});

test("a small topic passes on its own total", function () {
  assert.strictEqual(status([check(1, 6, 6)], null, 90).state, "mastered");
  assert.strictEqual(status([check(1, 5, 6)], null, 90).state, "practicing");   // 83%
  assert.strictEqual(status([check(1, 5, 6)], null, 80).state, "mastered");
});

test("changing the level changes the status without a new check", function () {
  var checks = [check(1, 8, 10)];
  assert.strictEqual(status(checks, null, 90).state, "practicing");
  assert.strictEqual(status(checks, null, 80).state, "mastered");
  assert.strictEqual(status(checks, null, 70).state, "mastered");
  assert.strictEqual(status(checks, null, 100).state, "practicing");
});

test("the latest check decides, whatever order the checks are stored in", function () {
  var checks = [check(1, 5, 10), check(3, 10, 10)];      // newest first in the array
  assert.strictEqual(status(checks, null, 90).state, "practicing");
  checks = [check(3, 5, 10), check(1, 10, 10)];
  assert.strictEqual(status(checks, null, 90).state, "mastered");
});

test("a passing check lapses to review after 14 days", function () {
  assert.strictEqual(status([check(13.9, 10, 10)], null, 90).state, "mastered");
  assert.strictEqual(status([check(14, 10, 10)], null, 90).state, "review");
  assert.strictEqual(status([check(40, 10, 10)], null, 90).state, "review");
});

test("a review item answered right restarts the 14 days", function () {
  var checks = [check(20, 10, 10)];
  var reviewOk = new Date(NOW - 3 * DAY).toISOString();
  var s = status(checks, reviewOk, 90);
  assert.strictEqual(s.state, "mastered");
  assert.strictEqual(s.lastScore.percent, 100);
  reviewOk = new Date(NOW - 14 * DAY).toISOString();
  assert.strictEqual(status(checks, reviewOk, 90).state, "review");
});

test("a review item answered wrong lapses a mastered topic at once", function () {
  var checks = [check(2, 10, 10)];
  var lapsed = new Date(NOW - 1 * DAY).toISOString();
  assert.strictEqual(status(checks, null, 90, lapsed).state, "review");
  // ...but a later right review answer, or a later passing check, clears it.
  var reviewOk = new Date(NOW - 0.5 * DAY).toISOString();
  assert.strictEqual(status(checks, reviewOk, 90, lapsed).state, "mastered");
  var again = [check(2, 10, 10), check(0.5, 9, 10)];
  assert.strictEqual(status(again, null, 90, lapsed).state, "mastered");
});

test("a lapse never turns a failing topic into review", function () {
  var lapsed = new Date(NOW - 1 * DAY).toISOString();
  assert.strictEqual(status([check(2, 5, 10)], null, 90, lapsed).state, "practicing");
});

test("review keeps the last score", function () {
  var s = status([check(30, 9, 10)], null, 90);
  assert.strictEqual(s.state, "review");
  assert.strictEqual(s.lastScore.percent, 90);
});

/* ---- sampleCheck -------------------------------------------------- */

function item(id, claims, kind, type) {
  return { id: id, type: type || "mc", kind: kind || "definition-term", claims: claims || [] };
}

function historyOf(map) {
  return function (id) { return map[id] || null; };
}

test("a topic with ten items or fewer is checked whole", function () {
  var items = [];
  for (var i = 0; i < 7; i++) { items.push(item("a" + i, ["c" + i])); }
  var out = STUDY.sampleCheck(items, historyOf({}), { random: seeded(3) });
  assert.strictEqual(out.length, 7);
  assert.deepStrictEqual(out.map(function (it) { return it.id; }).sort(),
                         items.map(function (it) { return it.id; }).sort());
});

test("short-answer items are never in a check", function () {
  var items = [item("sa1", ["c1"], "application", "sa"), item("m1", ["c1"]), item("m2", ["c2"])];
  var out = STUDY.sampleCheck(items, historyOf({}), { random: seeded(3) });
  assert.strictEqual(out.length, 2);
  assert.ok(out.every(function (it) { return it.type === "mc"; }));
});

test("one item per claim when the topic has enough claims", function () {
  var items = [];
  for (var c = 0; c < 12; c++) {
    items.push(item("x" + c + "a", ["c" + c]));
    items.push(item("x" + c + "b", ["c" + c]));
  }
  var out = STUDY.sampleCheck(items, historyOf({}), { random: seeded(7) });
  assert.strictEqual(out.length, 10);
  var claims = out.map(function (it) { return it.claims[0]; });
  assert.strictEqual(new Set(claims).size, 10, "every claim appears once");
});

test("multi-claim items block every claim they cite", function () {
  var items = [item("both", ["c1", "c2"], "application")];
  for (var i = 0; i < 20; i++) { items.push(item("i" + i, [i % 2 ? "c1" : "c2"])); }
  for (var j = 0; j < 9; j++) { items.push(item("j" + j, ["d" + j])); }
  var out = STUDY.sampleCheck(items, historyOf({}), { random: seeded(5) });
  assert.strictEqual(out.length, 10);
  assert.ok(out.some(function (it) { return it.id === "both"; }), "the application item is in");
  assert.ok(!out.some(function (it) { return /^i/.test(it.id); }),
            "nothing else on c1 or c2 is taken while other claims remain");
});

test("too few distinct claims: the check fills from the remainder", function () {
  var items = [];
  for (var i = 0; i < 15; i++) { items.push(item("k" + i, ["c" + (i % 4)])); }
  var out = STUDY.sampleCheck(items, historyOf({}), { random: seeded(11) });
  assert.strictEqual(out.length, 10);
  assert.strictEqual(new Set(out.map(function (it) { return it.id; })).size, 10, "no item twice");
});

test("claimless items each count as their own claim", function () {
  var items = [];
  for (var i = 0; i < 14; i++) { items.push(item("n" + i, [])); }
  var out = STUDY.sampleCheck(items, historyOf({}), { random: seeded(2) });
  assert.strictEqual(out.length, 10);
  assert.strictEqual(new Set(out.map(function (it) { return it.id; })).size, 10);
});

test("an application item is always included where the topic has one", function () {
  var items = [item("app", ["c0"], "application")];
  for (var i = 1; i < 30; i++) { items.push(item("d" + i, ["c" + i])); }
  // Even when the application item has been seen and everything else is unseen.
  var hist = historyOf({ app: { n: 1, right: 1, last: 1, seen: NOW - DAY } });
  for (var trial = 0; trial < 5; trial++) {
    var out = STUDY.sampleCheck(items, hist, { random: seeded(trial + 1) });
    assert.ok(out.some(function (it) { return it.id === "app"; }));
  }
});

test("unseen items come before seen ones, and seen ones oldest first", function () {
  var items = [];
  var hist = {};
  for (var i = 0; i < 20; i++) {
    items.push(item("s" + i, ["c" + i]));
    if (i < 15) { hist["s" + i] = { n: 1, right: 1, last: 1, seen: NOW - i * DAY }; }
  }
  var out = STUDY.sampleCheck(items, historyOf(hist), { random: seeded(9) });
  var ids = out.map(function (it) { return it.id; });
  // The five unseen items (s15..s19) are all in.
  for (var u = 15; u < 20; u++) { assert.ok(ids.indexOf("s" + u) !== -1, "s" + u + " unseen, taken"); }
  // The remaining five are the five seen longest ago (s10..s14).
  for (var o = 10; o < 15; o++) { assert.ok(ids.indexOf("s" + o) !== -1, "s" + o + " oldest, taken"); }
  for (var r = 0; r < 10; r++) { assert.ok(ids.indexOf("s" + r) === -1, "s" + r + " recent, left out"); }
});

test("an item recorded before seen dates existed counts as seen long ago", function () {
  var items = [];
  var hist = {};
  for (var i = 0; i < 12; i++) {
    items.push(item("p" + i, ["c" + i]));
    hist["p" + i] = { n: 1, right: 1, last: 1, seen: NOW - DAY };
  }
  hist.p0 = { n: 1, right: 1, last: 1 };        // migrated: no seen
  hist.p1 = { n: 1, right: 1, last: 1 };
  var out = STUDY.sampleCheck(items, historyOf(hist), { random: seeded(4), n: 2 });
  assert.deepStrictEqual(out.map(function (it) { return it.id; }).sort(), ["p0", "p1"]);
});

test("the check size can be set", function () {
  var items = [];
  for (var i = 0; i < 30; i++) { items.push(item("z" + i, ["c" + i])); }
  assert.strictEqual(STUDY.sampleCheck(items, historyOf({}), { n: 5, random: seeded(1) }).length, 5);
});

/* ---- sampleReview ------------------------------------------------- */

function cand(id, slug, topicKey, review, topicLastDaysAgo) {
  return { item: item(id, []), slug: slug, topicKey: topicKey, review: !!review,
           topicLast: NOW - topicLastDaysAgo * DAY };
}

test("review-due topics come first, then wrong answers, then oldest topics", function () {
  var hist = {
    "m1/w": { n: 2, right: 1, last: 0, seen: NOW - DAY },
    "m2/old": { n: 1, right: 1, last: 1, seen: NOW - 30 * DAY },
    "m3/rev": { n: 1, right: 1, last: 1, seen: NOW - 2 * DAY },
    "m2/recent": { n: 1, right: 1, last: 1, seen: NOW - DAY }
  };
  var history = function (slug, id) { return hist[slug + "/" + id] || null; };
  var cands = [
    cand("recent", "m2", "t-recent", false, 1),
    cand("old", "m2", "t-old", false, 30),
    cand("w", "m1", "t-wrong", false, 1),
    cand("rev", "m3", "t-review", true, 2)
  ];
  var out = STUDY.sampleReview(cands, history, 4, seeded(6)).map(function (c) { return c.item.id; });
  assert.deepStrictEqual(out, ["rev", "w", "old", "recent"]);
});

test("within a topic, unseen items come first", function () {
  var hist = { "m/seen": { n: 1, right: 1, last: 1, seen: NOW - DAY } };
  var history = function (slug, id) { return hist[slug + "/" + id] || null; };
  var cands = [cand("seen", "m", "t", false, 1), cand("new", "m", "t", false, 1)];
  var out = STUDY.sampleReview(cands, history, 2, seeded(8)).map(function (c) { return c.item.id; });
  assert.deepStrictEqual(out, ["new", "seen"]);
});

test("asking for more than there are returns what there is; zero returns none", function () {
  var history = function () { return null; };
  var cands = [cand("a", "m", "t", false, 1), cand("b", "m", "t", false, 1)];
  assert.strictEqual(STUDY.sampleReview(cands, history, 5, seeded(1)).length, 2);
  assert.strictEqual(STUDY.sampleReview(cands, history, 0, seeded(1)).length, 0);
  assert.strictEqual(STUDY.sampleReview([], history, 3, seeded(1)).length, 0);
});

/* ---- topicKey and groupPools -------------------------------------- */

test("topic keys are slugs of the title, with markup and entities removed", function () {
  assert.strictEqual(STUDY.topicKey("Marr&#39;s Three Levels: Defined &amp; Applied"),
                     "marr-s-three-levels-defined-applied");
  assert.strictEqual(STUDY.topicKey("What We Mean by <em>Mind</em>"), "what-we-mean-by-mind");
  assert.strictEqual(STUDY.topicKey("  "), "untitled");
});

test("the lab pool is keyed 'lab' whatever it is called", function () {
  assert.strictEqual(STUDY.topicKey("The Vehicles Lab", true), "lab");
  assert.strictEqual(STUDY.topicKey("Lab", true), "lab");
  assert.notStrictEqual(STUDY.topicKey("The Vehicles Lab", false), "lab");
});

test("pools group under their lecture, with the lab and then other at the end", function () {
  var pools = [
    { title: "A", lectures: ["7.1"], lab: false },
    { title: "B", lectures: ["7.2"], lab: false },
    { title: "C", lectures: [], lab: false },
    { title: "D", lectures: ["7.1", "7.2"], lab: false },
    { title: "Lab", lectures: [], lab: true },
    { title: "E", lectures: ["7.10"], lab: false }
  ];
  var groups = STUDY.groupPools(pools);
  assert.deepStrictEqual(groups.map(function (g) { return g.label; }),
                         ["Lecture 7.1", "Lecture 7.2", "Lecture 7.10", "Lab", "Other"]);
  assert.deepStrictEqual(groups[0].indices, [0, 3]);
  assert.deepStrictEqual(groups[3].indices, [4]);
  assert.strictEqual(groups[3].lab, true);
  assert.deepStrictEqual(groups[4].indices, [2]);
});

test("a module with no lab and every pool in a lecture has only lecture groups", function () {
  var pools = [{ lectures: ["0"], lab: false }, { lectures: ["0"], lab: false }];
  var groups = STUDY.groupPools(pools);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].label, "Lecture 0");
});

console.log("\n" + passed + " tests passed");
