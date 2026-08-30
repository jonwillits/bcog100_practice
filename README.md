# BCOG 100 — Practice Questions

The student-facing practice site for BCOG 100 at the University of Illinois. One page covering every module: <https://jonwillits.github.io/bcog100_practice/>.

Questions come from the course's quiz banks, which live in the private course tree and are **not** in this repo. This repo holds the site's code plus a generated `data/` directory exported from those banks.

## What is public here, and what that means

This site is public and unauthenticated. Everything in `data/` — stems, keyed answers, and explanations — is readable by anyone who has the URL, and by anyone who reads this repository.

That is a deliberate, temporary choice, made on 2026-08-26. It is worth being precise about what it does and does not do.

**What the current setup protects against.** `robots.txt` and a `noindex` meta tag keep the site out of search results, so nobody finds it who was not given the address. That removes most realistic exposure: a student searching for the course, or a question-scraping site crawling the web, will not turn it up.

**What it does not protect against.** Anything at all beyond that. A student who has the URL can read `data/*.json` directly, and so can anyone they forward it to. No encryption or repository-obscurity scheme changes that, because a static site hands the browser everything it needs to render the page. Do not describe this site to students, or to anyone else, as though the bank were hidden.

**Why that is acceptable.** The pools are meant to be practiced against, and they will grow well past the point where memorizing them is easier than learning the material.

**There is no longer an alternative route.** Until 2026-08-30 this section said the Canvas route "still works... nothing here retires it," while `build_site.py` called Canvas the fallback and the tools README documented Canvas as the way in. That disagreement is what let this site go unpublished for four days while the banks moved underneath it — Module 0's live pool was missing a whole pool of 20 items and Module 1's was 45 items behind, days before the quizzes those pools feed. **The Canvas exporters are retired** (`course_creation/tools/quiz_bank/_to_delete/`), and this site is the only way questions reach students.

**The route out.** `source.js` is the only file that knows where questions and progress come from. Replacing `StaticSource` with an `ApiSource` that fetches a sampled session from a server — and `LocalProgress` with an `ApiProgress` keyed to a student — hides the bank properly and makes progress follow a student between devices. That is a change to one file, not a rewrite, and the interface is documented at the top of it.

## Layout

```
index.html      the page shell
styles.css      palette, spacing, and states
source.js       QuestionSource + ProgressStore -- the only file that fetches or stores
app.js          the interface: module grid, filters, a run, results
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

A student picks a module, filters by topic, question type, difficulty, and focus (all questions / not yet tried / missed last time), and works a shuffled set. Multiple choice is answered in one click and every option's explanation appears at once — including the options not chosen, which is most of the value. Short answer is self-scored against a model answer and rubric, and never counts toward the score. Missed questions can be retried immediately, and each module is addressable as `#/m/<slug>` so a student can bookmark the one they are working on.

Progress is per item, per module, in this browser's `localStorage`: how many times an item has been answered, how many were right, and whether the last attempt was right. That last flag drives the "missed last time" filter. Storage is never load-bearing — in a private window or with site data blocked, every feature except the saved progress works exactly as it does otherwise.

## Accessibility

To be preserved through any redesign: real `<button>` elements throughout, so keyboard and screen-reader navigation work without help; visible focus outlines; `aria-pressed` on the filter chips; a live region announcing whether an answer was correct; colour never the only signal for right and wrong (a ✓/✕ carries it too); a light and a dark palette both meeting contrast requirements; and reduced motion respected.

## Two constraints on any edit

**Nothing is fetched from outside this repo.** No CDN scripts, no web fonts, no analytics. A student on campus wifi should need nothing beyond these files, and there is no reason for a practice session to be observable by a third party.

**No `fetch()` and no `localStorage` outside `source.js`.** That separation is what keeps the move to a real backend to one file.
