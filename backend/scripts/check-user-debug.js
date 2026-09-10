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
    const email = 'gooamr88@gmail.com';
    console.log(`Checking user: ${email}\n`);

    // 1. Check auth.users
    const { data: authUser, error: authErr } = await supabase.auth.admin.listUsers();
    if (authErr) {
      console.error('Error fetching auth users:', authErr);
    } else {
      const user = authUser.users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        console.log('User NOT found in auth.users');
      } else {
        console.log('--- auth.users ---');
        console.log(`ID: ${user.id}`);
        console.log(`Email: ${user.email}`);
        console.log(`Role: ${user.role}`);
        console.log(`App Metadata:`, user.app_metadata);
        console.log(`User Metadata:`, user.user_metadata);
        console.log(`Created At: ${user.created_at}`);

        const userId = user.id;

        // 2. Check public.organizations
        const { data: orgs, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('owner_user_id', userId);
      
        console.log('\n--- public.organizations by owner_user_id ---');
        if (orgErr) console.error(orgErr);
        else console.log(orgs);

        // Check organization by email
        const { data: orgsEmail, error: orgEmailErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('email', email);
      
        console.log('\n--- public.organizations by email ---');
        if (orgEmailErr) console.error(orgEmailErr);
        else console.log(orgsEmail);

        // 3. Check public.admin_users
        const { data: adminUsers, error: adminErr } = await supabase
          .from('admin_users')
          .select('*')
          .eq('user_id', userId);
      
        console.log('\n--- public.admin_users ---');
        if (adminErr) console.error(adminErr);
        else console.log(adminUsers);

        if (adminUsers && adminUsers.length > 0) {
          const adminUserId = adminUsers[0].id;
          // 4. Check public.admin_user_roles
          const { data: adminRoles, error: adminRolesErr } = await supabase
            .from('admin_user_roles')
            .select('*, roles(*)')
            .eq('admin_user_id', adminUserId);
        
          console.log('\n--- public.admin_user_roles ---');
          if (adminRolesErr) console.error(adminRolesErr);
          else console.log(JSON.stringify(adminRoles, null, 2));
        }

        // 5. Check public.user_roles
        const { data: userRoles, error: userRolesErr } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', userId);
      
        console.log('\n--- public.user_roles ---');
        if (userRolesErr) console.error(userRolesErr);
        else console.log(userRoles);
      }
    }

    process.exit(0);
  })();
}
