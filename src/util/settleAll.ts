/**
 * Runs every task to completion, then rejects with one AggregateError of all failures (nested ones flattened).
 * Unlike Promise.all, one failure does not abandon the rest.
 */
export async function settleAll(tasks: Promise<unknown>[], message: string): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const errors = results.flatMap((result) => {
    if (result.status === 'fulfilled') return [];
    return result.reason instanceof AggregateError ? result.reason.errors : [result.reason];
  });
  if (errors.length > 0) throw new AggregateError(errors, message);
}
