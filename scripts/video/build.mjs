/* ═══════════════════════════════════════════════════════════════════════════
   ENCODE.  webm (Playwright) -> mp4 (H.264), and join chapters into a master.

   Usage:
     node scripts/video/build.mjs pilot                 # one chapter
     node scripts/video/build.mjs --master ch01 ch02 …  # join, in this order

   ffmpeg 8.1.1 is on PATH here via WinGet, with libx264, xfade and concat.

   WHY RE-ENCODE AT ALL

   Playwright writes VP8/VP9 in a WebM container. That is fine to watch and
   awkward to hand to anyone: PowerPoint, Keynote, WhatsApp and most Windows
   players either refuse it or fall back to software decoding. H.264 in MP4 at
   yuv420p is the format that plays everywhere without asking, which is the
   whole point of a video somebody is meant to be able to send on.

   The two flags that are not cosmetic:
     -pix_fmt yuv420p   without it, players that expect 4:2:0 show nothing
     scale to even dims  libx264 refuses odd width or height outright
   ═══════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE   = path.dirname(fileURLToPath(import.meta.url));
const REPO   = path.resolve(HERE, '..', '..');
const RAW    = path.join(REPO, '.visual', 'video', 'raw');
const OUT    = path.join(REPO, '.visual', 'video', 'out');

const ff = (args) => {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      encoding: 'utf8', maxBuffer: 1 << 26,
    });
  } catch (e) {
    throw new Error('ffmpeg failed:\n' + (e.stderr || e.message));
  }
};

function probe(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=0', file,
  ], { encoding: 'utf8' });
  const get = (k) => (out.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1];
  return {
    width: +get('width'), height: +get('height'),
    duration: parseFloat(get('duration')) || 0,
  };
}

function encodeChapter(name) {
  const src = path.join(RAW, `${name}.webm`);
  if (!fs.existsSync(src)) throw new Error(`No recording at ${src}. Run e2e/video/record.js ${name} first.`);
  fs.mkdirSync(OUT, { recursive: true });
  const dst = path.join(OUT, `${name}.mp4`);

  /* record.js measures how long the browser spent on about:blank and first
     paint before the first step, and leaves it here. Trimming by the measured
     number rather than a guessed one is what keeps the opening title card
     landing on frame one. */
  const sidecar = path.join(RAW, `${name}.json`);
  const trim = fs.existsSync(sidecar)
    ? (JSON.parse(fs.readFileSync(sidecar, 'utf8')).trimStart || 0)
    : 0;

  ff([
    ...(trim > 0 ? ['-ss', String(trim)] : []),
    '-i', src,
    // Playwright's WebM can arrive a pixel off; force even dimensions rather
    // than letting libx264 refuse the file after a minute of encoding.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',                                   // silent by design, no empty track
    dst,
  ]);

  const a = probe(src), b = probe(dst);
  const expected = a.duration - trim;
  console.log(`[build] ${name}: ${a.width}x${a.height} ${a.duration.toFixed(1)}s webm`
    + (trim ? ` (−${trim.toFixed(1)}s startup)` : '')
    + `  ->  ${b.width}x${b.height} ${b.duration.toFixed(1)}s mp4`
    + `  (${(fs.statSync(dst).size / 1048576).toFixed(1)} MB)`);

  // Anything beyond a rounding difference means frames were dropped, and a
  // silently shortened chapter is worse than a failed build.
  if (b.duration < expected - 1.5) {
    throw new Error(`Encode lost ${(expected - b.duration).toFixed(1)}s — refusing to call this done.`);
  }
  return dst;
}

function buildMaster(names) {
  const files = names.map((n) => path.join(OUT, `${n}.mp4`));
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`Missing chapter: ${f}`);

  const list = path.join(OUT, 'master.txt');
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');

  const dst = path.join(OUT, 'fancy-full-walkthrough.mp4');
  // Stream copy: every chapter was encoded with identical settings above, so
  // concat needs no second generation of loss.
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', dst]);

  const p = probe(dst);
  const mins = Math.floor(p.duration / 60), secs = Math.round(p.duration % 60);
  console.log(`[build] master: ${names.length} chapters, ${mins}m ${secs}s -> ${dst}`);

  // A timecode index, so the written guide can point at a moment.
  let at = 0;
  const index = names.map((n) => {
    const d = probe(path.join(OUT, `${n}.mp4`)).duration;
    const m = Math.floor(at / 60), s = Math.round(at % 60);
    at += d;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}  ${n}`;
  }).join('\n');
  fs.writeFileSync(path.join(OUT, 'timecodes.txt'), index + '\n', 'utf8');
  console.log('\n' + index);
  return dst;
}

const args = process.argv.slice(2);
if (!args.length) { console.error('usage: build.mjs <chapter> | --master <chapter…>'); process.exit(1); }

if (args[0] === '--master') buildMaster(args.slice(1));
else for (const n of args) encodeChapter(n);
