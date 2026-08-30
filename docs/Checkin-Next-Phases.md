# Check-in system — instructions for the next phases

Everything through Phase 7 is **written**. Almost none of it is **verified**.
That gap is what the phases below close, in the order they must happen.

Authority: `FANCY_RSVP_CHECKIN_SPEC.md` v1.0 as amended by
`Checkin-Spec-Amendments.md` — the amendment record wins on any disagreement.
Read Part D there before touching check-in code; it records the 2026-07-31
review and ten fixes, several of which are themselves unverified.

## Where the build actually stands

| | State |
|---|---|
| Backend | Feature-complete. **500/500 unit tests pass, 0 skipped** (`npm test`, verified 2026-07-31 after the review fixes). |
| Migrations | Written, **never applied anywhere**. All SQL unrun. |
| Integration tests | 65 written, **never run** (need Docker). |
| Android | ~56 `.kt` files, all 7 phases. **Compiles, assembles, 108/108 tests pass** (2026-07-31). Never run on a device. |
| Frontend | 6 dashboard components + 2 pages. Rendered? **No.** |
| Cross-language contracts | 4, pinned by golden vectors on both sides. **All four verified by execution on both sides.** |

**Phase 8 and Phase 10 are done.** The build host is provisioned (Ubuntu 24.04,
JDK 17, Gradle 8.9, SDK 35), the wrapper and Room schema baseline are committed,
and the app builds clean. Phase 9 (migrations + integration tests) and Phases
11–15 remain. Phase 11's contract verification was completed early, as a side
effect of running the unit tests — see the Android README's verification section.

Two rules that survive every phase below:

- **`fallbackToDestructiveMigration` is a release blocker** (§21.2). It deletes
  check-ins that exist nowhere else. Its absence from `CheckinDatabase` is
  deliberate — a failed migration must fail loudly, never wipe.
- **No raw control characters or literal Arabic in Kotlin source.** Character
  sets are built from code points. One altered byte breaks a contract for the
  whole fleet, and it is invisible in review.

---

# Phase 8 — Make the toolchain exist

Nothing downstream can start until this is done.

**Governing rule for this phase:** restore the project, do not modernize it. Do
not change AGP, Kotlin, Gradle plugins, `compileSdk`, `targetSdk`, or any
dependency version unless you have *proven* an incompatibility. The pins below
were checked against each other and are internally consistent — there is nothing
to change.

### 8.0 The version matrix — install to match these exactly

| Pinned in the project | Requires | Consistent |
|---|---|---|
| AGP **8.7.3** | Gradle ≥ **8.9**, JDK ≥ **17** | ✅ |
| Kotlin **2.0.21** | — | ✅ |
| KSP **2.0.21-1.0.28** | Kotlin **2.0.21** exactly — the prefix must match | ✅ |
| `jvmTarget` / `sourceCompatibility` **17** | JDK 17 | ✅ |
| `compileSdk` / `targetSdk` **35** | `platforms;android-35`, `build-tools;35.0.0` | ✅ |
| Hilt **2.52**, Compose BOM **2024.12.01** | Kotlin 2.0.x + KSP | ✅ |

Two dependency pins are **not free choices**:

- `mlkit-barcode-bundled` — the **bundled** model, never the Play-Services
  download variant. A tablet with no internet at the venue may not have the
  downloaded model, and scanning dies exactly when it matters (§4).
- `sqlcipher` — required, not optional. The local DB holds the complete guest
  list of a private event (§20.3).

Known **warning**, not an error: `resourceConfigurations` is deprecated in AGP
8.7 in favour of `androidResources.localeFilters`. Leave it alone — it works,
and changing it is modernization.

### 8.1 `gradle.properties` — was missing, now added

The project had **no `gradle.properties` at all**, so `android.useAndroidX` was
never set. Every dependency here is AndroidX, and AGP hard-fails at
configuration time:

```
Configuration ':app:debugRuntimeClasspath' contains AndroidX dependencies,
but the 'android.useAndroidX' property is not enabled.
```

That aborts before compilation and would mask every other error. The file now
exists with two settings and nothing else — `useAndroidX`, and a daemon heap /
UTF-8 pair. See the file's own comments for why each is required. This is
restoration: it changes no version.

