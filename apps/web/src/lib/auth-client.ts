import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";
// Same origin as the page (auth is proxied to the API); a placeholder during SSR, where it isn't called.
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
  plugins: [anonymousClient()],
});
