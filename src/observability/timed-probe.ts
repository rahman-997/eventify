export async function timedProbe(probe: () => Promise<boolean>, timeoutMs = 2_500) {
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = (ok: boolean) => ({ ok, latencyMs: Number((performance.now() - startedAt).toFixed(2)) });
  try {
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    return result(await Promise.race([probe(), deadline]));
  } catch {
    return result(false);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