### 8.2 Building on a VPS (headless Linux)

Assumes **Ubuntu 22.04/24.04 LTS, x86_64**. No emulator is needed —
`assembleDebug` and the JVM unit tests are the whole point of building here.

**Size the box properly.** The Gradle daemon takes 2 GB, the Kotlin compile
daemon runs alongside it, and KSP processes Room and Hilt together.

- RAM: **4 GB minimum**, 8 GB comfortable. A 2 GB box will thrash or OOM.
- Disk: **~15 GB free** for the SDK, Gradle distributions and `~/.gradle` caches.

```bash
# ── JDK 17 (not 21 — match AGP 8.7.3) ──────────────────────────────
sudo apt update && sudo apt install -y openjdk-17-jdk unzip wget
java -version          # must print 17.x

# ── Gradle 8.9, only to generate the wrapper once ──────────────────
# apt ships an old Gradle; do not use it.
wget https://services.gradle.org/distributions/gradle-8.9-bin.zip
sudo unzip -d /opt/gradle gradle-8.9-bin.zip
export PATH="$PATH:/opt/gradle/gradle-8.9/bin"

# ── Android SDK, command-line tools only ───────────────────────────
# Check developer.android.com/studio#command-line-tools-only for the
# current filename; the build number changes.
sudo mkdir -p /opt/android-sdk/cmdline-tools
cd /opt/android-sdk/cmdline-tools
sudo wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
sudo unzip commandlinetools-linux-*.zip
sudo mv cmdline-tools latest        # the path MUST be cmdline-tools/latest/
export ANDROID_HOME=/opt/android-sdk
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

yes | sdkmanager --licenses
sdkmanager --install "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

Persist the three exports in `~/.bashrc` or the next login loses them.

### 8.3 Generate the Gradle wrapper — it does not exist

`android/README.md` tells you to run `./gradlew`. **There is no `gradlew`.** No
wrapper script, no `gradle/wrapper/` directory, no jar. It was never generated
because no Gradle was available to generate it.

```bash
cd /path/to/fancy/android
gradle wrapper --gradle-version 8.9
```

Commit the wrapper — including `gradle-wrapper.jar`. An uncommitted wrapper
means every machine builds with whatever Gradle happens to be installed, which
is how "works on mine" starts.

### 8.4 Create `local.properties` (untracked)

On the VPS:

```properties
sdk.dir=/opt/android-sdk
API_BASE_URL_DEBUG=http://127.0.0.1:5000/api/v1/
API_BASE_URL_RELEASE=https://fancyrsvp.com/api/v1/
```

On Windows the `sdk.dir` is escaped: `sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk`

**The trailing slash on the URLs is required.** Retrofit resolves relative paths
against the base URL and silently drops the last segment without one — every
call 404s and nothing explains why.

`10.0.2.2` is the *emulator's* route to its host. A physical tablet needs the
LAN address of the machine running the API, and
`app/src/debug/network_security_config.xml` is what permits cleartext for it.
That config is debug-only by design; do not widen it.

### 8.5 Build in escalating steps

Each step gives a cleaner error surface than the next. Do not skip ahead — a
failure at step 2 is unreadable inside step 4.

```bash
cd android
./gradlew --version                      # 1. toolchain sanity
./gradlew :app:dependencies              # 2. do the pinned versions resolve?
./gradlew :app:compileDebugKotlin        # 3. fastest path to real compile errors
./gradlew :app:assembleDebug             # 4. full build incl. KSP, Room, Hilt
./gradlew :app:testDebugUnitTest         # 5. the 6 JVM test files
```

**Step 2 is the one genuine unknown.** Every version in
`gradle/libs.versions.toml` is pinned but was **never resolved against a
repository**. If one is unavailable, that is a *proven* incompatibility and the
minimum correction is allowed — change that one pin, nothing else.

Capture output for anything that fails:

```bash
./gradlew :app:assembleDebug --stacktrace 2>&1 | tee build.log
```

**When a step fails: stop.** Identify the root cause, report the exact error,
and take the smallest next step. Do not apply speculative fixes, do not refactor,
and do not bump versions to make an error go away — a version bump that "fixes"
a compile error usually just moves it.

**Done when:** `assembleDebug` succeeds and the 6 JVM test files pass.

---

# Phase 9 — Apply the migrations, run the integration suite

**This is Phase 1's definition of done.** Not the unit tests — those mock the
database, so they prove the JavaScript is consistent with itself and nothing
more. Every RPC, constraint and index below is currently unexecuted SQL.

### 9.1 Pre-flight: the entrance index can abort the migration

`20260814000000` creates:

```sql
CREATE UNIQUE INDEX uq_tables_event_entrance_name
  ON public.tables (event_id, lower(trim(table_name)))
  WHERE element_type = 'zone' AND shape = 'entrance';
