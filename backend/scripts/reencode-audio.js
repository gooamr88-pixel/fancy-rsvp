#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RE-ENCODE THE BACKGROUND MUSIC
 *
 * ── WHY AUDIO IS THE TARGET AND NOT THE PHOTOS ──
 *
 * Measured on 2026-09-10, `event-assets` held 449 MB across 283 files. The
 * intuition was that the photographs were the problem. The per-visit numbers say
 * otherwise:
 *
 *     music        19 files    83 MB   avg 4,461 kB   max 6,456 kB
 *     gallery      70 files   100 MB   avg 1,469 kB   max 7,994 kB
 *     covers       24 files    38 MB   avg 1,610 kB   max 6,708 kB
 *
 * ONE music file outweighs three gallery photos, and unlike a photo it is not
 * lazy-loaded, not responsive, and not optional: EventPageClient renders
 * `<audio src={event.background_music_url} loop autoPlay />`, so the browser
 * pulls the whole file the moment the invitation opens, for every guest, whether
 * or not they ever hear it.
 *
 * And no image transform can touch it. `utils/assetUrl.js` shrank the pictures
 * by rewriting URLs with no re-upload at all; audio has no equivalent. The bytes
 * have to actually change.
 *
 * ── WHAT THIS SCRIPT DOES, AND WHAT IT REFUSES TO DO ──
 *
 * It DOWNLOADS from the public bucket, re-encodes locally with ffmpeg, and
 * writes a before/after report. It does NOT upload, delete, or modify anything
 * remote. Nothing in this file can damage production.
 *
 * That is deliberate. Background music is a creative choice an organizer made
 * for their wedding, and 96 kbps is where a decision about someone else's event
 * becomes audible — thin strings, cymbals turning to fizz. So the loop is:
 * encode, LISTEN, then decide. Uploading is a separate, explicit step.
 *
 *     node backend/scripts/reencode-audio.js --list music-files.json
 *     node backend/scripts/reencode-audio.js --list music-files.json --bitrate 128k
 *
 * `--list` is a JSON array of { name, bytes } exactly as the storage query
 * returns it. The project ref comes from SUPABASE_URL in backend/.env, or --ref.
 *
 * ── THE ENCODE, AND WHY THESE SETTINGS ──
 *
 * • libmp3lame at a constant bitrate, not VBR. Every browser plays CBR mp3
 *   seekably; some struggle to seek VBR without a Xing header, and this audio
 *   LOOPS, so seeking to zero happens constantly.
 * • 44.1 kHz. Background music at 48 kHz buys nothing over a phone speaker and
 *   costs ~9% more bytes.
 * • Stereo kept by default. Mono would halve it again, but a wedding song
 *   collapsed to mono is a different recording, and that is not a call a script
 *   should make silently. `--mono` is there if you listen and disagree.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
/** Alias kept because the encode call below reads better as `run(...)`. */
const run = execFileSync;

const ROOT = path.join(__dirname, '..', '..');
const WORK = path.join(ROOT, '.audio-work');
const IN_DIR = path.join(WORK, 'original');
const OUT_DIR = path.join(WORK, 'reencoded');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (flag) => process.argv.includes(flag);

/** Project ref from backend/.env, so the common case needs no flags. */
function projectRef() {
  const explicit = arg('--ref');
  if (explicit) return explicit;
  try {
    const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
    const m = /SUPABASE_URL\s*=\s*https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(env);
    if (m) return m[1];
  } catch { /* fall through to the explicit error below */ }
  return null;
}

