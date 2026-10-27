import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlayableAsIs, planRemux } from "./remuxPlan";

const aac = { codec_type: "audio", codec_name: "aac" };

test("1080p H.265 Main from Insta360 Studio is repackaged, tagged hvc1", () => {
  const plan = planRemux([
    { codec_type: "video", codec_name: "hevc", profile: "Main", pix_fmt: "yuvj420p", height: 1080 },
    aac,
  ]);
  assert.deepEqual(plan, { video: true, audio: true, videoArgs: ["-tag:v", "hvc1"] });
});

test("1080p H.264 is repackaged as is, in either color range", () => {
  for (const pix_fmt of ["yuv420p", "yuvj420p"]) {
    const plan = planRemux([{ codec_type: "video", codec_name: "h264", pix_fmt, height: 1080 }, aac]);
    assert.deepEqual(plan, { video: true, audio: true, videoArgs: [] });
  }
});

test("4K H.264 and H.265 from Insta360 Studio are repackaged, not re-encoded", () => {
  const h264 = planRemux([{ codec_type: "video", codec_name: "h264", profile: "High", pix_fmt: "yuvj420p", height: 2160 }, aac]);
  assert.deepEqual(h264, { video: true, audio: true, videoArgs: [] });
  const hevc = planRemux([{ codec_type: "video", codec_name: "hevc", profile: "Main", pix_fmt: "yuv420p", height: 2160 }, aac]);
  assert.deepEqual(hevc, { video: true, audio: true, videoArgs: ["-tag:v", "hvc1"] });
});

test("above 4K, 10-bit and other codecs are re-encoded", () => {
  const cases = [
    { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", height: 2880 },
    { codec_type: "video", codec_name: "hevc", profile: "Main 10", pix_fmt: "yuv420p10le", height: 1080 },
    { codec_type: "video", codec_name: "prores", pix_fmt: "yuv422p10le", height: 1080 },
  ];
  for (const video of cases) assert.equal(planRemux([video, aac]).video, false);
  assert.equal(planRemux([]).video, false);
});

test("non-AAC audio is re-encoded and a silent clip needs no audio work", () => {
  const video = { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", height: 720 };
  assert.equal(planRemux([video, { codec_type: "audio", codec_name: "opus" }]).audio, false);
  assert.equal(planRemux([video]).audio, true);
});

test("only H.264 with AAC or no audio is served as it is", () => {
  const h264 = { codec_type: "video", codec_name: "h264", pix_fmt: "yuvj420p", height: 2160 };
  const hevc = { codec_type: "video", codec_name: "hevc", profile: "Main", pix_fmt: "yuv420p", height: 1080 };
  assert.equal(isPlayableAsIs(planRemux([h264, aac])), true);
  assert.equal(isPlayableAsIs(planRemux([h264])), true);
  // H.265 needs its hvc1 tag, other audio needs re-encoding.
  assert.equal(isPlayableAsIs(planRemux([hevc, aac])), false);
  assert.equal(isPlayableAsIs(planRemux([h264, { codec_type: "audio", codec_name: "opus" }])), false);
});