```

If **any existing event** already has two entrances whose names differ only by
case or whitespace, index creation fails and the whole migration aborts. The old
code allowed this — its uniqueness check was read-then-write with no constraint
behind it. Check production **before** applying:

```sql
SELECT event_id, lower(trim(table_name)) AS name, count(*)
FROM public.tables
WHERE element_type = 'zone' AND shape = 'entrance'
GROUP BY 1, 2 HAVING count(*) > 1;
```

Zero rows → proceed. Any rows → rename the duplicates first. The index is
deliberately scoped to entrances rather than the whole table precisely so it
only has to be true of the rows the check-in system depends on.

### 9.2 Apply, in order

```bash
npx supabase start          # boots Postgres AND applies every migration in order
```

`20260814000000_checkin_offline_foundation.sql` → then
`20260815000000_checkin_guest_delta_and_controls.sql`. The order matters:
the second builds on tables the first creates.

Watch for `checkin_undo`. It takes **six** parameters now. Adding defaulted
parameters creates an *overload* rather than replacing the function, and
PostgREST resolves RPCs by parameter name — with both forms present a 4-key call
matches two candidates and fails as ambiguous. The migration drops the
4-argument form explicitly. If you see `PGRST203` at runtime, that drop did not
take.

### 9.3 Run the suite

```powershell
cd backend
$env:INTEGRATION_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
npm run test:integration
```

`checkinBatch.test.js` is the one that matters. It proves against real Postgres
that `checkin_batch_upsert` is replay-safe, that a second offline admission
becomes a conflict rather than an insert, that exactly one of six concurrent
drains wins the advisory lock, that `checkin_undo` takes its own sequence
position **without moving the original**, and that an undone guest can check in
again through the partial unique index.

Without `INTEGRATION_DB_URL` these **skip rather than fail**. A green run that
says "skipped" has proven nothing — check the count.

### 9.4 Verify what the 2026-07-31 review changed

These were fixed after the last full pass and are unverified SQL:

- [ ] `check_ins.undone_by_staff_id` and `undone_by_staff_name` exist.
- [ ] A device undo by a supervisor writes both, and leaves `deleted_by` null.
- [ ] An organizer undo writes `deleted_by` and leaves both staff columns null.
- [ ] `checkin_undo` still allocates `undo_seq` without touching `server_seq`.

**Done when:** all 65 pass, none skipped.

---

# Phase 10 — First Kotlin compile

Expect this to fail repeatedly. That is the point of the phase — no Kotlin here
has ever been near a compiler.

```bash
cd android
./gradlew :app:testDebugUnitTest    # JVM tests, no device needed
./gradlew :app:assembleDebug
```

### 10.1 Where errors are most likely

Ranked by how much of the code was written without a type-checker to argue with:

1. **Compose imports.** Material 3 and lifecycle APIs move between versions.
   `LocalLifecycleOwner` in particular moved out of `compose.ui.platform`.
2. **Hilt/KSP wiring.** Every `@HiltViewModel` constructor must be fully
   satisfiable from `AppModule`. `GuestListViewModel` gained a `SessionManager`
   parameter on 2026-07-31 — it is a `@Singleton` with an `@Inject` constructor,
   so it should resolve, but this is exactly the kind of thing that only shows
   up at compile time.
3. **Room DAO signatures** against the entities, and the generated `_Impl`s.
4. **Retrofit interface validation**, which happens at *interface-creation
   time*, not per call. `undoCheckIn` uses `@HTTP(method = "DELETE", hasBody =
   true)` deliberately: Retrofit's `@DELETE` declares `hasBody = false` and
   throws `"Non-body HTTP method cannot contain @Body"`. Do not "simplify" it
   back to `@DELETE`.
5. **`SyncCoordinator`** now reads `MAX_TRUNCATED_FOLLOWUPS` from
   `SyncRepository`'s companion, which was made non-private for it. If you see
   a visibility error there, that is why.

### 10.2 Generate and commit the Room schema baseline — do this once, now

`ksp { arg("room.schemaLocation", "$projectDir/schemas") }` is configured, but
`android/app/schemas/` **has never been generated**. A successful
`assembleDebug` creates it.

**Commit that JSON.** §21.2 requires migration tests against every previously
released schema. Without a baseline captured *before* the first release, there
is nothing to migrate *from* — and that hole cannot be filled retroactively once
a tablet in the field holds version 1 data.

There is also **no `app/src/androidTest/` directory**. Room migration tests are
instrumented and need one. Create it in this phase, while the baseline is fresh.

**Done when:** `assembleDebug` succeeds, all 6 JVM test files pass, and
`schemas/` is committed.

---

# Phase 11 — Verify the four cross-language contracts

The highest-risk part of the system. Each fails **silently and fleet-wide** —
nothing crashes, everything just quietly stops working at every door at once.

| Contract | Kotlin | Backend | Failure if they diverge |
|---|---|---|---|
| Bundle content hash | `util/BundleIntegrity.kt` | `canonicalizeGuests` | Every bundle fails verification. No device can be armed. Presents as "preparation is broken". |
| Staff PIN hash | `data/security/PinVerifier.kt` | `hashPassword` | Every PIN rejected at the door. |
| Name normalisation | `util/NameNormalizer.kt` | `normalizeNameForSearch` | Staff at one door get different search results from staff at another. |
| QR ticket payload | `scan/TicketResolver.kt` | `signQrTicket` | Every scan resolves to "not found". |

Run both halves and compare the golden vectors literally:

```bash
cd backend && npm test -- --test-name-pattern="contract"
cd android && ./gradlew :app:testDebugUnitTest --tests "*BundleIntegrityTest*" \
    --tests "*PinVerifierTest*" --tests "*NameNormalizerTest*" --tests "*TicketResolverTest*"
