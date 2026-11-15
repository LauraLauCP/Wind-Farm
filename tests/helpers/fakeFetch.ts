import { vi } from 'vitest';

/**
 * Builds a `fetch` stub keyed by full URL, in the house style of
 * `tests/aemetClient.test.ts`. Unstubbed URLs return a 500 so a wrong URL
 * fails the test loudly instead of passing silently.
 */
export function fakeFetch(responses: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const key = String(url);
    const body = responses[key];
    if (body === undefined) {
      return new Response('{"descripcion":"not stubbed"}', { status: 500 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}
