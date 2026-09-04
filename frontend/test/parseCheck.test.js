import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   EVERY SOURCE FILE PARSES.

   This exists because a syntax error reached a deploy while the suite around
   it reported 612 passing tests. Nothing imports most route files — including
   the one that broke — so the suite was never going to see it.

   The second test is the one that matters more over time: it proves the
   checker can still FAIL. A parse check that silently stopped checking would
   report "ok" forever and read exactly like a healthy one, which is how this
   repo's earlier responsive greps went bad.
   ═══════════════════════════════════════════════════════════════════════════ */

const SCRIPT = path.join(process.cwd(), 'scripts', 'parseCheck.js');

describe('parse check', () => {
  it('every file under src/ parses', () => {
    let out;
    try {
      out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    } catch (err) {
      // The script prints the offending file and line on stderr; surface it
      // rather than a bare non-zero exit, or the failure names nothing.
      throw new Error(`${err.stdout || ''}${err.stderr || ''}`);
    }
    expect(out).toMatch(/^ok — \d+ files parse/);
    /* 120s, and the number is about the MACHINE, not the checker.
       `node scripts/parseCheck.js` on its own finishes in a few seconds. What
       is being waited on is a synchronous child process starting under a
       vitest worker while thirty-odd other test files run in parallel — at 15s
       it failed, at 45s it still failed intermittently, and the standalone run
       in the very same command printed "ok" before the suite had finished
       starting up.
       Worth being loud about: a timeout here reports as "the source does not
       parse", which is the single most alarming and most misleading failure
       this suite can produce. Better to wait than to cry wolf. */
  }, 120000);

  it('still fails on a file that does not parse', () => {
    /* The real bug, reproduced: an import inserted inside another import.

       Written into a TEMP directory, not into src/.

       It used to go into the live tree, because the checker only ever walked
       src/. That raced: cinematicTemplates, guestPreview and inlineStyleTraps
       each walk the whole of src/ and read every file in it, in sibling vitest
       workers, and any of them landing between this file's creation and its
       deletion in the finally below crashed with ENOENT. The suite went red on
       a green codebase on an unpredictable schedule — the exact failure mode
       the header of cinematicTemplates' own walk test argues against.

       parseCheck.js now takes the directory to check as an argument, so the
       decoy touches nothing anybody else reads. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parsecheck-'));
    const decoy = path.join(dir, '__parsecheck_decoy__.js');
    fs.writeFileSync(decoy, [
      "import {",
      "import { formatInZone } from './utils/timezone';",
      "  WORLD_W,",
      "} from './utils/seatingGeometry';",
      '',
    ].join('\n'), 'utf8');

    let failed = false;
    let output = '';
    try {
      execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    } catch (err) {
      failed = true;
      output = `${err.stdout || ''}${err.stderr || ''}`;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    expect(failed, 'the checker passed a file that cannot parse').toBe(true);
    expect(output).toMatch(/__parsecheck_decoy__/);
    // One file in a temp directory now, so this no longer needs the full-walk
    // budget — but it keeps it, because the cost of being wrong is a red suite
    // on a green tree and the cost of waiting is nothing.
  }, 120000);
});
