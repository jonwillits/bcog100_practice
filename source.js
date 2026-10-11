/* BCOG 100 practice site — the data layer, and the only file that knows where
   questions and progress come from.
   ---------------------------------------------------------------------------

   app.js talks to two objects and never to the network or to storage:

     QuestionSource          ProgressStore
       .index()                items    .itemState(slug, id)
       .module(entry)                   .itemsOf(slug)
                                        .record(slug, id, correct)
                                        .recordSeen(slug, id)
                                        .moduleStats(slug, ids)
                                        .modulesWithProgress()
                               topics   .topic(slug, key)
                                        .topics(slug)
                                        .recordCheck(slug, key, correct, total)
                                        .recordReviewOk(slug, key)
                                        .recordLapse(slug, key)
                               settings .settings()
                                        .setSetting(name, value)
                               reset    .resetTopic(slug, key, ids)
                                        .resetModule(slug)
                                        .clearAll()

   Today those are StaticSource (fetches JSON files built by
   course_creation/tools/quiz_bank/build_site.py) and LocalProgress (this
   browser's localStorage). That combination ships the whole bank to anyone who
   opens the page, and keeps a student's progress on one device.

   Neither limitation is meant to last. The replacements are sketched at the
   foot of this file: an ApiSource that fetches a session's worth of items from
   a server -- so the bank is never handed over whole -- and an ApiProgress that
   records answers against a student identity, so progress follows them between
   devices and the instructor can see which claims a cohort is missing.

   Swapping them is the last two lines of this file. Nothing in app.js changes.
   Keep it that way: no fetch() and no localStorage anywhere but here. */

"use strict";

/* ------------------------------------------------------------------ */
/* Questions                                                          */
/* ------------------------------------------------------------------ */

function StaticSource(base) {
  this.base = base || "data/";
  this._index = null;
  this._modules = {};
}

StaticSource.prototype._get = function (name) {
  return fetch(this.base + name, { cache: "no-cache" }).then(function (r) {
    if (!r.ok) { throw new Error(name + ": HTTP " + r.status); }
    return r.json();
  });
};

StaticSource.prototype.index = function () {
  var self = this;
  if (this._index) { return Promise.resolve(this._index); }
  return this._get("index.json").then(function (data) {
    self._index = data;
    return data;
  });
};

/* Resolves to a module's full bank: {schema, module, slug, title, pools:[...]}.
   Cached, because a student moving between modules should not re-download one
   they have already opened -- and because cumulative review reads other
   modules' items through this same call. */
StaticSource.prototype.module = function (entry) {
  var self = this;
  if (!entry || !entry.file) {
    return Promise.reject(new Error("module " + (entry && entry.module) +
                                    " has no questions yet"));
  }
  if (this._modules[entry.file]) {
    return Promise.resolve(this._modules[entry.file]);
  }
  return this._get(entry.file).then(function (data) {
    self._modules[entry.file] = data;
    return data;
  });
};

/* ------------------------------------------------------------------ */
/* Progress                                                           */
/* ------------------------------------------------------------------ */

/* What is stored, under one localStorage key (version 2, 2026-10-11):

     {
       v: 2,
       items: {                      per item, per module
         <slug>: { <item id>: { n, right, last, seen } }
       },
       topics: {                     per topic, per module
         <slug>: { <topic key>: { checks: [{date, correct, total}],
                                  reviewOk: <date>|null,
                                  lapsed:   <date>|null } }
       },
       settings: { masteryLevel: 90, reviewShare: 20, reviewScope: null }
     }

   Per item: how many times it has been answered, how many of those were
   right, whether the most recent attempt was right (`last`, which drives the
   "missed last time" filter; null for self-scored short answer), and `seen`,
   when it was last answered, which is what lets a mastery check prefer items
   the student has not met and then the ones met longest ago.

   Per topic: every mastery check's score, in order; `reviewOk`, the last time
   a review item from this topic was answered right, which restarts its 14-day
   clock; and `lapsed`, the last time one was answered wrong, which sends a
   mastered topic straight back to review. The topic's status is never stored
   -- study.js computes it from these against the current mastery level, so a
   change of level updates every topic at once.

   The topic key is a slug of the pool's title (`STUDY.topicKey`), not the
   pool's index: a lab pool is being appended to every module and pools may be
   reordered, and either would silently re-attach a topic's history to the
   wrong pool. The one lab pool a module has is keyed "lab" whatever it is
   titled, so renaming it keeps its history.

   Settings: the mastery level (70, 80, 90 or 100), the share of each practice
   set drawn from review (0 to 50, in tens), and the review scope -- null for
   every module the student has practiced, or a list of module slugs.

   Version 1 (2026-08-26) was the `items` map alone, keyed by slug at the top
   level, and is migrated on first read.

   Dates are ISO 8601 strings, so a student (or we) can read the stored object.

   Storage is a convenience and never load-bearing. A private window, cleared
   site data, or an embedding context that blocks storage all make these
   throw, and the page must work identically when they do -- it simply
   remembers nothing. Every access is wrapped. */

