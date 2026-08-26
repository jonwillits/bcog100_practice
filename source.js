/* BCOG 100 practice site — the data layer, and the only file that knows where
   questions and progress come from.
   ---------------------------------------------------------------------------

   app.js talks to two objects and never to the network or to storage:

     QuestionSource          ProgressStore
       .index()                .moduleStats(slug, ids)
       .module(entry)          .itemState(slug, id)
                               .record(slug, id, correct)
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

/* Resolves to a module's full bank: {module, slug, title, pools:[...]}.
   Cached, because a student moving between modules should not re-download one
   they have already opened. */
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

/* Per item, per module: how many times it has been answered, how many of
   those were right, and whether the most recent attempt was right. That last
   flag is what "questions I missed" filters on -- a question answered wrong in
   September and right in October is not one we still owe.

   Storage is a convenience and never load-bearing. A private window, cleared
   site data, or an embedding context that blocks storage all make these
   throw, and the page must work identically when they do. */

function LocalProgress(key) {
  this.key = key || "bcog100-practice";
}

LocalProgress.prototype._read = function () {
  try { return JSON.parse(localStorage.getItem(this.key)) || {}; }
  catch (e) { return {}; }
};

LocalProgress.prototype._write = function (state) {
  try { localStorage.setItem(this.key, JSON.stringify(state)); }
  catch (e) { /* nothing to do, and nothing worth telling the student */ }
};

LocalProgress.prototype.itemState = function (slug, id) {
  var all = this._read();
  return (all[slug] && all[slug][id]) || null;
};

LocalProgress.prototype.record = function (slug, id, correct) {
  var all = this._read();
  if (!all[slug]) { all[slug] = {}; }
  var e = all[slug][id] || { n: 0, right: 0, last: null };
  e.n += 1;
  if (correct) { e.right += 1; }
  e.last = correct ? 1 : 0;
  all[slug][id] = e;
  this._write(all);
};

/* Short answer is self-scored, so it is recorded as worked but never counted
   right or wrong. `last: null` is what keeps it out of both filters. */
LocalProgress.prototype.recordSeen = function (slug, id) {
  var all = this._read();
  if (!all[slug]) { all[slug] = {}; }
  var e = all[slug][id] || { n: 0, right: 0, last: null };
  e.n += 1;
  all[slug][id] = e;
  this._write(all);
};

/* `ids` is optional, and that matters: the module grid needs a module's
   progress before that module has been downloaded, so there is nothing to
   pass. Without ids the counts come from whatever is recorded, which is right
   unless items have since been retired from the bank; with ids they are
   narrowed to items that still exist. */
LocalProgress.prototype.moduleStats = function (slug, ids) {
  var mod = this._read()[slug] || {};
  var keys = ids && ids.length
    ? ids.filter(function (id) { return Object.prototype.hasOwnProperty.call(mod, id); })
    : Object.keys(mod);
  var missed = keys.filter(function (id) { return mod[id].last === 0; }).length;
  return { seen: keys.length, missed: missed };
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

   ApiProgress implements record/recordSeen/moduleStats/itemState against the
   server, keyed by whatever identifies a student -- a roster-issued code is
   the cheapest option that still gives per-student progress, and needs no
   email infrastructure. */

var SOURCE = new StaticSource("data/");
var PROGRESS = new LocalProgress("bcog100-practice");
