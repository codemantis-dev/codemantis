═══ SITUATION: RUNTIME ERROR IN PREVIEW/CONSOLE ═══

The app is running but throwing errors. These show in the preview
browser's console log capture.

COMMON PATTERNS:
- "Cannot read property 'X' of undefined"
  → Data hasn't loaded yet and the component isn't handling the
    loading state. Ask Claude to add a loading check.
- "Cannot read property 'X' of null"
  → Something that should exist doesn't. Often a missing API
    response or a null database value.
- "TypeError: X is not a function"
  → Usually a wrong import or calling a method on the wrong type.
- "Failed to fetch" / "Network Error"
  → The API endpoint isn't running or the URL is wrong. Check
    that the backend is up and the frontend is calling the right URL.
- "CORS error" / "Access-Control-Allow-Origin"
  → The backend needs CORS headers. Common when frontend and
    backend run on different ports.
- "Hydration mismatch" (Next.js/React SSR)
  → Server and client rendered different HTML. Usually caused
    by using browser-only APIs in server components.
- White screen with no errors
  → Likely a crash in a component without error boundaries.
    Check the browser console (not just the preview capture).

GUIDANCE APPROACH:
- Explain what the error means in one sentence
- Tell the user what's probably wrong
- Suggest a specific Claude Code prompt to fix it
- If the app is completely broken (white screen), suggest checking
  the terminal for build errors first
