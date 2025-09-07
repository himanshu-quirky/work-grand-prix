// Supabase client helper
// This module encapsulates the Supabase client and a few helper functions for
// signing users up, signing them in and retrieving the current profile. It
// relies on global variables defined in index.html: SUPABASE_URL and
// SUPABASE_ANON_KEY. These values are injected at runtime when the page
// loads.  See index.html for the definition of these globals.

// Note: We use the UMD build of the Supabase client, which exposes a global
// named `supabase`. That global is loaded via a script tag in index.html.
// Here we wrap that global in ES module exports so we can use import
// statements in main.js.

// Create the client using the globals defined in index.html. If the globals
// are not available for some reason, this will throw an error. Ensure
// SUPABASE_URL and SUPABASE_ANON_KEY are set before importing this module.
const supa = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);

// Sign up a new user with a pseudo‑email derived from the username. Supabase
// requires a valid email for authentication. We derive the email using the
// username plus a local domain (e.g. alice → alice@wgp.local). After
// registration, we upsert a row into the `profiles` table to store the
// username and default role ('user'). The role will be elevated to 'admin'
// separately for the designated account.
export async function signUpUsername(username, password) {
  const email = `${username}@wgp.local`;
  const { data, error } = await supa.auth.signUp({ email, password });
  if (error) throw error;
  const user = data.user;
  // Insert or update the profile with the username
  await supa.from('profiles').upsert({ id: user.id, username, role: 'user' });
  return user;
}

// Sign in with a pseudo‑email derived from the username. This mirrors
// signUpUsername above. If the credentials are invalid, Supabase will throw.
export async function signInUsername(username, password) {
  const email = `${username}@wgp.local`;
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

// Fetch the current authenticated profile. Returns an object with
// `id`, `username` and `role` fields or null if not authenticated. The
// auth token is persisted automatically by the Supabase client.
export async function getCurrentProfile() {
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const { data, error } = await supa.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

// Expose the client for direct queries (e.g. tasks, invites, leaderboards).
export { supa };