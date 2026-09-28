// Results retain input order even when individual uploads finish out of order.
export async function runUploadQueue<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  concurrency = 3,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Upload concurrency must be a positive integer");
  }
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

export function summarizeUploadBatch<S, F, E>(
  results: readonly { successful: S | null; failed: F | null; exifData: E | null }[],
  emptyExif: () => E,
) {
  return {
    successful: results.flatMap(r => r.successful ? [r.successful] : []),
    failed: results.flatMap(r => r.failed ? [r.failed] : []),
    exifData: results.filter(r => r.successful).map(r => r.exifData ?? emptyExif()),
  };
}

export function countOccupiedPhotoSlots(
  editorCount: number,
  files: readonly { status: string }[],
  unacknowledgedIds: ReadonlySet<string>,
  acknowledgedIds: readonly string[],
): number {
  const acknowledged = new Set(acknowledgedIds);
  return editorCount +
    files.filter(f => f.status === "queued" || f.status === "processing" || f.status === "uploading").length +
    Array.from(unacknowledgedIds).filter(id => !acknowledged.has(id)).length;
}