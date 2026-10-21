export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    const item = queue.shift();
    if (item === undefined) return;
    await task(item);
    await worker();
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}
