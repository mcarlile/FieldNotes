/**
 * Helpers for working out when a video clip was recorded, so it can be
 * placed on a TrailCam project's timeline without typing offsets by hand.
 */

// Camera filenames such as Insta360's VID_20261017_142758_00_004.mp4 or
// GoPro/phone-style 20261017_142758.mp4 carry the camera's local clock time.
const CAMERA_FILENAME_TIME = /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/;

/**
 * Reads the recording start from a camera-style filename. The camera clock is
 * local time, so the result is interpreted in the current environment's time
 * zone (the browser's, for uploads from the web app).
 */
export function parseCameraFilenameTime(filename: string): Date | null {
  const match = CAMERA_FILENAME_TIME.exec(filename);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

// Seconds between the QuickTime epoch (1904-01-01) and the Unix epoch.
const QUICKTIME_EPOCH_OFFSET = 2082844800;

type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

function boxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Reads the movie creation time (mvhd) from an MP4/MOV file without loading
 * the whole file. `readRange` returns the bytes in [start, end).
 */
export async function readMp4CreationTime(readRange: ReadRange, size: number): Promise<Date | null> {
  let offset = 0;
  while (offset + 8 <= size) {
    const header = await readRange(offset, Math.min(offset + 16, size));
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let boxSize = view.getUint32(0);
    const type = boxType(header, 4);
    let headerSize = 8;
    if (boxSize === 1) {
      if (header.byteLength < 16) return null;
      boxSize = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < headerSize) return null;

    if (type === "moov") {
      // mvhd is the first child of moov in practice; its header is small.
      const moov = await readRange(offset + headerSize, Math.min(offset + boxSize, offset + headerSize + 4096));
      return parseMvhdCreationTime(moov);
    }
    offset += boxSize;
  }
  return null;
}

function parseMvhdCreationTime(moovBody: Uint8Array): Date | null {
  const view = new DataView(moovBody.buffer, moovBody.byteOffset, moovBody.byteLength);
  let offset = 0;
  while (offset + 8 <= moovBody.byteLength) {
    const boxSize = view.getUint32(offset);
    const type = boxType(moovBody, offset + 4);
    if (type === "mvhd") {
      const version = moovBody[offset + 8];
      const seconds =
        version === 1 ? Number(view.getBigUint64(offset + 12)) : view.getUint32(offset + 12);
      if (!seconds) return null;
      return new Date((seconds - QUICKTIME_EPOCH_OFFSET) * 1000);
    }
    if (boxSize < 8) return null;
    offset += boxSize;
  }
  return null;
}

// Clips are only placed automatically when the computed offset is plausible:
// not before the route starts and within two days of it.
const MAX_AUTO_OFFSET_SECONDS = 48 * 60 * 60;

/**
 * Seconds from the route start to the clip's recording start, or null when
 * either time is missing or the result is implausible.
 */
export function clipOffsetSeconds(
  recordedAt: Date | null | undefined,
  routeStart: Date | string | null | undefined,
): number | null {
  if (!recordedAt || !routeStart) return null;
  const start = typeof routeStart === "string" ? new Date(routeStart) : routeStart;
  const offset = Math.round((recordedAt.getTime() - start.getTime()) / 1000);
  if (isNaN(offset) || offset < 0 || offset > MAX_AUTO_OFFSET_SECONDS) return null;
  return offset;
}
