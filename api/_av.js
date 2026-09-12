// Shared Alpha Vantage call sequencer.
//
// Underscore-prefixed so Vercel does not route it as a function.
//
// SCOPE WARNING — read before relying on this. Module state lives inside one
// warm serverless instance. On Vercel /api/company and /api/prices are
// separate functions with separate module instances, so this mutex sequences
// calls *within* one function's warm instance and nothing more. It cannot
// sequence company-search against prices. The browser is the only place that
// can guarantee that, and it does: see queueAvRequest() in src/main.ts.
// This stays as defence in depth for repeat invocations on a warm instance.

const MIN_GAP_MS = 1200;

let lastAvCallTime = 0;
const avMutex = {
  lock: Promise.resolve()
};

export async function scheduleAvCall(fn) {
  const currentLock = avMutex.lock;
  let release;
  avMutex.lock = new Promise((resolve) => {
    release = resolve;
  });

  await currentLock;
  try {
    const now = Date.now();
    const elapsed = now - lastAvCallTime;
    if (elapsed < MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
    }
    const result = await fn();
    lastAvCallTime = Date.now();
    return result;
  } finally {
    release();
  }
}
