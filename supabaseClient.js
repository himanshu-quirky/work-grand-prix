/**
 * Supabase client helper
 *
 * This script encapsulates the Supabase client and a few helper functions for
 * signing users up, signing them in and retrieving the current profile. It
 * relies on global variables defined in index.html: SUPABASE_URL and
 * SUPABASE_ANON_KEY. These values are injected at runtime when the page
 * loads. See index.html for the definition of these globals.
 *
 * Note: We use the UMD build of the Supabase client, which exposes a global
 * named `supabase`. That global is loaded via a script tag in index.html.
 * This file does not use ES module syntax so that it can be loaded as a
 * classic script on GitHub Pages. All helpers are attached to the global
 * `window` object for consumption in main.js.
 */

(function () {
  // Ensure the Supabase library and configuration are available on window.
  if (!window.supabase) {
    console.error('Supabase library not found. Did you include the UMD build in index.html?');
    return;
  }
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error('Supabase configuration not found on window. Please set SUPABASE_URL and SUPABASE_ANON_KEY in index.html.');
    return;
  }
  // Create the Supabase client. Persist sessions and auto refresh tokens.
  const supaClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );

  /**
   * Sign up a new user with a pseudo‑email derived from the username. Supabase
   * requires a valid email for authentication. We derive the email using the
   * username plus a local domain (e.g. alice → alice@wgp.local). After
   * registration, we upsert a row into the `profiles` table to store the
   * username and default role ('user'). The role will be elevated to 'admin'
   * separately for the designated account.
   * @param {string} username The username chosen by the user
   * @param {string} password The user's password
   */
  async function signUpUsername(username, password) {
    const email = `${username}@wgp.local`;
    const { data, error } = await supaClient.auth.signUp({ email, password });
    if (error) throw error;
    const user = data.user;
    // Insert or update the profile with the username
    await supaClient.from('profiles').upsert({ id: user.id, username, role: 'user' });
    return user;
  }

  /**
   * Sign in with a pseudo‑email derived from the username. This mirrors
   * signUpUsername above. If the credentials are invalid, Supabase will throw.
   * @param {string} username The username
   * @param {string} password The password
   */
  async function signInUsername(username, password) {
    const email = `${username}@wgp.local`;
    const { data, error } = await supaClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  /**
   * Fetch the current authenticated profile. Returns an object with
   * `id`, `username` and `role` fields or null if not authenticated. The
   * auth token is persisted automatically by the Supabase client.
   */
  async function getCurrentProfile() {
    const { data: { user } } = await supaClient.auth.getUser();
    if (!user) return null;
    const { data, error } = await supaClient.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return data;
  }

  // Attach the client and helper functions to the global window object so
  // that they can be accessed in main.js without relying on ES module
  // imports. These assignments intentionally overwrite any existing values.
  window.supa = supaClient;
  window.signUpUsername = signUpUsername;
  window.signInUsername = signInUsername;
  window.getCurrentProfile = getCurrentProfile;

  /**
   * Sign up a new user using a real email address. When using email as the
   * identifier, we still need a display name (username) for the app. We
   * derive a default username from the part of the email before the '@'
   * symbol. After registration, we insert or update a row into the
   * `profiles` table using the user ID returned by Supabase Auth. The
   * role defaults to 'user'.
   *
   * @param {string} email A valid email address
   * @param {string} password The desired password
   */
  async function signUpEmail(email, password) {
    const { data, error } = await supaClient.auth.signUp({ email, password });
    if (error) throw error;
    const user = data.user;
    // Derive a username from the email's local part (before the '@').
    const username = email.split('@')[0];
    // Determine role: grant admin role to designated emails
    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    // Insert or update profile with derived username and role
    await supaClient.from('profiles').upsert({ id: user.id, username, role });
    return user;
  }

  /**
   * Sign in an existing user using their email address and password. This
   * mirrors the username sign‑in but uses the real email directly. Throws
   * if the credentials are invalid.
   *
   * @param {string} email The user's email address
   * @param {string} password The user's password
   */
  async function signInEmail(email, password) {
    const { data, error } = await supaClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  // Expose the new email helper functions on the global window.  These
  // functions coexist with the username helpers so the app can support
  // both modes if desired.  main.js chooses which to call based on the
  // form inputs.
  window.signUpEmail = signUpEmail;
  window.signInEmail = signInEmail;

  /**
   * The list of email addresses that should be granted admin privileges
   * automatically when they sign up. When a user registers with one of
   * these emails, their profile is inserted with role 'admin' instead of
   * the default 'user'. This is useful for seeding an initial admin
   * account without requiring manual intervention in the Supabase UI.
   */
  const ADMIN_EMAILS = [
    'himanshu@quirkyheads.in',
  ];
})();