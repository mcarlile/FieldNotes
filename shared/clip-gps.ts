/**
 * Placing a video clip on its trip from a GPX recorded alongside the video,
 * such as the one Insta360 Studio exports next to each reframed clip when the
 * Insta360 GPS remote is used. When a clip has a paired GPX it is the primary
 * way the clip's start is worked out; otherwise the camera filename and the
 * MP4's own creation time are used.
 */
import type { CompactTimedTrack } from "./gpx-utils";
import { trackPositionAt } from "./gpx-utils";
import { clipOffsetSeconds } from "./clip-timing";

export interface ClipGpsPoint {
  /** Unix time in milliseconds. */
  t: number;
  lat: number;
  lon: number;
}

/** A clip's own GPS track, with times spread out to sub-second precision. */
export interface ClipGpsTrack {
  startMs: number;
  endMs: number;
  points: ClipGpsPoint[];
}

const TRKPT = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`);
const TIME = /<time>\s*([^<\s]+)\s*<\/time>/;

/**
 * Reads the track points of a clip GPX. Insta360 writes about ten points per
 * second, all stamped with the same whole second; those runs are spread
 * evenly across their second so the track keeps its full time resolution.
 * Returns null when the GPX has fewer than two timed points.
 */
export function parseClipGpx(content: string): ClipGpsTrack | null {
  const raw: ClipGpsPoint[] = [];
  for (const match of content.matchAll(TRKPT)) {
    const lat = parseFloat(ATTR("lat").exec(match[1])?.[1] ?? "");
    const lon = parseFloat(ATTR("lon").exec(match[1])?.[1] ?? "");
    const time = TIME.exec(match[2])?.[1];
    if (isNaN(lat) || isNaN(lon) || !time) continue;
    const t = Date.parse(time);
    if (isNaN(t)) continue;
    raw.push({ t, lat, lon });
  }
  if (raw.length < 2) return null;
  raw.sort((a, b) => a.t - b.t);

  // Group points that share a timestamp.
  const runs: ClipGpsPoint[][] = [];
  for (const point of raw) {
    const last = runs[runs.length - 1];
    if (last && last[0].t === point.t) last.push(point);
    else runs.push([point]);
  }

  const points: ClipGpsPoint[] = [];
  if (runs.length === raw.length) {
    points.push(...raw);
  } else {
    // Typical points per second, from the runs in the middle (the first and
    // last seconds are usually cut short by the trim).
    const sizes = runs.slice(1, -1).map((run) => run.length).sort((a, b) => a - b);
    const perSecond = sizes.length ? sizes[Math.floor(sizes.length / 2)] : Math.max(...runs.map((r) => r.length));
    runs.forEach((run, index) => {
      const next = runs[index + 1];
      const gap = next ? next[0].t - run[0].t : 1000;
      const step = Math.min(gap, 1000) / Math.max(perSecond, run.length);
      // A short first run is the end of its second, so it sits flush against the next one.
      const lead = index === 0 && run.length < perSecond ? (perSecond - run.length) * step : 0;
      run.forEach((point, i) => points.push({ ...point, t: run[0].t + lead + i * step }));
    });
  }
  return { startMs: points[0].t, endMs: points[points.length - 1].t, points };
}

/** [lat, lon] on the clip track at a time (clamped to the track's ends). */
export function clipPositionAt(track: ClipGpsTrack, t: number): [number, number] {
  const pts = track.points;
  if (t <= pts[0].t) return [pts[0].lat, pts[0].lon];
  const last = pts[pts.length - 1];
  if (t >= last.t) return [last.lat, last.lon];
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return [a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon)];
}

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const kx = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * kx * 111_320;
  const dy = (lat2 - lat1) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

/** The lowercase file name without its extension. */
function stem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[^.]+$/, "").trim().toLowerCase();
}

/**
 * Finds the GPX exported with a video. Names match on their stem, so
 * `VID_x(a).mp4` pairs with `VID_x(a).gpx`. Insta360 Studio sometimes drops
 * the reframe label from the GPX name (`VID_x(landscape).mp4` comes with
 * `VID_x.gpx`), so a trailing "(...)" on the video is ignored as a second try.
 */
export function findPairedGpx<T>(videoName: string, gpxByName: Map<string, T>): T | undefined {
  const byStem = new Map<string, T>();
  gpxByName.forEach((value, name) => byStem.set(stem(name), value));
  const videoStem = stem(videoName);
  return byStem.get(videoStem) ?? byStem.get(videoStem.replace(/\s*\([^()]*\)$/, ""));
}

/**
 * The recording start of a video from its camera filename and its MP4
 * creation time. Recent Insta360 Studio exports stamp each trimmed export
 * with the true start of the trim, while older exports carried the export
 * time; so the creation time wins when it falls inside the recording that
 * the filename names (no earlier than the filename, at most 12 hours later).
 */
export function recordingStartFromFile(
  filenameTime: Date | null | undefined,
  metadataTime: Date | null | undefined,
): { time: Date; source: string } | null {
  if (metadataTime && filenameTime) {
    const delta = metadataTime.getTime() - filenameTime.getTime();
    if (delta >= -5_000 && delta <= 12 * 3600_000) return { time: metadataTime, source: "the video's metadata" };
    return { time: filenameTime, source: "the filename" };
  }
  if (filenameTime) return { time: filenameTime, source: "the filename" };
  if (metadataTime) return { time: metadataTime, source: "the video's metadata" };
  return null;
}

// A GPX whose length is within this many seconds of the video's covers just
// that clip, so its first point is the clip's start.
const SAME_LENGTH_TOLERANCE_SECONDS = 3;

/**
 * When the clip starts, read from its paired GPX. A GPX that covers just the
 * clip gives the start directly. One that covers the whole recording (Insta360
 * writes those for some trims) confirms the given start falls inside it.
 * Null when the GPX can't place the clip.
 */
export function recordedAtFromGpx(
  track: ClipGpsTrack,
  durationSeconds: number,
  fileStart: Date | null | undefined,
): Date | null {
  const spanSeconds = (track.endMs - track.startMs) / 1000;
  if (Math.abs(spanSeconds - durationSeconds) <= SAME_LENGTH_TOLERANCE_SECONDS) {
    return new Date(track.startMs);
  }
  if (fileStart) {
    const t = fileStart.getTime();
    if (t >= track.startMs - SAME_LENGTH_TOLERANCE_SECONDS * 1000 && t <= track.endMs) return fileStart;
  }
  return null;
}

export interface RouteAlignment {
  /** Seconds after the route start that the clip begins. */
  offsetSeconds: number;
  /** How far the GPS match moved the clip from its clock time, in seconds. */
  shiftSeconds: number;
  /** Average distance between the clip's GPS and the route once aligned. */
  meanErrorMeters: number;
}

const ALIGN_SEARCH_SECONDS = 90;
const ALIGN_SAMPLE_SECONDS = 0.5;
const ALIGN_MIN_TRAVEL_METERS = 25;
const ALIGN_MAX_ERROR_METERS = 25;

/**
 * Lines the clip's own GPS path up against the trip route, so the clip sits
 * where the rider actually was rather than where the clocks say. Searches a
 * window of ±90 s around the clock time. Null when the trip has no timed
 * route, the rider barely moved during the clip (the match would be a guess),
 * or the paths don't agree.
 */
export function alignClipToRoute(
  track: ClipGpsTrack,
  recordedAt: Date,
  durationSeconds: number,
  route: CompactTimedTrack | null | undefined,
  routeStart: Date,
): RouteAlignment | null {
  if (!route?.points?.length) return null;
  const startMs = Math.max(recordedAt.getTime(), track.startMs);
  const endMs = Math.min(recordedAt.getTime() + durationSeconds * 1000, track.endMs);
  if (endMs - startMs < 2000) return null;

  const samples: { video: number; lat: number; lon: number }[] = [];
  for (let t = startMs; t <= endMs; t += ALIGN_SAMPLE_SECONDS * 1000) {
    const [lat, lon] = clipPositionAt(track, t);
    samples.push({ video: (t - recordedAt.getTime()) / 1000, lat, lon });
  }
  let travel = 0;
  for (let i = 1; i < samples.length; i++) {
    travel += metersBetween(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon);
  }
  if (travel < ALIGN_MIN_TRAVEL_METERS) return null;

  const clockOffset = (recordedAt.getTime() - routeStart.getTime()) / 1000;
  const errorAt = (shift: number) => {
    let total = 0;
    for (const s of samples) {
      const position = trackPositionAt(route, clockOffset + shift + s.video);
      if (!position) return Infinity;
      total += metersBetween(s.lat, s.lon, position[1], position[0]);
    }
    return total / samples.length;
  };

  let best = { shift: 0, error: Infinity };
  for (let shift = -ALIGN_SEARCH_SECONDS; shift <= ALIGN_SEARCH_SECONDS; shift += 0.5) {
    const error = errorAt(shift);
    if (error < best.error) best = { shift, error };
  }
  for (let shift = best.shift - 0.4; shift <= best.shift + 0.4; shift += 0.1) {
    const error = errorAt(shift);
    if (error < best.error) best = { shift, error };
  }
  if (best.error > ALIGN_MAX_ERROR_METERS) return null;

  const shiftSeconds = Math.round(best.shift * 10) / 10;
  return {
    offsetSeconds: Math.round((clockOffset + shiftSeconds) * 10) / 10,
    shiftSeconds,
    meanErrorMeters: Math.round(best.error * 10) / 10,
  };
}

export interface ClipStart {
  /** Seconds after the route start. */
  offsetSeconds: number;
  /** The UTC time the clip starts, by the clocks. */
  recordedAt: Date;
  /** Where the start came from, for display ("start from …"). */
  source: string;
  /** True when the paired GPX placed the clip. */
  fromGpx: boolean;
}

/**
 * Works out where a clip starts on its trip. A paired GPX comes first: it
 * fixes the clip's time and, when the trip has a timed route, its GPS path is
 * matched against the route. Without one (or when it can't place the clip),
 * the filename and MP4 creation time are used as before.
 */
export function detectClipStart(input: {
  durationSeconds: number;
  routeStart: Date | string | null | undefined;
  route?: CompactTimedTrack | null;
  gpx?: ClipGpsTrack | null;
  filenameTime?: Date | null;
  metadataTime?: Date | null;
}): ClipStart | null {
  if (!input.routeStart) return null;
  const routeStart = typeof input.routeStart === "string" ? new Date(input.routeStart) : input.routeStart;
  const fromFile = recordingStartFromFile(input.filenameTime, input.metadataTime);

  if (input.gpx) {
    const recordedAt = recordedAtFromGpx(input.gpx, input.durationSeconds, fromFile?.time);
    if (recordedAt) {
      const aligned = alignClipToRoute(input.gpx, recordedAt, input.durationSeconds, input.route, routeStart);
      if (aligned && aligned.offsetSeconds >= 0) {
        return { offsetSeconds: aligned.offsetSeconds, recordedAt, source: "the paired GPX, matched to the route", fromGpx: true };
      }
      const offset = clipOffsetSeconds(recordedAt, routeStart);
      if (offset !== null) return { offsetSeconds: offset, recordedAt, source: "the paired GPX", fromGpx: true };
    }
  }

  if (fromFile) {
    const offset = clipOffsetSeconds(fromFile.time, routeStart);
    if (offset !== null) return { offsetSeconds: offset, recordedAt: fromFile.time, source: fromFile.source, fromGpx: false };
  }
  return null;
}