```

**The PIN trap, recorded so nobody "fixes" it:** the server passes the salt to
`crypto.pbkdf2` as a hex **string**, so Node uses its 32 ASCII bytes as salt
material — *not* the 16 bytes it decodes to. A natural Kotlin port decodes the
hex first and rejects every PIN. The two derivations were verified to differ.
`PinVerifier.kt` reproduces the quirk on purpose.

**The ticket contract is about SHAPE, not signature.** Decision D-20 removed
on-device verification; the bundle is the allowlist. One test exists because an
RSVP invite link is signed with the *same secret* — only the `purpose` claim
separates a login link from a door pass.

**Neither side may change alone.** If a vector needs to move, move both in one
commit or the fleet desynchronises.

---

# Phase 12 — On real hardware

Emulators will not answer any of these.

### 12.1 Measure PBKDF2 (decision D-1)

600 000 SHA-512 iterations is ~0.2–0.5 s on a desktop and can be several times
that on a low-end tablet. Acceptable once per shift — but §18.5 wants staff
switching to be *fast*, because handover happens mid-rush.

Time `PinVerifier` on the tablet you actually bought. If it exceeds ~1.5 s the
fix is **a progress indicator, never fewer iterations**. Lowering the count
silently weakens every PIN on the platform, and the hash is shared with
`hashPassword`.

### 12.2 Camera and scanning

- Scan distance and angle under **venue lighting**, not office lighting.
- The 3-second value-keyed debounce in `QrAnalyzer` — does one ticket held in
  frame register once, and a second ticket immediately after register at once?
- Torch toggle.
- Confirm the **bundled** ML Kit model works with the device in airplane mode.
  If it needs a download, the wrong artifact is on the classpath.

**Camera hardening, 2026-08-23.** Six failure paths were closed and none of them
has run on a device. Each one is a deliberate test, not a glance:

- **Permission refused twice.** The fallback must switch from "Allow camera" to
  **"Open settings"**. Tapping "Allow camera" a third time used to do nothing at
  all — no dialog, no feedback — which is the specific bug this replaced.
- **Grant it in Settings and come back.** The scanner must pick the camera up on
  return. It previously stayed on the fallback screen with no way to notice.
- **Background the app with the torch ON, then return.** The lamp must come back
  on by itself, and the button must never claim "on" while the lamp is dark.
  Watch the button's colour on the way back, not just the lamp.
- **A tablet with no rear camera.** It must fall back to the front lens rather
  than showing a black screen. If you have no such device, verify the branch by
  temporarily reversing the order in `firstAvailableLens()`.
- **A device with no flash unit.** The torch control must be absent, not greyed,
  and SEARCH BY NAME takes the whole bar.
- **Camera held by another app.** Open the stock camera, then switch here. The
  fallback must say the camera did not start and offer **"Try camera again"** —
  and that button must actually recover the pipeline once the other app is gone.
- **Tap to focus.** Tap the preview with a phone screen held close: focus and
  exposure should settle on it, and release back to continuous focus after ~3 s.
  Confirm the tap does not steal touches from MENU or SEARCH BY NAME.

### 12.2b Setup flow, 2026-08-23

A new welcome screen and a rebuilt pairing screen. None of it has been compiled.

- **A fresh, unpaired tablet opens on Welcome**, not on the code form. One tap
  reaches pairing. A PAIRED tablet must still open straight on Prepare — if it
  shows the greeting, the `isPaired` branch in `CheckinNavHost` is wrong and
  staff will tap past it at every venue.
- **The crash report moved** from Pair to Welcome. Force a crash, relaunch an
  unpaired tablet, and confirm the report still takes the screen over. On a
  paired tablet the route is Menu → Last crash, unchanged.
- **The code cells accept typing.** This is the one to test first: the field is
  a transparent `BasicTextField` stretched over the drawn boxes, so if the
  overlay is mis-sized the boxes look perfect and nothing can be entered. Tap
  the boxes, expect the keyboard; type, expect characters to fill left to right.
- **Paste.** Copy a code into the clipboard, tap Paste. With an empty or junk
  clipboard it must say so rather than doing nothing. Note that Android 12+
  shows its own "pasted from clipboard" toast — that is the system, not the app.
- **The Pair button must not move** when an error appears. That is the whole
  point of the reserved slot.
- **Release this tablet** (Prepare → "Pair to a different account"):
  - With unsent check-ins it MUST refuse and name the count. Test this by going
    offline, checking someone in, then trying to release. Getting this wrong
    destroys check-ins that exist nowhere else.
  - With a clean queue it clears credentials AND the guest list, then returns to
    Welcome.
  - Release while signed in (close an event first, which lands on Prepare with a
    live session) and confirm the tablet does not later raise a PIN lock for a
    roster that no longer exists.
- **The compact ramp.** On the smallest tablet the step rail collapses to
  "Step 1 of 3" and "Who is on the door?" must now be VISIBLE — it used to be
  hidden at exactly that size.

### 12.2c The pairing guide, 2026-08-23

A four-step in-app walkthrough (`ui/howto/`), reached from Welcome and from the
"Where do I find this code?" link on the pairing screen.

**Read this before testing.** The instructions are quoted from the dashboard's
own source, and they are only correct until someone edits the dashboard. The
sources are named in the `strings.xml` comment above `howto_*`. Open the real
dashboard beside the tablet and check word for word:

- `/dashboard/checkin-setup` still says **Check-in setup**, still groups tabs
  under **Before the event**, and the tab is still called **Tablets**.
- The panel is still **Check-in devices**, the select is still **Gate**, and the
  gold button still says **Create pairing code**.
- A code is still 8 characters, still 10 minutes, still single use, still drawn
  from an alphabet with no O/0/I/1/L.

If any of those moved, step 2 or 3 is now confidently wrong, which is worse than
having no guide.

Then on the device:

- **Back returns to where you came from.** Open the guide from Welcome → back to
  Welcome. Open it from Pair with four characters typed → back to Pair **with
  those four characters still there**. It uses `popBackStack()` for exactly this.
- **The bottom bar says "Back to pairing", not "Back to scanner".** There is no
  scanner on an unpaired tablet.
- **Paging animates forward going forward and backward going back.** The motion
  helpers were widened from `AnimatedContentTransitionScope<NavBackStackEntry>`
  to a generic `<S>` so this screen could reuse them; check the NavHost's own
  screen transitions still animate correctly, since they now bind through the
  generic signature.

### 12.2d Review fixes, 2026-08-23

A self-review of §12.2b/c found ten issues; all are fixed. The ones that need
checking on a device:

- **Two-button rows line up.** `Paste code` / `Pair`, and `Previous` / `Next` on
  the guide. `SecondaryAction` does not `fillMaxWidth()` and `PrimaryAction`
  does, so weighted wrappers stretched one and left the other at text width.
  Both now take `weight()` directly.
- **The keyboard no longer covers the code boxes.** `imePadding()` was written
  inside `verticalScroll()`; focusing the field could scroll it *under* the
  keyboard. Tap the boxes on a real device and confirm they end up above it.
- **A camera that never starts now gives up after 8s** and shows the fallback
  with RETRY, instead of a permanent black rectangle. Hard to force
  deliberately; the observable part is the new **"Starting camera…"** label,
  which should appear briefly on a cold launch and vanish on the first frame.
- **Welcome scrolls on a short screen.** It used weighted spacers and clipped
  the step rail on a landscape phone. Check the rail is reachable at 390dp tall.
- **The welcome rail shows no active dot** ("3 steps"), so it is now
  distinguishable from the pairing screen's rail.

And one new automated guard: `PairingGuideCopyTest` fails the build if the
dashboard renames anything the guide names, or if the pairing code's alphabet or
10-minute expiry changes. It skips when `frontend/` is not checked out. **This is
the first test in this repo that reads across the app/web boundary** — if it
starts failing after a frontend change, the tablet's instructions are wrong, not
the dashboard.

### 12.2e The seating plan on the result screen, 2026-08-30

The scan result now carries the venue's floor plan under the table numeral, and
the same card opens a full-screen, pinch-zoomable plan. **None of it has been
compiled** — there is no JDK on the authoring machine — so every item here is a
first look, not a regression check.

The design was built and rendered in a browser first, from the same geometry
module the web maps use, at 1280×800, 800×1280 and 870×390. Those renders are
what the Compose has to reproduce; they are not proof that it does.

**Before anything else: the tablet must be RE-PREPARED.** Geometry arrives with
the bundle. A device armed before this shipped holds table names and no
coordinates, and will correctly show the numeral alone — which is
indistinguishable from the feature being broken. Re-prepare, then test.

- **An event with a seating chart.** The card appears under the numeral with the
  whole room on it, the guest's table filled gold. Check it against the
  organizer's own seating map side by side: same room, same orientation, nothing
  drawn on top of anything it should be behind.
- **`positionX`/`positionY` are the element's TOP-LEFT corner, not its centre.**
  If they were ever read as a centre the layout would not shift, it would
  SCRAMBLE — every element moving by half its own size, and sizes differ per
  shape. A plan that looks *slightly* wrong is much more likely to be this than
  anything else, so compare positions, not vibes.
- **An event with NO seating chart, and a guest with no table.** No card, no
  empty sheet of paper, no gap where one used to be. The screen must look exactly
  as it did before this shipped.
- **The numeral is still the largest thing on the screen.** That is the rule the
  plan was fitted around; if the card has pushed the number down or shrunk it,
  the pane arithmetic is wrong.
- **A phone in landscape** (390dp tall). The card should be a small silhouette
  with no numerals and no key — or, if it cannot clear 190×150dp, a **"Show the
  room"** button instead. Neither is a bug. A clipped card is.
- **The zone glyphs draw.** Fourteen marks transcribed by hand from the web
  icons; a mis-transcribed path shows as a scribble or as nothing, and only a
  screen will tell you. Check a stage, a dance floor and an entrance at minimum.
- **Zone names move out from under tables.** Put a table inside a dance floor in
  the organizer's map and re-prepare: the zone's name should shift to the foot or
  head of the zone, or vanish into the key — never render half-covered.
- **Tap the card.** It must open the full plan and NOT fall through to the
  result screen's dismiss-anywhere. This is the single most likely defect on the
  screen: the card suppresses its indication, and an accidentally *disabled*
  clickable does not consume a tap, it opts out of input.
- **The already-arrived screen times out after six seconds.** Open the plan from
  it, hold for ten seconds, and confirm the screen is still there — the timeout
  is suspended while the plan is open and restarts when it closes.
- **Pinch and pan the full plan**, then let go at the far corner. It must not be
  possible to fling the sheet off the screen; the pan is clamped to the overflow.
  At 1x there is nothing to pan and the gesture should do nothing at all.
- **"Whole room"** appears only once the plan has been moved, and returns it.
- **A rotated element.** Set a table or zone to 15° in the organizer's map. The
  shape rotates; its NUMERAL and its NAME must stay upright.
- **An Arabic table name.** "طاولة ٧" must draw as ٧ and in the Arabic
  face, not as a box. `displayFamilyFor` picks the face from the string, and this
  is the first place it is asked for a single digit.
- **Font scale.** Raise the system font size to its maximum. Every other piece of
  type in the app grows; the numerals INSIDE the drawn tables must not, or they
  burst out of the circles they are centred in.
- **A forty-table venue, on the oldest tablet you have.** The plan is one Canvas,
  not forty composables, so it should pinch smoothly — but the chair pips and the
  ruled floor are drawn per frame and this is the only thing here with a
  performance question attached.

### 12.3 Session, lock, security

- `FLAG_SECURE`: screenshots blocked, and the app hidden in the recent-apps
  switcher.
- `KEEP_SCREEN_ON`: the screen never sleeps with a queue at the door.
- Lock after inactivity, and after >5 minutes backgrounded.
- **"Switch staff" reaches the login screen.** This was broken until
  2026-07-31 — sign-out cleared the session but never navigated, stranding the
  tablet on the scanner with no operator. The fix is read off source and has
  never run. Test it deliberately.
- Unlock returns to the scanner **without rebuilding the camera** (the overlay
  is drawn over the nav host precisely so it doesn't).

### 12.4 Battery and storage

20% banner, 10% blocking modal (§21.9). Pre-travel storage guard.

---

# Phase 13 — Two-device rehearsal

The scenarios that only fail with more than one tablet. Run these before any
real event.

| # | Scenario | Must happen |
|---|---|---|
| 1 | Same guest scanned at gate A, then gate B, **both online** | B shows "already checked in" within seconds (§9.2). Layer 2. |
| 2 | Same guest at A and B, **both offline**, then both reconnect | Exactly one live check-in. The other becomes a **conflict**, surfaced on the dashboard — not silently dropped. Layers 3 + 4. |
| 3 | Airplane mode, 50 scans, force-stop the app, reopen, reconnect | All 50 arrive. WorkManager survives process death. |
| 4 | Supervisor undo on a device | Server accepts. Other device reflects it. Report names **who** reversed it and why. |
| 5 | **Usher** attempts an undo | Refused with `SUPERVISOR_REQUIRED`. Nothing is reversed. |
| 6 | Undo with a forged `staffId` from another event | Refused with `UNKNOWN_STAFF`. |
| 7 | Batch claiming `staff_display_name` of someone else | Stored name comes from the **roster**, not the payload. |
| 8 | Kill switch armed mid-event | Devices stop syncing, keep admitting guests locally. The door is never blocked. |
| 9 | Revoke a device | Local wipe on next contact (§20.5). |
| 10 | Close event with unsent work | Purge is **blocked**. |

Scenarios 5–7 are the 2026-07-31 authorization fixes. They have unit tests but
have never run against a real device token — and they are the difference between
an audit trail and a suggestion.

---

# Phase 14 — Deploy

### 14.1 Order

1. **Migrations first.** The backend reads columns that do not exist yet.
2. Backend.
3. Frontend.

### 14.2 The frontend trap

`next start` serves a **prebuilt** `.next/`. `git pull` + `pm2 restart` does
**not** update the frontend — it restarts a server that re-serves the old build.

```bash
cd frontend && npm ci && npm run build && pm2 restart <frontend-app>
```

Check `ecosystem.config.js` for the actual process names.

### 14.3 Environment

The live server's `.env` **overrides code defaults**. A value corrected in the
repo does not take effect until the server's own env is corrected too — this has
bitten before with email addresses. Confirm `QR_JWT_SECRET` is present and
identical to whatever signed any tickets already in circulation; rotating it
invalidates every issued QR code.

### 14.4 Verify after deploy

- [ ] `GET /api/v1/checkin/events/:id/bundle` returns a `tables` array whose rows
      carry `positionX`, `positionY`, `shape` and `elementType`, and that
      **includes zones** (stage, dance floor, entrance) alongside seatable
      tables. If they are absent the tablet draws no plan and shows the numeral
      alone — which looks exactly like the feature never shipped.
- [ ] `integrity.contentHash` for an event is UNCHANGED by the above. The hash
      covers the guest set only; if widening the layout moved it, every device
      already armed for that event would fail verification and refuse to arm.
- [ ] Room schema `app/schemas/…/4.json` is committed after the first build that
      produces it (§21.2 — a migration test needs the shipped shape, and that
      hole cannot be filled once a tablet in the field holds version 4 data).
- [ ] All 35 check-in routes register (`/api/v1/checkin/*`, `/api/v1/admin/checkin/*`).
- [ ] `checkin-setup` renders for an organizer; the admin device registry for a super admin.
- [ ] `CheckinLive` on a **free-tier** event shows the upgrade prompt, not a raw error, and stops polling. (Fixed 2026-07-31, never rendered.)
- [ ] Creating two entrances with the same name returns **409**, not 500. (Also fixed 2026-07-31, never run.)

---

# Phase 15 — Pilot

One real event. Small. Two devices and a paper fallback list.

Do not pilot on a wedding you cannot afford to disrupt. Watch conflicts and
unresolved-conflict counts on the dashboard throughout, and pull the XLSX report
afterwards — the anomalies sheet is the honest record of what the night actually
did.

---

# Outstanding — decisions, not code

### R-2 · Realtime channel authorisation — unsolved

Supabase channels have no authorisation model here. Subscribing with the anon
key would let any holder read any event's guest data. **Polling ships instead**
and satisfies every §9.2 criterion, so this blocks nothing — but §17 stays
unbuilt until there is an answer. Do not "just enable realtime".

### PDF post-event report

Needs a new dependency. Undecided. XLSX works today.

### Localisation (§9.9)

`strings.xml` is English only. Arabic and French were **explicitly descoped** by
the owner, as was the VIP audio cue (§9.4). RTL layout has never been exercised.
Most of this product's market reads Arabic — worth revisiting, but it is a
product call, not a defect.

### Release signing

`app/build.gradle.kts` has **no signing config**. `assembleRelease` will not
produce an installable artifact. Needed before any distribution, along with a
decision on how the tablets are provisioned — sideload, internal Play track, or
managed device. `isMinifyEnabled = true` on release means ProGuard rules matter;
verify Room, Retrofit and kotlinx-serialization survive shrinking.

### Per-event logo (§9.8)

No such column exists on the platform (A-5 / D-19). Branding is colour-only.

---

## Gate summary

Do not start a phase before its predecessor is genuinely done.

| Phase | Done when |
|---|---|
| 8 · Toolchain | `assembleDebug` succeeds and the 6 JVM test files pass |
| 9 · Migrations + integration | 65 integration tests pass, **none skipped** |
| 10 · Compile | `assembleDebug` succeeds, 6 test files pass, `schemas/` committed |
| 11 · Contracts | All four verified on both sides |
| 12 · Hardware | PBKDF2 measured, camera + session verified on the real tablet |
| 13 · Two devices | All 10 scenarios pass, especially 5–7 |
| 14 · Deploy | Post-deploy checklist clean |
| 15 · Pilot | One real event, reviewed afterwards |
