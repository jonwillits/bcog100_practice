# BCOG 100 — Practice Questions

The student-facing practice site for BCOG 100 at the University of Illinois. One page covering every module: <https://jonwillits.github.io/bcog100_practice/>.

Questions come from the course's quiz banks, which live in the private course tree and are **not** in this repo. This repo holds the site's code plus a generated `data/` directory exported from those banks.

## What is public here, and what that means

This site is public and unauthenticated. Everything in `data/` — stems, keyed answers, and explanations — is readable by anyone who has the URL, and by anyone who reads this repository.

That is a deliberate, temporary choice, made on 2026-08-26. It is worth being precise about what it does and does not do.

**What the current setup protects against.** `robots.txt` and a `noindex` meta tag keep the site out of search results, so nobody finds it who was not given the address. That removes most realistic exposure: a student searching for the course, or a question-scraping site crawling the web, will not turn it up.

**What it does not protect against.** Anything at all beyond that. A student who has the URL can read `data/*.json` directly, and so can anyone they forward it to. No encryption or repository-obscurity scheme changes that, because a static site hands the browser everything it needs to render the page. Do not describe this site to students, or to anyone else, as though the bank were hidden.

**Why that is acceptable.** The pools are meant to be practiced against, and the thing that counts, a mastery check, draws items the student has not seen, so it rewards understanding the topic rather than recalling answers.

**There is no longer an alternative route.** Until 2026-08-30 this section said the Canvas route "still works... nothing here retires it," while `build_site.py` called Canvas the fallback and the tools README documented Canvas as the way in. That disagreement is what let this site go unpublished for four days while the banks moved underneath it — Module 0's live pool was missing a whole pool of 20 items and Module 1's was 45 items behind, days before the quizzes those pools feed. **The Canvas exporters are retired** (`course_creation/tools/quiz_bank/_to_delete/`), and this site is the only way questions reach students.

**The route out.** `source.js` is the only file that knows where questions and progress come from. Replacing `StaticSource` with an `ApiSource` that fetches a sampled session from a server — and `LocalProgress` with an `ApiProgress` keyed to a student — hides the bank properly and makes progress follow a student between devices. That is a change to one file, not a rewrite, and the interface is documented at the top of it.

## Layout

```
index.html      the page shell
styles.css      palette, spacing, and states
source.js       QuestionSource + ProgressStore -- the only file that fetches or stores
study.js        pure study logic: topic status, sampling a check, sampling review
app.js          the interface: module grid, topics, checks, practice sets, results
test/           node test/study.test.js -- no dependencies
favicon.svg
robots.txt      Disallow: /
.nojekyll       GitHub Pages serves the files as they are
data/           GENERATED. Do not edit -- rebuild it (below)
```

## Rebuilding the questions

The banks are the source of truth and are edited in the course tree, never here. Editing a bank changes nothing that students can see until the site is rebuilt and pushed. One command does all of it, from `current_version/`:

```bash
python3 "/Users/jon/Library/CloudStorage/Box-Box/teaching/bcog_web/courses/introduction_to_brain_and_cognitive_science_1/current_version/course_creation/tools/quiz_bank/build_site.py" --push
```

That audits the banks, exports `data/`, commits, and pushes; GitHub Pages redeploys itself from the push, so the questions are live a minute or two later. If nothing changed it says so and does nothing.

```bash
python3 course_creation/tools/quiz_bank/build_site.py --check   # is the site behind the banks?
python3 course_creation/tools/quiz_bank/build_site.py           # export only, no commit
```

**`--push` refuses to publish a bank with audit errors.** On this site a push *is* publication, with no second gate behind it, so the audit is the only thing standing between a broken item and a student reading it. `--skip-audit` exists and should stay unused.

**Run it from a terminal, not through a Cowork bridge session.** Git cannot clean up its own lock files over the bridge mount, and leaves a stale `.git/index.lock` behind on every command.

`build_site.py` writes one `NN_<slug>.json` per module plus an `index.json` listing all sixteen, so a module with no bank yet shows on the site as not available rather than being silently absent. The item serializer lives in `course_creation/tools/quiz_bank/item_json.py`.

One thing `--check` is good for: it is the honest answer to "is what students can see current?", and it belongs in `CHECKPOINT.md` beside the course build's own check — this is the one check that catches a bank edited and never published.

**Do not run the bare export as a substitute for pushing.** `build_site.py` with no flags writes `data/` and stops, after which `--check` reports the site current while students still see the old pool. If you export, push.

## Working on the site locally

