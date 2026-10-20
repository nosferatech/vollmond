// Helpers for the tests that check how a cost grows with the size of an input. They compare two times measured in the same
// run, rather than one time with a fixed bound, which a busy machine fails. It is not built.

/** The least time, in milliseconds, of one batch of calls that {@link timeOf} times, so that a short call is timed too. */
const LEAST_BATCH_MS = 1;

/** The least time, in milliseconds, of all the batches of calls that {@link timeOf} times. */
const LEAST_MEASURED_MS = 20;

/**
 * Gives the time one call of `call` takes, in milliseconds. The calls are timed in batches that take at least
 * {@link LEAST_BATCH_MS} each, until all take at least {@link LEAST_MEASURED_MS}, and the time per call of the quickest batch
 * is given: a batch is short enough that the system often lets it run without a pause for another process. A call of a few
 * microseconds is timed as well as one of seconds, which runs once.
 */
export function timeOf(call: () => unknown): number {
  let sink: unknown;
  let least = Number.POSITIVE_INFINITY;
  const started = performance.now();
  do {
    let calls = 0;
    const batchStarted = performance.now();
    let elapsed = 0;
    do {
      sink = call();
      calls += 1;
      elapsed = performance.now() - batchStarted;
    } while (elapsed < LEAST_BATCH_MS);
    least = Math.min(least, elapsed / calls);
  } while (performance.now() - started < LEAST_MEASURED_MS);
  // Kept, so that the engine cannot leave out a call whose result is unused.
  if (sink === timeOf) throw new Error("unreachable");
  return least;
}

/**
 * Gives how many times longer the large input takes than the small one: `small` and `large` each measure one run and give
 * its time in milliseconds. The two are measured in the same run, so that neither the machine's speed nor a steady load
 * decides the outcome; only a load that changes between them does. One small run first warms the code up, then `runs` runs
 * of each alternate, and the least time of each is compared, which leaves out a pause for the garbage collector or another
 * process.
 */
export async function leastTimeRatio(
  small: () => number | Promise<number>,
  large: () => number | Promise<number>,
  runs = 7,
): Promise<number> {
  await small();
  let smallTime = Number.POSITIVE_INFINITY;
  let largeTime = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run++) {
    smallTime = Math.min(smallTime, await small());
    largeTime = Math.min(largeTime, await large());
  }
  return largeTime / smallTime;
}
