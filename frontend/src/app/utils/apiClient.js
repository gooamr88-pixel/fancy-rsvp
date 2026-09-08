const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
export const API_URL = rawApiUrl.endsWith('/api/v1') ? rawApiUrl : `${rawApiUrl}/api/v1`;
export const API_BASE_URL = API_URL.replace(/\/api\/v1$/, '');

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEMO ROUTER.

   /demo mounts the real dashboard screens — OrganizerOverview and the
   analytics page fetch their own data and cannot be fed by props — against a
   sample event that exists nowhere. Rather than patch `window.fetch` (global,
   shared with every other tab on this origin, and impossible to scope), the
   ONE client every one of those screens goes through offers a slot.

   A leak here would mean a paying organizer reading somebody's sample
   wedding, so there are three independent guards and not one:

     1. the /demo layout installs on mount and uninstalls on unmount;
     2. `isDemoSurface()` is re-checked ON EVERY CALL, not at install time, so
        a client-side navigation out of /demo stops the router even if the
        uninstall never ran;
     3. a router may DECLINE by returning undefined, and the call then goes to
        the network exactly as it always did — which is how /public/* still
        answers from the real API inside the demo.

   Nothing writes. The router is a pure function of the URL; the demo has no
   mutations to record.
   ═══════════════════════════════════════════════════════════════════════════ */

let demoRouter = null;

/** True only on a real /demo page in a browser. */
function isDemoSurface() {
  return typeof window !== 'undefined'
    && (window.location.pathname === '/demo' || window.location.pathname.startsWith('/demo/'));
}

/**
 * Answer `apiFetch` from `router(path)` while the visitor is inside /demo.
 *
 * @param {(path: string) => any} router  return undefined to decline a path
 * @returns {() => void} uninstall
 */
export function installDemoApi(router) {
  demoRouter = typeof router === 'function' ? router : null;
  return () => { if (demoRouter === router) demoRouter = null; };
}

/** Exported for the isolation test, which has to be able to prove the slot is
 *  empty rather than trust that it is. */
export function demoApiInstalled() {
  return demoRouter !== null;
}

export async function apiFetch(path, options = {}) {
  if (demoRouter && isDemoSurface()) {
    const answer = demoRouter(path, options);
    // undefined is a DECLINE, not an empty response — `{}` would be an answer.
    if (answer !== undefined) return answer;
  }

  const url = `${API_URL}${path}`;
  const headers = {
    ...options.headers,
  };

  // Only set Content-Type to JSON if we're not sending FormData
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Add request timeout (30 seconds)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include', // Send httpOnly auth cookie with every request
      signal: options.signal || controller.signal,
    });
    clearTimeout(timeoutId);
  
    // Handle 401. On a PROTECTED page this means the auth cookie is missing/expired
    // → bounce to login. On an AUTH page (login/register/forgot-password) a 401 is an
    // authentication FAILURE (wrong credentials, etc.), NOT an expired session — so we
    // surface the server's specific message instead of a misleading "session expired".
    if (response.status === 401) {
      const authPaths = ['/login', '/register', '/forgot-password'];
      const onAuthPage = typeof window !== 'undefined' && authPaths.includes(window.location.pathname);

      if (typeof window !== 'undefined' && !onAuthPage) {
        // Auth is a backend-issued httpOnly JWT (fancy_session) with a fixed 24h
        // expiry and no refresh-token exchange — this app never establishes a
        // Supabase Auth session, so there is nothing to refresh. A 401 here means
        // the cookie is missing or expired: clear local display state and send the
        // user to log in again.
        localStorage.removeItem('org_id');
        localStorage.removeItem('user_role');
        localStorage.removeItem('active_event_id');
        window.location.href = '/login?reason=expired';
        return; // Don't throw — we're redirecting
      }

      // Auth page (or SSR): pass through the API's real error message so the form can
      // show "Invalid email or password.", "Please verify your email.", etc.
      let data = null;
      try { data = await response.json(); } catch { /* missing/non-JSON body */ }
      throw new Error((data && data.message) || 'Invalid email or password.');
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return { success: true };
    }

    // Check Content-Type before parsing
    const contentType = response.headers.get('content-type') || '';

    // Handle binary/blob responses (CSV export, Excel export, file downloads).
    // Excel exports come back as the long spreadsheetml MIME type, so match the
    // generic "spreadsheet"/"excel" substrings rather than enumerating each one.
    if (
      contentType.includes('text/csv') ||
      contentType.includes('application/octet-stream') ||
      contentType.includes('spreadsheetml') ||
      contentType.includes('spreadsheet') ||
      contentType.includes('excel')
    ) {
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      return response.blob();
    }

    // Handle plain text responses
    if (contentType.includes('text/plain')) {
      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `Request failed with status ${response.status}`);
      }
      return text;
    }

    // Default: parse as JSON
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      return { success: true };
    }

    if (!response.ok) {
      const err = new Error(data.message || `Request failed with status ${response.status}`);
      // Attached, not thrown differently: every existing caller reads err.message
      // and keeps working. These let a caller tell apart failures that need
      // different UI — a feature-gated 403 wants an upgrade prompt, not the raw
      // sentence the API returned.
      err.status = response.status;
      err.code = data.error || null;
      throw err;
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  }
}

export async function logout() {
  if (typeof window === 'undefined') return;
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // If the server call fails, still clear local state
  }
  localStorage.removeItem('org_id');
  localStorage.removeItem('user_role');
  localStorage.removeItem('active_event_id');
  // The session cookie is httpOnly — only the server can clear it, which the
  // /auth/logout call above already did. A client-side `document.cookie =`
  // assignment here can never touch it (JS has no access to httpOnly cookies).
  window.location.href = '/login';
}
