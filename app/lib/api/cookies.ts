export function parseCookies(cookieHeader: string | null) {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  // Split the cookie string by semicolons and spaces
  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest.length > 0) {
      // Decode the name and value, and join value parts in case it contains '='
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

/*
 * `getApiKeysFromCookie` used to live here.
 *
 * Eleven routes called it, which meant a decrypted provider key had to be
 * written into a browser cookie for any of them to work — readable by any
 * script on the page, sent with every request, and taking precedence over the
 * account, so switching providers in settings silently did nothing.
 *
 * Keys are read from the account on the server now: `apiKeysForRequest` in
 * app/lib/.server/llm/user-keys.ts. Nothing puts a credential in a cookie, so
 * there is nothing here to read one back out.
 */

export function getProviderSettingsFromCookie(cookieHeader: string | null): Record<string, any> {
  const cookies = parseCookies(cookieHeader);
  return cookies.providers ? JSON.parse(cookies.providers) : {};
}
