require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * CROSS-LANGUAGE CONTRACT TEST — the in-app update manifest.
 *
 * Two files, in two languages, that must describe the same JSON:
 *
 *   • android/app/build.gradle.kts                 → writeReleaseManifest
 *       WRITES fancy-checkin.json at release time.
 *   • android/.../data/remote/UpdateManifest.kt    → UpdateManifestDto
 *       READS it on every tablet in the field.
 *
 * ── Why this is tested from Node ──
 *
 * Both sides are Kotlin, so this looks like it belongs in the Android suite. It
 * cannot go there: a Gradle build script is not on the unit tests' classpath and
 * cannot be reflected over, and the Android tests only ever run on the build VPS
 * — after the artefact has already been produced. This runs in `npm test`, on
 * any machine, before anything is published.
 *
 * ── Why it matters more than it looks ──
 *
 * A key renamed on one side and not the other does not fail a build, does not
 * fail an install, and does not throw on a tablet: `ignoreUnknownKeys` and the
 * DTO's defaults make a mismatched field read as absent. The manifest parses,
 * `versionCode` comes back 0, every tablet decides it is up to date, and the
 * fleet silently stops updating. There is no error anywhere — which is exactly
 * the failure this feature was built to end.
 */

const ROOT = path.join(__dirname, '..', '..');
const GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const DTO = path.join(
  ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'fancyrsvp', 'checkin',
  'data', 'remote', 'UpdateManifest.kt',
);

