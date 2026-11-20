const tails = new Map<string, Promise<void>>();

export function enqueueForOrder<T>(
  key: string,
  task: () => Promise<T>
): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(task);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  });
  return run;
}
