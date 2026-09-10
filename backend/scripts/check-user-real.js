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
    const userId = 'cd291e74-f71d-4006-9a77-64db1f82370f';
    console.log(`Checking user ID: ${userId}\n`);

    // 1. Check organizations
    const { data: orgs, error: orgErr } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_user_id', userId);
  
    console.log('--- public.organizations ---');
    if (orgErr) console.error(orgErr);
    else console.log(orgs);

    // 2. Check admin_users
    const { data: adminUsers, error: adminErr } = await supabase
      .from('admin_users')
      .select('*')
      .eq('user_id', userId);
  
    console.log('\n--- public.admin_users ---');
    if (adminErr) console.error(adminErr);
    else console.log(adminUsers);

    if (adminUsers && adminUsers.length > 0) {
      const adminUserId = adminUsers[0].id;
      // 3. Check admin_user_roles
      const { data: adminRoles, error: adminRolesErr } = await supabase
        .from('admin_user_roles')
        .select('*, roles(*)')
        .eq('admin_user_id', adminUserId);
    
      console.log('\n--- public.admin_user_roles ---');
      if (adminRolesErr) console.error(adminRolesErr);
      else console.log(JSON.stringify(adminRoles, null, 2));
    }

    // 4. Check user_roles
    const { data: userRoles, error: userRolesErr } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', userId);
  
    console.log('\n--- public.user_roles ---');
    if (userRolesErr) console.error(userRolesErr);
    else console.log(userRoles);

    process.exit(0);
  })();
}