/** Every key the Gradle task appends into the JSON it writes. */
function keysWritten(gradleSource) {
  const task = gradleSource.slice(gradleSource.indexOf('val writeReleaseManifest'));
  assert.ok(task.length > 0, 'writeReleaseManifest is gone from build.gradle.kts');
  // append("  \"versionCode\": ")  →  versionCode
  return new Set([...task.matchAll(/append\("\s*\\"([A-Za-z0-9_]+)\\"/g)].map((m) => m[1]));
}

/** Every key the Kotlin DTO declares via @SerialName. */
function keysRead(dtoSource) {
  return new Set([...dtoSource.matchAll(/@SerialName\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]));
}

test('the manifest writer and reader name exactly the same fields', () => {
  const written = keysWritten(fs.readFileSync(GRADLE, 'utf8'));
  const read = keysRead(fs.readFileSync(DTO, 'utf8'));

  assert.ok(written.size >= 7, `expected the writer to emit the full record, saw ${written.size}`);

  const missingFromDto = [...written].filter((k) => !read.has(k));
  const missingFromWriter = [...read].filter((k) => !written.has(k));

  assert.deepEqual(missingFromDto, [],
    'the release writes fields no tablet reads — harmless, but it means the two drifted');
  assert.deepEqual(missingFromWriter, [],
    'a tablet reads fields no release writes — these silently default, and versionCode '
    + 'defaulting to 0 makes every device believe it is up to date');
});

test('the fields the update decision depends on are all present', () => {
  const written = keysWritten(fs.readFileSync(GRADLE, 'utf8'));

  // Each of these is load-bearing in UpdateGate.evaluate or UpdateRepository:
  //   versionCode → is there anything newer at all
  //   url         → where to get it, and it must be https
  //   sha256      → verified before the installer is invoked
  //   sizeBytes   → bounds the download and sizes the free-space check
  for (const key of ['versionCode', 'versionName', 'sha256', 'sizeBytes', 'url', 'minSdk', 'notes']) {
    assert.ok(written.has(key), `the release manifest must carry "${key}"`);
  }
});

test('the published URL is https, in the writer itself', () => {
  const gradle = fs.readFileSync(GRADLE, 'utf8');
  const task = gradle.slice(gradle.indexOf('val writeReleaseManifest'));

  // UpdateGate refuses a non-https url, so shipping one would publish a release
  // every tablet silently declines — a fleet-wide no-op with no error anywhere.
  // Asserted at the source rather than trusting the constant to stay correct.
  assert.match(task, /https:\/\/fancyrsvp\.com\/download\/fancy-checkin\.apk/,
    'the manifest must publish an https APK url');
  assert.doesNotMatch(task, /"http:\/\//, 'cleartext is refused by the tablet and by the network config');
});

test('the manifest url the app fetches sits beside the APK it describes', () => {
  const repo = fs.readFileSync(
    path.join(
      ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'fancyrsvp', 'checkin',
      'data', 'repo', 'UpdateRepository.kt',
    ),
    'utf8',
  );

  // deploy-android.bat publishes both files into /var/www/apk together. If the
  // app looked somewhere else, a correct release would still never be found.
  assert.match(repo, /https:\/\/fancyrsvp\.com\/download\/fancy-checkin\.json/,
    'the app must read the manifest from the same directory the deploy publishes it to');
});

/*
 * The two assertions below read Kotlin source rather than run it, which is the
 * pattern this repo already uses for route wiring (organizerPricingLeak.test.js)
 * and for the same reason: the real check needs hardware nobody has here, and
 * both defects they pin were introduced, shipped past every other check, and
 * found only by reading. Neither is visible to a compiler, a linter, or a unit
 * test — they are two callbacks wired to the wrong function.
 */

test('Stop during a download cancels it and is not wired to Later', () => {
  const activity = fs.readFileSync(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'fancyrsvp', 'checkin', 'MainActivity.kt'),
    'utf8',
  );

  /*
   * Wiring onStop to dismiss was wrong three times over: it recorded a
   * dismissal, so a build the operator still wanted went quiet until the next
   * release; it did not cancel the coroutine, so a 46 MB transfer carried on
   * over the venue's wifi; and when that transfer finished it overwrote the
   * dismissed state, reopening the overlay with an install prompt for something
   * they had just cancelled.
   */
  assert.match(activity, /onStop\s*=\s*viewModel::cancelDownload/,
    'Stop must cancel the transfer, not record a dismissal');
  assert.doesNotMatch(activity, /onStop\s*=\s*viewModel::dismiss/,
    'Stop and Later are different acts and must not share a callback');
});

test('the install permission is rechecked on resume, not on navigation', () => {
  const activity = fs.readFileSync(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'fancyrsvp', 'checkin', 'MainActivity.kt'),
    'utf8',
  );
  const gate = activity.slice(activity.indexOf('private fun UpdateGate'));

  /*
   * Granting "install unknown apps" happens in the Android Settings app, so the
   * only signal that the operator returned is this activity resuming. Keying the
   * recheck on the nav back-stack entry sounds equivalent and is not: leaving
   * for Settings and coming back does not change the back stack at all, so the
   * effect never re-ran and the operator was stranded on "Open settings" after
   * having already granted it — the feature dead at its last step.
   */
  assert.match(gate, /Lifecycle\.Event\.ON_RESUME.*recheckPermission/s,
    'the permission recheck must be driven by ON_RESUME');
  assert.doesNotMatch(gate, /LaunchedEffect\(currentEntry\)\s*\{\s*viewModel\.recheckPermission/,
    'navigation is not the signal that someone came back from Settings');
});

test('the deploy publishes the manifest and rolls it back with the APK', () => {
  const deploy = fs.readFileSync(path.join(ROOT, 'deploy-android.bat'), 'utf8');

  assert.match(deploy, /fancy-checkin\.json/,
    'the publish step must copy the manifest, or no tablet can discover the build');
  assert.match(deploy, /refusing to publish an APK no tablet can discover/,
    'publishing an APK with no manifest must fail loudly rather than ship a build nobody finds');
  // A rollback that restores the APK alone leaves the manifest advertising a
  // versionCode that is no longer downloadable, and every tablet in the field
  // offers an update that installs the build it already has.
  assert.match(deploy, /fancy-checkin\.previous\.json \/var\/www\/apk\/fancy-checkin\.json/,
    'the printed rollback must move the manifest back too');
});
