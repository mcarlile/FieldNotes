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
const PLAYABLE_PIX_FMTS = new Set(["yuv420p", "yuvj420p"]);

/**
 * Decides whether a clip only needs repackaging, which takes seconds, rather
 * than a full re-encode, which can take hours on a small server. H.264 and
 * 8-bit H.265 (Main profile) at 1080p or below are kept as they are; H.265 is
 * tagged hvc1 so Safari and Chrome on macOS will play it.
 */
export function planRemux(streams: StreamInfo[]): RemuxPlan {
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const fitsPlayer =
    !!video && PLAYABLE_PIX_FMTS.has(video.pix_fmt ?? "") && (video.height ?? Infinity) <= 1080;
  const h264 = fitsPlayer && video!.codec_name === "h264";
  const hevc = fitsPlayer && video!.codec_name === "hevc" && video!.profile === "Main";
  return {
    video: h264 || hevc,
    audio: !audio || audio.codec_name === "aac",
    videoArgs: hevc ? ["-tag:v", "hvc1"] : [],
  };
}