`fetch()` will not read `data/` over `file://`, so open it through a server:

```bash
cd bcog100_practice && python3 -m http.server 8899
# then http://localhost:8899/
```

## What the site does

**The topic is the unit of progress.** A module's pools are its topics, grouped under the lecture each draws on (from the pool's `lectures` field), with the module's lab pool as its own group. Each topic shows a status — not tried, practicing, mastered, or review due — and two actions: *Check this topic* and *Reset*. The module grid reports topics and how many are mastered, never item counts, because the point of the redesign (2026-10-11) is that nobody is expected to work every question.

**A mastery check** is ten multiple-choice items from one topic (every one it has, if fewer), sampled one per claim, with at least one application item where the topic has one, preferring items the student has not seen and then the ones seen longest ago. Explanations appear after each answer as in practice. At the end the student sees the score, whether it meets their mastery level, and the items missed with *Practice these*. The level is theirs to set — 70, 80, 90 or 100%, default 90 — and because status is computed from the stored scores each time it is shown, changing the level re-labels every topic at once. A mastered topic becomes *Review due* fourteen days after the later of its last passing check and its last review item answered right.

**A practice set** is drawn from the selected topics at a chosen size (10, 15, 25 or all; default 15), with the "missed last time" focus and, under *More filters*, question type and difficulty. A student-set share of each set (0–50%, default 20%) is cumulative review: multiple-choice items from topics the student has already practiced, other than the ones selected, in this module and in any other module they have worked (or a chosen list of modules). Review-due topics come first, then items last answered wrong, then the topics practiced longest ago. A review item answered right restarts its topic's fourteen days; one answered wrong sends a mastered topic straight back to review. Review answers never add a check score. Other modules' JSON is downloaded for this only when they have saved progress.

**Prepare for a quiz** runs a check across every topic in one lecture, core and standard items only — what the in-class quiz draws from — and reports the result per topic without changing any topic's status.

Multiple choice is answered in one click and every option's explanation appears at once — including the options not chosen, which is most of the value. Short answer is self-scored against a model answer and rubric, never counts toward a score, and is never in a check. Each module is addressable as `#/m/<slug>` so a student can bookmark the one they are working on. The source locator of an item is not shown; students cannot resolve a claim id, and `ITEM_WRITING_RULES.md` rule 8.4 says locators never reach them.

### What is stored

Everything is under one `localStorage` key, `bcog100-practice`, as one versioned object (`v: 2`):

- **`items[slug][id]`** — per item, per module: `n` times answered, `right` of those, `last` (1, 0, or null for self-scored short answer; it drives the "missed last time" filter), and `seen`, when it was last answered, which is what lets a check prefer unseen items.
- **`topics[slug][key]`** — per topic: `checks`, every check as `{date, correct, total}`; `reviewOk`, the last review item from the topic answered right; `lapsed`, the last one answered wrong. Status is never stored; `study.js` computes it from these against the current level.
- **`settings`** — `masteryLevel`, `reviewShare`, and `reviewScope` (null for every practiced module, or a list of slugs).

The topic key is a slug of the pool's title, not its index, because a lab pool is being appended to every module and pools may be reordered; the lab pool is keyed `lab` whatever it is titled, so renaming it to name the lab keeps its history. Renaming any other pool orphans its history, which is acceptable and worth knowing. The pre-2026-10-11 shape (item maps keyed by slug at the top level) is migrated on first read. Dates are ISO strings.

Storage is never load-bearing — in a private window or with site data blocked, every feature except the saved progress works exactly as it does otherwise; a check still reports its score, it simply is not remembered.

## Accessibility

To be preserved through any redesign: real `<button>` elements throughout, so keyboard and screen-reader navigation work without help; visible focus outlines; `aria-pressed` on the filter chips; a live region announcing whether an answer was correct; colour never the only signal for right and wrong (a ✓/✕ carries it too) or for a topic's status (a text label and a symbol carry it); a light and a dark palette both meeting contrast requirements; and reduced motion respected.

## Tests

`study.js` is pure and loads under Node, so its logic — status against a level, the fourteen-day lapse, exact-level passes, sampling with too few items, claimless items, the review order — is covered by `test/study.test.js`:

```bash
node test/study.test.js
```

## Two constraints on any edit

**Nothing is fetched from outside this repo.** No CDN scripts, no web fonts, no analytics. A student on campus wifi should need nothing beyond these files, and there is no reason for a practice session to be observable by a third party.

**No `fetch()` and no `localStorage` outside `source.js`.** That separation is what keeps the move to a real backend to one file.