var PROGRESS_VERSION = 2;

var DEFAULT_SETTINGS = { masteryLevel: 90, reviewShare: 20, reviewScope: null };

function LocalProgress(key) {
  this.key = key || "bcog100-practice";
}

LocalProgress.prototype._empty = function () {
  return { v: PROGRESS_VERSION, items: {}, topics: {}, settings: {} };
};

/* The version-1 object had no `v` and held item maps keyed by slug at its
   top level. Anything without `v` is read as that shape. */
LocalProgress.prototype._migrate = function (raw) {
  if (!raw || typeof raw !== "object") { return this._empty(); }
  if (raw.v === PROGRESS_VERSION) {
    raw.items = raw.items || {};
    raw.topics = raw.topics || {};
    raw.settings = raw.settings || {};
    return raw;
  }
  var state = this._empty();
  if (raw.v === undefined) {
    Object.keys(raw).forEach(function (slug) {
      if (raw[slug] && typeof raw[slug] === "object") { state.items[slug] = raw[slug]; }
    });
    this._write(state);
  }
  return state;
};

LocalProgress.prototype._read = function () {
  try { return this._migrate(JSON.parse(localStorage.getItem(this.key))); }
  catch (e) { return this._empty(); }
};

LocalProgress.prototype._write = function (state) {
  try { localStorage.setItem(this.key, JSON.stringify(state)); }
  catch (e) { /* nothing to do, and nothing worth telling the student */ }
};

function _now() { return new Date().toISOString(); }

/* ---- items ------------------------------------------------------- */

LocalProgress.prototype.itemState = function (slug, id) {
  var items = this._read().items;
  return (items[slug] && items[slug][id]) || null;
};

/* Every stored item record for a module, keyed by id, in one read. Sampling
   a check or gathering review candidates asks about hundreds of items at once,
   and one parse of the stored object beats one per item. */
LocalProgress.prototype.itemsOf = function (slug) {
  var mod = this._read().items[slug] || {};
  var out = {};
  Object.keys(mod).forEach(function (id) { out[id] = mod[id]; });
  return out;
};

LocalProgress.prototype.record = function (slug, id, correct) {
  var all = this._read();
  if (!all.items[slug]) { all.items[slug] = {}; }
  var e = all.items[slug][id] || { n: 0, right: 0, last: null };
  e.n += 1;
  if (correct) { e.right += 1; }
  e.last = correct ? 1 : 0;
  e.seen = _now();
  all.items[slug][id] = e;
  this._write(all);
};

/* Short answer is self-scored, so it is recorded as worked but never counted
   right or wrong. `last: null` is what keeps it out of both filters. */
LocalProgress.prototype.recordSeen = function (slug, id) {
  var all = this._read();
  if (!all.items[slug]) { all.items[slug] = {}; }
  var e = all.items[slug][id] || { n: 0, right: 0, last: null };
  e.n += 1;
  e.seen = _now();
  all.items[slug][id] = e;
  this._write(all);
};

/* `ids` is optional, and that matters: the module grid needs a module's
   progress before that module has been downloaded, so there is nothing to
   pass. Without ids the counts come from whatever is recorded, which is right
   unless items have since been retired from the bank; with ids they are
   narrowed to items that still exist. */
LocalProgress.prototype.moduleStats = function (slug, ids) {
  var mod = this._read().items[slug] || {};
  var keys = ids && ids.length
    ? ids.filter(function (id) { return Object.prototype.hasOwnProperty.call(mod, id); })
    : Object.keys(mod);
  var missed = keys.filter(function (id) { return mod[id].last === 0; }).length;
  return { seen: keys.length, missed: missed };
};