const fmt = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`);

/**
 * Source bitrate in bits/sec, or null when it cannot be determined.
 *
 * Null is returned rather than a guess, and the caller treats null as "encode
 * it and let guard 2 decide" — an unknown bitrate must not silently skip a
 * 320 kbps file, and must not silently inflate a 18 kbps one either.
 */
function probeBitrate(file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=bit_rate',
      '-of', 'default=nw=1:nk=1',
      file,
    ], { encoding: 'utf8' }).trim();
    const n = Number.parseInt(out, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function main() {
  // ffmpeg first: a missing binary should say so in one line, not after
  // downloading 83 MB.
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    console.error('ffmpeg is not on PATH. Install it (winget install Gyan.FFmpeg) and reopen the terminal.');
    process.exit(1);
  }

  const ref = projectRef();
  if (!ref) {
    console.error('Could not determine the Supabase project ref. Pass --ref <projectref>.');
    process.exit(1);
  }

  const listPath = arg('--list');
  if (!listPath || !fs.existsSync(listPath)) {
    console.error('Pass --list <file.json> containing [{ "name": "music/x.mp3", "bytes": 123 }, …]');
    console.error('Get it from the SQL editor:');
    console.error("  SELECT name, (metadata->>'size')::bigint AS bytes FROM storage.objects");
    console.error("  WHERE bucket_id='event-assets' AND name LIKE 'music/%';");
    process.exit(1);
  }

  const bitrate = arg('--bitrate', '128k');
  /**
   * Sources at or below this are left alone. Default 160 kbps: comfortably above
   * the 128 kbps target so the saving is real, and comfortably above the
   * 124-130 kbps group in this bucket, which is not worth degrading for 25%.
   */
  const minBitrate = Number.parseInt(arg('--min-source-kbps', '160'), 10) * 1000;
  const mono = has('--mono');
  const files = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  const skipped = [];

  fs.mkdirSync(IN_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\nRe-encoding ${files.length} file(s) at ${bitrate}${mono ? ' mono' : ' stereo'}`);
  console.log(`Sources at or below ${minBitrate / 1000} kbps are left untouched.`);
  console.log(`Working directory: ${WORK}`);
  console.log('Nothing is uploaded. Listen to the results before deciding.\n');

  const rows = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const f of files) {
    const base = path.basename(f.name);
    const src = path.join(IN_DIR, base);
    // Always .mp3 out, whatever went in — the bucket holds audio/ogg too, and
    // mp3 is the one format every browser on every phone plays.
    const dst = path.join(OUT_DIR, base.replace(/\.[^.]+$/, '') + '.mp3');

    try {
      if (!fs.existsSync(src)) {
        const url = `https://${ref}.supabase.co/storage/v1/object/public/event-assets/${f.name
          .split('/').map(encodeURIComponent).join('/')}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download ${res.status}`);
        fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
      }

      const before = fs.statSync(src).size;

      /**
       * ── GUARD 1: DO NOT RE-ENCODE WHAT IS ALREADY SMALL ──
       *
       * The first run of this script transcoded everything to 96k and the
       * results made the mistake obvious. ffprobe on the sources:
       *
       *     5 files @ 320 kbps    6.1-6.6 MB   -> big, real win
       *     5 files @ 262 kbps    6.5 MB       -> big, real win
       *     2 files @ 188 kbps    5.0 MB       -> worthwhile
       *     6 files @ 124-130 kbps 1.0-3.5 MB  -> only -25%, for an AUDIBLE loss
       *     1 file  @  18 kbps      50 kB      -> see guard 2
       *
       * Going 128 -> 96 saves a quarter of a small file and spends real quality
       * to do it. These are wedding songs somebody chose; the trade is bad. Only
       * sources comfortably above the target get touched.
       */
      const srcBitrate = probeBitrate(src);
      if (srcBitrate && srcBitrate <= minBitrate) {
        totalBefore += before;
        totalAfter += before;
        skipped.push({ name: f.name, why: `already ${Math.round(srcBitrate / 1000)} kbps`, bytes: before });
        console.log(`  ${base.padEnd(46).slice(0, 46)} ${fmt(before).padStart(8)}     SKIPPED  already ${Math.round(srcBitrate / 1000)} kbps`);
        continue;
      }

      run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', src,
        '-vn',                                   // drop cover art: it is an image riding inside an audio file
        '-map_metadata', '-1',                   // and drop the tags it came with
        '-codec:a', 'libmp3lame',
        '-b:a', bitrate,
        '-ar', '44100',
        ...(mono ? ['-ac', '1'] : []),
        dst,
      ], { stdio: 'pipe' });

      const after = fs.statSync(dst).size;

      /**
       * ── GUARD 2: A "COMPRESSION" STEP MUST NEVER MAKE A FILE BIGGER ──
       *
       * `wizard-1782740783680.ogg` is a 22-second Vorbis clip at 18 kbps — 50 kB.
       * Re-encoding it to 96 kbps CBR mp3 produced 253 kB: FIVE TIMES the
       * original, from a script whose entire purpose is to shrink things.
       *
       * Guard 1 now catches that case by bitrate, but this stays as the backstop,
       * because the bitrate probe can fail (an exotic container, a corrupt
       * header) and silently returning null would let the same inflation
       * through. Two independent checks, because the failure is silent: nobody
       * inspects every row of a table headed "-58%".
       */
      if (after >= before) {
        fs.unlinkSync(dst);
        totalBefore += before;
        totalAfter += before;
        skipped.push({ name: f.name, why: `re-encode was larger (${fmt(after)} vs ${fmt(before)})`, bytes: before });
        console.log(`  ${base.padEnd(46).slice(0, 46)} ${fmt(before).padStart(8)}     SKIPPED  encode grew it to ${fmt(after)}`);
        continue;
      }

      totalBefore += before;
      totalAfter += after;
      rows.push({ name: f.name, before, after, cut: 1 - after / before, out: dst });
      console.log(`  ${base.padEnd(46).slice(0, 46)} ${fmt(before).padStart(8)} -> ${fmt(after).padStart(8)}  -${Math.round((1 - after / before) * 100)}%`);
    } catch (err) {
      console.log(`  ${base.padEnd(46).slice(0, 46)} FAILED: ${err.message}`);
    }
  }

  if (totalBefore === 0) {
    console.log('\nNothing was processed.');
    return;
  }

  console.log(`\n  ${'TOTAL'.padEnd(46)} ${fmt(totalBefore).padStart(8)} -> ${fmt(totalAfter).padStart(8)}  -${Math.round((1 - totalAfter / totalBefore) * 100)}%`);
  console.log(`  ${rows.length} re-encoded, ${skipped.length} left as they were.`);

  if (skipped.length) {
    console.log('\nSkipped (kept the original — do NOT upload anything for these):');
    for (const s of skipped) console.log(`  ${path.basename(s.name).padEnd(46).slice(0, 46)} ${s.why}`);
  }

  console.log(`\nOriginals : ${IN_DIR}`);
  console.log(`Re-encoded: ${OUT_DIR}`);
  console.log('\nLISTEN to a few of the re-encoded files against their originals.');
  console.log('If they sound right, upload the contents of the re-encoded folder over');
  console.log('the music/ prefix (Storage UI drag-and-drop is fine for this many files).');
  console.log(`Current target is ${bitrate}. If anything sounds thin, re-run higher`);
  console.log('(--bitrate 160k); if you want more saving and can live with it, --bitrate 96k.\n');

  fs.writeFileSync(
    path.join(WORK, 'report.json'),
    JSON.stringify({ bitrate, mono, totalBefore, totalAfter, rows }, null, 2),
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
