# Cardly

Turn your notes into flashcards and study them anywhere. Paste or upload notes written as
`term: definition` (or a list, a spreadsheet export, a Word document or a PDF) and get a study set
instantly, then study it with Flashcards (including spaced repetition), Learn, Test, Match, Blocks
and Blast. Your sets, stars, progress and unfinished sessions sync across all your devices.

Everything is free: no paywalls, no ads, no round limits.

- **Hosting:** GitHub Pages (static site, no server code)
- **Backend:** Firebase Authentication + Cloud Firestore on the free **Spark** plan (no Cloud
  Functions, no Cloud Storage)
- **Stack:** Vite + React 19 + TypeScript, React Router (HashRouter), Zustand, Firebase modular SDK,
  `ts-fsrs`, `papaparse`, `mammoth` (DOCX), `pdfjs-dist` (PDF), `vite-plugin-pwa`, Vitest, Playwright
- **Installable PWA:** works offline after the first visit; "Add to Home Screen" on iOS/Android,
  installable on desktop

> The name lives in one place: change `APP_NAME` (and friends) in [`src/config/app.ts`](src/config/app.ts)
> to rename the app. The page title, PWA manifest and storage keys all read from there.

### This repository

| | |
| --- | --- |
| GitHub repository | `Stellan-T/cardly` |
| Live app (after the first deploy) | <https://stellan-t.github.io/cardly/> |
| Firebase project | `cardly-42dcf` (web config in [`.env`](.env), CLI default in [`.firebaserc`](.firebaserc)) |

