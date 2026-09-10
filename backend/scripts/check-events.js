require('dotenv').config();
const { supabase } = require('../config/supabase');

/*
 * Runs only when invoked directly.
 *
 * Without this guard the script executes — and calls process.exit() — the
 * moment anything REQUIRES the file. That is not hypothetical: any tool that
 * walks and imports the tree (a coverage run, a dependency graph, a
 * module-load smoke check) terminates on the first one of these it touches,
 * with no error and no indication which file did it. Nothing in the
 * application requires these, so the cost was borne entirely by tooling.
 */
if (require.main === module) {
  (async () => {
    const orgId = '40bcbfc9-10d2-49c3-8993-c50f9d85540e';
    const { data: events, error } = await supabase.from('events').select('*').eq('org_id', orgId);
    console.log(`--- events for org ${orgId} ---`);
    if (error) console.error(error);
    else console.log(events);
  
    process.exit(0);
  })();
}
