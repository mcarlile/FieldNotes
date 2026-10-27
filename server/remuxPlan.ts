export interface StreamInfo {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  height?: number;
}

export interface RemuxPlan {
  /** Copy the video stream instead of re-encoding it. */
  video: boolean;
  /** Copy the audio stream instead of re-encoding it. */
  audio: boolean;
  /** Extra ffmpeg args for a copied video stream. */
  videoArgs: string[];
}

// 8-bit 4:2:0, in limited (yuv420p) or full (yuvj420p) range. Cameras and
// Insta360 Studio exports often tag full range; browsers play both.
// Browsers decode 4K H.264 and H.265 in hardware on current machines.
const MAX_PASSTHROUGH_HEIGHT = 2160;

const PLAYABLE_PIX_FMTS = new Set(["yuv420p", "yuvj420p"]);

/**
 * Decides whether a clip only needs repackaging, which takes seconds, rather
 * than a full re-encode, which can take hours on a small server. H.264 and
 * 8-bit H.265 (Main profile) up to 4K are kept as they are; H.265 is tagged
 * hvc1 so Safari and Chrome on macOS will play it. Re-encoding a 4K clip to
 * 1080p would take longer than the processing timeout on the web server.
 */
export function planRemux(streams: StreamInfo[]): RemuxPlan {
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const fitsPlayer =
    !!video && PLAYABLE_PIX_FMTS.has(video.pix_fmt ?? "") && (video.height ?? Infinity) <= MAX_PASSTHROUGH_HEIGHT;
  const h264 = fitsPlayer && video!.codec_name === "h264";
  const hevc = fitsPlayer && video!.codec_name === "hevc" && video!.profile === "Main";
  return {
    video: h264 || hevc,
    audio: !audio || audio.codec_name === "aac",
    videoArgs: hevc ? ["-tag:v", "hvc1"] : [],
  };
}

/**
 * True when the original file can be served as it is: H.264 video, AAC (or
 * no) audio. Repackaging it would only move the index to the front, and
 * browsers find an index at the end with one extra range request.
 */
export function isPlayableAsIs(plan: RemuxPlan): boolean {
  return plan.video && plan.audio && plan.videoArgs.length === 0;
}