Steps 1.1 and 1.2 are already done (the config is in `.env`). Still to do, once:
[1.3](#13-turn-on-sign-in-methods) sign-in methods,
[1.4](#14-authorize-your-github-pages-domain) add `stellan-t.github.io`,
[1.5](#15-create-the-firestore-database-and-deploy-the-rules) database + rules,
[1.6](#16-turn-on-github-pages) Pages source, and
[1.7](#17-put-the-code-on-github) put the code on GitHub.

---

## Contents

1. [Set it up (step by step)](#1-set-it-up-step-by-step)
2. [Run it locally](#2-run-it-locally)
3. [Tests](#3-tests)
4. [How it works](#4-how-it-works)
5. [Project structure](#5-project-structure)
6. [Known limitations](#6-known-limitations)

---

## 1. Set it up (step by step)

You need a GitHub account and a Google account. Nothing here costs money.

### 1.1 Create the Firebase project (Spark plan)

1. Go to <https://console.firebase.google.com> and click **Create a project** (or **Add project**).
2. Give it a name (for example `cardly`). Google Analytics is not needed; you can turn it off.
3. The project starts on the free **Spark** plan. Don't upgrade: the app doesn't use anything that
   needs the paid Blaze plan.

### 1.2 Add a Web app and copy its config

1. In the project overview, click the **Web** icon (`</>`) to add a web app. Any nickname is fine;
   you don't need Firebase Hosting.
2. Firebase shows a `firebaseConfig` object. Keep this page open; you need these six values:
   `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.

These values are public by design (they identify your project, they don't grant access, and they end
up in the built JavaScript anyway). Your data is protected by the Firestore security rules in
[`firestore.rules`](firestore.rules) and by the authorized domains in step 1.4.

Put the six values in [`.env`](.env) (this repository already has the `cardly-42dcf` values there),
and the project id in [`.firebaserc`](.firebaserc).

### 1.3 Turn on sign-in methods

In the Firebase console: **Build → Authentication → Get started → Sign-in method**, enable:

- **Google** (pick a support email and save)
- **Email/Password**
- **Anonymous** (lets people try the app as a guest; their data is kept when they sign in later)

### 1.4 Authorize your GitHub Pages domain

Still in **Authentication → Settings → Authorized domains**, click **Add domain** and add
`<your-github-username>.github.io` (for this repository: `stellan-t.github.io`, lowercase).

**Google sign-in fails on GitHub Pages without this step** (you'd see an "unauthorized domain" error).
`localhost` is already in the list for local development.

### 1.5 Create the Firestore database and deploy the rules

1. **Build → Firestore Database → Create database.** Choose a location close to your users and
   start in **production mode**.
2. Deploy the security rules and indexes from this repository. On your computer (Node.js 24+):

   ```bash
   npm install
   npx firebase login
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```

   (`firebase-tools` is a dev dependency, so `npx firebase` works after `npm install`; the project
   comes from `.firebaserc`, or add `--project <your-project-id>`.)
   Alternatively paste the contents of `firestore.rules` into **Firestore → Rules** and publish, and
   create the one composite index from `firestore.indexes.json` (collection `tests`: `setId`
   ascending, `takenAt` descending) under **Firestore → Indexes**.

### 1.6 Turn on GitHub Pages

Do this **before** the first upload, otherwise the first workflow run fails at "configure-pages".

1. Create the repository `cardly` on GitHub as **public** (GitHub Pages on a free account needs a
   public repository). It can start empty.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 1.7 Put the code on GitHub

Everything goes on the `main` branch, at the top level of the repository (so `package.json` and
`.github/` sit in the root, not inside a `cardly/` folder). The files that start with a dot
(`.github/`, `.env`, `.gitignore`, `.firebaserc`) are required: on a Mac press **Cmd + Shift + .** in
Finder to see them. Never upload `node_modules/` or `dist/`.

**Option A (easiest): GitHub Desktop or git.** Clone the empty repository, copy all files into it,
commit and push. With the command line, from inside the unzipped folder:

```bash
git init -b main
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/Stellan-T/cardly.git
git push -u origin main
```

(If the repository on GitHub already has a commit, for example a README created with it, use
`git push -u origin main --force` to replace it, or clone it and copy the files in instead.)

**Option B: the website's "Add file → Upload files".** It accepts at most 100 files per upload and
can't skip a subfolder, so upload in this order (each upload is one commit to `main`):

1. In the repository root, upload everything at the top level **except** `src/` and `.github/`
   (30 files, including `.env`, `.gitignore`, `.firebaserc` and `package-lock.json`).
2. **Add file → Create new file**, type `src/features/.keep` as the name, type anything as the
   content (e.g. `keep`) and commit. Open the new
   `src/features` folder, choose **Add file → Upload files** and drop the **contents** of your local
   `src/features` folder (70 files).
3. Open `src`, **Add file → Upload files**, and drop everything inside your local `src` folder
   **except** `features` (62 files).
4. Back in the root, upload the `.github` folder last, so the first complete run sees every file.

Each upload starts the workflow; earlier runs are cancelled automatically when a newer one starts.

The build reads the Firebase config from the committed `.env`, so no secrets are needed. (Optional:
to keep the config out of the repository, empty the values in `.env` and add repository secrets with
the same names under **Settings → Secrets and variables → Actions**; secrets override `.env`.)

### 1.8 Optional: turn on AI Insight (Gemini)

After a wrong answer in Learn, and for every missed question on the Test results page, an
**AI Insight** button asks Gemini why the answer was wrong, why the correct answer is right and how
the two differ. It uses **Firebase AI Logic** with the **Gemini Developer API**, which has a free
tier on the Spark plan. The button stays hidden until `VITE_RECAPTCHA_SITE_KEY` is set.

1. **Firebase console → AI Services → AI Logic → Get started** and choose the **Gemini Developer
   API**. Firebase enables the API and keeps the Gemini key on its side. Don't put a Gemini key in
   the app.
2. **Create a reCAPTCHA Enterprise key.** Google Cloud console (same project) → **Security →
   reCAPTCHA → Create key**, type **Website**, domains `stellan-t.github.io` and `localhost`. Copy
   the key id.
3. **Register the web app with App Check.** Firebase console → **App Check → Apps** → your web app
   → **reCAPTCHA Enterprise**, paste the key id and save.
4. Put the key id in `.env` as `VITE_RECAPTCHA_SITE_KEY=…` (it's public, like the rest of `.env`),
   commit and push.
5. Deploy the rules again (they now allow the `insights` cache):
   `npx firebase deploy --only firestore:rules`.
6. Open the deployed app, get an answer wrong and press **AI Insight**. Then go to **App Check →
   APIs → Firebase AI Logic** and click **Enforce**. Firebase requires App Check enforcement for AI
   Logic from November 2, 2026. **Don't enforce App Check for Cloud Firestore**: the app only starts
   App Check when AI Insight is first used, so enforcing it for Firestore would block normal
   loading.
7. Optional: lower the per-user request limit for the Firebase AI Logic API under **Google Cloud
   console → IAM & Admin → Quotas** so one account can't use up the free tier.

**Local development:** `npm run dev`, press AI Insight once and copy the App Check debug token that
the browser console prints. Add it under **App Check → Apps → ⋮ → Manage debug tokens**, then put it
in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN=…` so it stays the same. Never commit it. AI Insight is
off with the emulators.

The model is `AI_INSIGHT_MODEL` in `src/config/app.ts`. Google retires Gemini models regularly, so
check the [supported models](https://firebase.google.com/docs/ai-logic/models) now and then.
Explanations are cached in `users/{uid}/insights`, so repeating the same mistake doesn't call Gemini
again.

### After the push

The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) type-checks, runs the
unit tests, builds with the right base path (`/<repo-name>/`, or `/` for a `<user>.github.io`
repository) and deploys. A separate job runs the Firestore rules tests and the end-to-end test
against the Firebase emulators. Follow it under the **Actions** tab; a failed run can be re-run
there, or started by hand with **Run workflow**. Your app will be at
`https://<your-github-username>.github.io/<repo-name>/` (here: <https://stellan-t.github.io/cardly/>).

Open it, sign in with Google, and on your phone use **Share → Add to Home Screen** (iOS) or the
**Install** prompt (Android/desktop).

---

## 2. Run it locally

Needs Node.js 24 or newer (some Firebase packages declare Node 24.12+; CI uses Node 24).

```bash
npm install
npm run dev    # http://localhost:5173/cardly/ — uses the Firebase project in .env
```

Personal overrides (another Firebase project, a different base path via `VITE_BASE`) go in
`.env.local`, which is not committed.

### With the Firebase emulators (no real project needed)

The Firestore emulator needs **Java 21+** (`java -version`; firebase-tools 15 refuses older
versions). Install it with e.g. `brew install openjdk@21` (macOS, then run the `sudo ln -sfn …`
command brew prints), `sudo apt install openjdk-21-jre` (Ubuntu 24.04) or Temurin 21 from
<https://adoptium.net>.

```bash
npm run emulators   # terminal 1: Auth + Firestore emulators, UI at http://localhost:4000
npm run dev:emu     # terminal 2: the app, talking to the emulators
```

In emulator mode the app uses the `demo-cardly` project and never touches a real Firebase project.
Google sign-in opens the emulator's fake account picker.

**No Java?** The Auth emulator alone runs on Node. Start it with `npm run emulators:auth` and run
`npm run dev:emu`: sign-in works, and because no Firestore emulator answers, Firestore runs from its
offline cache — every screen works and data persists in that browser, it just never syncs anywhere.
Handy for UI work; use the full emulators (or a real project) to test sync and security rules.

### Useful scripts

| Script               | What it does                                                         |
| -------------------- | -------------------------------------------------------------------- |
| `npm run dev`        | Dev server against your real Firebase project (`.env.local`)         |
| `npm run dev:emu`    | Dev server against the local emulators                               |
| `npm run build`      | Type-check and production build into `dist/`                         |
| `npm run preview`    | Serve the production build                                           |
| `npm test`           | Unit tests (Vitest)                                                  |
| `npm run emulators:auth` | Only the Auth emulator (no Java needed; Firestore runs offline)  |
| `npm run test:rules` | Firestore security rules tests (starts the Firestore emulator)       |
| `npm run test:e2e`   | Playwright smoke test (starts Auth + Firestore emulators and the app) |
| `npm run icons`      | Regenerate PWA icons from `public/logo.svg`                          |

---

## 3. Tests

- **Unit and component tests** (`npm test`, ~200 tests): the import parser (`src/lib/parseImport.test.ts`, every format from
  the spec plus the 30-line acceptance case), grading (`grade.test.ts`), Learn progression
  (`learn.test.ts`), spaced-repetition scheduling (`srs.test.ts`), progress buckets, flashcard
  decks, export round-trips, Test generation and scoring (`testGen.test.ts`), Match timing and
  penalties (`match.test.ts`), Blocks line clearing and game-over detection (`blocks.test.ts`), and
  Blast wave/scoring logic (`blast.test.ts`), plus Testing Library tests of the import preview
  (`src/features/import/ImportFlow.test.tsx`).
- **Security rules** (`npm run test:rules`, needs Java): `tests/rules/firestore.rules.test.ts` checks
  that users can only read/write their own data, field-size validation, public sets, leaderboards
  and default deny.
- **End to end** (`npm run test:e2e`, needs Java; first run `npx playwright install chromium`):
  `tests/e2e/smoke.spec.ts` signs up on the Auth emulator, pastes `term: definition` notes, creates
  a set, studies it in Flashcards, completes a Learn round and takes a Test.

---

## 4. How it works

### Paste notes → study set

`src/lib/parseImport.ts` is a pure function that runs on every keystroke for the live preview:

- Normalises line endings, strips a BOM, ignores blank lines.
- Strips list markers (`-`, `*`, `•`, `·`, `▪`, `1.`, `1)`, `a)`, `(1)`, `[ ]`, `[x]`, `>`) and
  `**bold**`/`__bold__` around terms.
- Splits each card on the **first** term/definition separator only, so definitions can contain it.
- **Auto-detect** scores each candidate separator by the share of lines containing it and prefers
  tab > colon > dash > equals > comma on near-ties. Colons in URLs, times (`12:30`) and ratios
  (`3:1`) don't count. Lines that use a different separator than the majority still become cards
  (flagged in the preview).
- Custom separator exports such as `term##definition####term##definition` are detected
  automatically; custom separators can also be typed (multi-character, never trimmed, `\t`/`\n`
  understood).
- A separator-less line right after a card continues that card's definition (indented sub-bullets
  too); the preview shows these merges with an undo (split) button.
- Markdown headings and short `Heading:` lines followed by cards are headings, optionally used as
  tags. "Term on one line, definition on the next, blank line between cards" is detected too.
- CSV uses a real CSV parser (quoted commas and line breaks), and header rows like
  `term,definition` are skipped.
- Warnings: empty term/definition, duplicate terms, terms over 1,000 and definitions over 10,000
  characters.

Files: `.txt`, `.md`, `.csv`, `.tsv`, `.docx` (mammoth) and text-based `.pdf` (pdf.js). Both parsers
are lazy-loaded. Scanned PDFs get a clear message.

### Data model (Firestore)

```
users/{uid}                              profile, settings, streak
users/{uid}/sets/{setId}                 title, description, languages, visibility, counts,
                                         summary (bucket counts), srsDue (sorted due dates), folderIds
users/{uid}/sets/{setId}/cards/{cardId}  term, definition, order, starred, imageId?, imageUrl?, tags
users/{uid}/progress/{setId}             cards: { cardId → seen/correct/incorrect/streak/level/srs }, stats
users/{uid}/sessions/{setId}             flashcards deck/piles, learn state, per-activity options,
                                         grading preferences, stars on shared sets, match cursor
users/{uid}/folders/{folderId}           name, setIds
users/{uid}/tests/{testId}               setId, scorePct, correct, total, durationMs, settings, takenAt
users/{uid}/images/{imageId}             dataUrl (≤150 KB WebP/JPEG), width, height, bytes
users/{uid}/insights/{key}               cached AI Insight: setId, cardId, text, model, createdAt
publicSets/{setId}                       read-only copy of a set shared by link (+ images subcollection)
leaderboards/{setId}/match/{uid}         displayName, bestTimeMs, achievedAt
```

**Cards:** the single source of truth is the `cards` subcollection (one small document per card),
not an array on the set document. Cards can be edited, starred and reordered individually, a set
can hold many long definitions without hitting the 1 MiB document limit, and the offline cache
makes repeat loads free. List views (Home, Library) only read set documents, which carry the counts
and summaries they need.

**Writes are write-behind.** Each answer updates local state immediately; progress and session
changes are flushed to Firestore at most every 2 seconds and whenever the page is hidden or a study
screen closes (`src/data/studyStores.ts`). That keeps a heavy study session to a few dozen writes,
well within the free tier, while another device still sees an unfinished Learn session within
seconds. No write is ever awaited in the UI, so everything works offline (Firestore's persistent
multi-tab cache queues the writes and syncs them later; the top bar shows Synced / Syncing… /
Offline).

### Progress buckets

- **Not studied:** never answered in Flashcards (sorting / spaced repetition), Learn or Test.
- **Still learning:** answered at least once but not mastered.
- **Mastered:** correct on the last two attempts in a row (Know / Okay / Easy count as correct), or
  Mastered in Learn. A wrong answer anywhere moves it back. Games don't affect progress.

### Spaced repetition

FSRS via `ts-fsrs`, tuned so a new card's first review matches the buttons: **Repeat** ≈ 1 minute
(same session), **Hard** ≈ 10 minutes (later in the session), **Okay** ≈ 1 day, **Easy** ≈ 4–5 days.
Later intervals follow the standard FSRS model. New cards are capped per day (Settings, default 20).
Learning cards due within 20 minutes are shown early so a session doesn't stall.

### Grading

`src/lib/grade.ts`, three levels:

- **Strict:** exact, forgiving only case, punctuation and surrounding whitespace.
- **Moderate:** also accents (`cafe` = `café`) and one typo (answers ≤ 6 characters) or two (longer).
  Numbers must match exactly and answers of 1–2 characters get no typo allowance.
- **Relaxed:** also the same key words in any order, ignoring stopwords and singular/plural. There's
  no NLP server, so it's honest word matching ("Relaxed grading accepts small wording differences").

Always: trim, collapse spaces, ignore case and trailing punctuation, curly = straight quotes,
`&` = `and`, parenthesised parts of the correct answer are optional (`(to) run` accepts `run`).
Answers listing options (`big, large`, `kat / poes`) need all of them in any order, or any one with
**Require 1 answer only**. Every written answer has **I was correct**.

Default level per set: Strict for language pairs, Chinese/Japanese and maths/chemistry; Relaxed when
both sides are in the user's language; Moderate otherwise (overridable in Settings and per set).

### Accounts

Google (popup; redirect inside in-app browsers and iOS home-screen apps), email/password with
password reset, and guest accounts (Firebase anonymous auth). When a guest signs in, the anonymous
account is linked so nothing is lost; if the Google account already exists, the guest's sets are
copied into it. Settings has JSON export/import and account deletion (re-authentication first, then
all Firestore data, then the auth user).

### Images

Firebase Storage needs the paid plan, so a card image is either an external URL or an upload that
is resized to 800 px and compressed to WebP/JPEG ≤ 150 KB in the browser, then stored as a data URL
in its own document (`users/{uid}/images/{imageId}`) so card documents stay small.

---

## 5. Project structure

```
src/
  config/app.ts          app name and identity (rename here)
  firebase/              Firebase init (offline persistence, emulators); ai.ts: Gemini + App Check
  data/                  Firestore access: paths, mappers, sets, write-behind stores, account, …
  lib/                   pure logic + unit tests: parseImport, grade, srs, learn, progress,
                         flashcards, testGen, match, blocks, blast, questions, languages, tts, …
  components/            UI kit: Dialog, Menu, toasts, controls, hotkeys, shortcut overlay, …
  features/
    auth/                sign-in page, auth provider, guest linking
    import/              paste/upload → preview → create set
    editor/              create/edit set (autosave, drag to reorder, images, Tab navigation)
    sets/                set page, progress buckets, terms list, actions, study-set context
    home/ library/ settings/ shell/
    study/               shared study layout, hooks and options
    flashcards/ learn/ test/ match/ blocks/ blast/
  styles/                design tokens (light/dark), components
tests/rules/             Firestore rules tests (emulator)
tests/e2e/               Playwright smoke test (emulators)
samples/                 sample sets used by tests and "Try a sample"
```

Keyboard shortcuts are listed in the app: press **?** anywhere.

---

## 6. Known limitations

- **Signing in with a redirect** (used only inside in-app browsers and iOS home-screen apps) can be
  blocked by browsers that partition third-party storage, because GitHub Pages and
  `<project>.firebaseapp.com` are different sites. Opening the site in Safari/Chrome itself (popup
  sign-in) always works. A custom domain with Firebase Hosting as the auth domain would remove this,
  but isn't possible on GitHub Pages alone.
- **Guest accounts** that are merged into an existing account leave their (now unused) anonymous
  data behind; Firebase can clean up old anonymous accounts automatically if you enable it.
- **Shared sets** are a read-only copy and must fit in one Firestore document (about 900 KB of
  text); larger sets show a message asking you to split them.
- **Text-to-speech** voices come from the device, so they differ between devices and browsers.
- **Test** warns before a reload, closing the tab, the X button or an in-app link while answers are
  unsubmitted, but the browser's Back button can't be intercepted with a hash router.
- **Autoplay** in Flashcards is available in Browse mode (sorting and spaced repetition need your
  input on every card).
- **Match leaderboards** show other players only for sets shared by link; private sets list your own
  best runs.
- **Blast** shortens very long answers on the asteroids (the full text is on the answer buttons
  below the game); card images aren't used in Blast.
- The multiplayer Blast room (a stretch goal) is not included.