/* The modules with any item history at all -- the ones cumulative review
   may draw from, and therefore the only ones worth downloading for it. */
LocalProgress.prototype.modulesWithProgress = function () {
  var items = this._read().items;
  return Object.keys(items).filter(function (slug) {
    return Object.keys(items[slug] || {}).length > 0;
  });
};

/* ---- topics ------------------------------------------------------ */

LocalProgress.prototype.topic = function (slug, key) {
  var topics = this._read().topics;
  var t = (topics[slug] && topics[slug][key]) || {};
  return { checks: t.checks || [], reviewOk: t.reviewOk || null, lapsed: t.lapsed || null };
};

/* Every stored topic record for a module, keyed by topic key. The module grid
   uses this to count mastered topics before the module is downloaded. */
LocalProgress.prototype.topics = function (slug) {
  var topics = this._read().topics;
  var out = {};
  Object.keys(topics[slug] || {}).forEach(function (key) {
    var t = topics[slug][key] || {};
    out[key] = { checks: t.checks || [], reviewOk: t.reviewOk || null, lapsed: t.lapsed || null };
  });
  return out;
};

LocalProgress.prototype._topicEntry = function (all, slug, key) {
  if (!all.topics[slug]) { all.topics[slug] = {}; }
  if (!all.topics[slug][key]) {
    all.topics[slug][key] = { checks: [], reviewOk: null, lapsed: null };
  }
  return all.topics[slug][key];
};

LocalProgress.prototype.recordCheck = function (slug, key, correct, total) {
  var all = this._read();
  var t = this._topicEntry(all, slug, key);
  t.checks.push({ date: _now(), correct: correct, total: total });
  this._write(all);
};

LocalProgress.prototype.recordReviewOk = function (slug, key) {
  var all = this._read();
  this._topicEntry(all, slug, key).reviewOk = _now();
  this._write(all);
};

LocalProgress.prototype.recordLapse = function (slug, key) {
  var all = this._read();
  this._topicEntry(all, slug, key).lapsed = _now();
  this._write(all);
};

/* ---- settings ---------------------------------------------------- */

LocalProgress.prototype.settings = function () {
  var stored = this._read().settings || {};
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    out[k] = stored[k] === undefined ? DEFAULT_SETTINGS[k] : stored[k];
  });
  return out;
};

LocalProgress.prototype.setSetting = function (name, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, name)) { return; }
  var all = this._read();
  all.settings[name] = value;
  this._write(all);
};

/* ---- reset ------------------------------------------------------- */

/* Clears a topic's checks, review dates, and the history of the items in it.
   `ids` are the topic's current item ids. */
LocalProgress.prototype.resetTopic = function (slug, key, ids) {
  var all = this._read();
  if (all.topics[slug]) { delete all.topics[slug][key]; }
  if (all.items[slug]) {
    (ids || []).forEach(function (id) { delete all.items[slug][id]; });
  }
  this._write(all);
};

LocalProgress.prototype.resetModule = function (slug) {
  var all = this._read();
  delete all.items[slug];
  delete all.topics[slug];
  this._write(all);
};

LocalProgress.prototype.clearAll = function () {
  try { localStorage.removeItem(this.key); }
  catch (e) { /* see above */ }
};

/* ------------------------------------------------------------------ */
/* The swap point                                                     */
/* ------------------------------------------------------------------ */

/* When the site moves behind an API, these two lines are the change:

     var SOURCE   = new ApiSource("https://<worker>/api");
     var PROGRESS = new ApiProgress("https://<worker>/api", studentToken);

   ApiSource implements the same two methods. `index()` returns the module
   list, which is not secret. `module(entry)` is where the shape changes: today
   it hands back every item in the module, and the API version would instead
   return a sampled session, with each option's `correct` flag and `why` text
   withheld until the answer is submitted. app.js already renders explanations
   only after an answer, so that is a data change rather than a UI one.

   ApiProgress implements the same methods as LocalProgress against the
   server, keyed by whatever identifies a student -- a roster-issued code is
   the cheapest option that still gives per-student progress, and needs no
   email infrastructure. */

var SOURCE = new StaticSource("data/");
var PROGRESS = new LocalProgress("bcog100-practice");
