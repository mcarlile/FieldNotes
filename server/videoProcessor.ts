import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { storage } from './storage';
import { objectStorageService } from './objectStorage';
import { createSerialQueue } from './serialQueue';
import { isPlayableAsIs, planRemux, type RemuxPlan } from './remuxPlan';

const TEMP_DIR = '/tmp/video-processing';

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

interface ProcessingResult {
  thumbnailUrl: string;
  transcodedUrl: string;
}

// A stuck encode must not hold the one-at-a-time queue forever.
const FFMPEG_TIMEOUT_MS = 45 * 60 * 1000;
const DOWNLOAD_STALL_MS = 2 * 60 * 1000;
const THUMBNAIL_TIMEOUT_MS = 5 * 60 * 1000;
// Long enough for ffprobe and the thumbnail to finish reading the source.
const SOURCE_URL_TTL_SEC = 60 * 60;

function runFFmpeg(args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running FFmpeg with args:`, args.join(' '));
    const ffmpeg = spawn('ffmpeg', args, { 
      stdio: ['ignore', 'pipe', 'pipe'] 
    });
    
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill('SIGKILL');
    }, timeoutMs);
    
    ffmpeg.stderr.on('data', (data) => {
      stderr = (stderr + data.toString()).slice(-2000);
    });
    
    ffmpeg.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`FFmpeg timed out after ${Math.round(timeoutMs / 60000)} minutes`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function runFFprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    ffprobe.stdout.on('data', (data) => { stdout += data.toString(); });
    ffprobe.stderr.on('data', (data) => { stderr += data.toString(); });
    ffprobe.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`FFprobe exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
    ffprobe.on('error', reject);
  });
}

async function probePlan(input: string): Promise<RemuxPlan> {
  const output = await runFFprobe([
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,profile,pix_fmt,height',
    '-of', 'json',
    input
  ]);
  return planRemux(JSON.parse(output).streams ?? []);
}

async function probeRemux(input: string): Promise<RemuxPlan> {
  try {
    return await probePlan(input);
  } catch (error) {
    console.error('FFprobe failed, falling back to full transcode:', error);
    return { video: false, audio: false, videoArgs: [] };
  }
}

async function downloadVideo(sourceUrl: string, destPath: string): Promise<void> {
  console.log(`Downloading video from: ${sourceUrl}`);
  
  const objectFile = await objectStorageService.getFileFromRawPath(sourceUrl);
  const writeStream = fs.createWriteStream(destPath);

  // Fail a download that stops making progress instead of waiting forever.
  let lastBytes = -1;
  const watchdog = setInterval(() => {
    if (writeStream.bytesWritten === lastBytes) {
      writeStream.destroy(new Error('Download from storage stalled'));
    }
    lastBytes = writeStream.bytesWritten;
  }, DOWNLOAD_STALL_MS);

  try {
    await objectStorageService.downloadObjectToStream(objectFile, writeStream);
  } finally {
    clearInterval(watchdog);
  }
}

async function uploadProcessedFile(filePath: string, prefix: string): Promise<string> {
  const filename = `${prefix}-${Date.now()}-${path.basename(filePath)}`;
  const uploadUrl = await objectStorageService.generateUploadUrl(filename);

  // Stream from disk: a transcoded ride clip can be hundreds of MB, and
  // reading it into memory alongside other work can get the server killed.
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': filePath.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4',
      'Content-Length': String(fs.statSync(filePath).size),
    },
    body: Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream,
    duplex: 'half',
  } as RequestInit);
  
  if (!response.ok) {
    throw new Error(`Failed to upload processed file: ${response.status}`);
  }
  
  const url = new URL(uploadUrl);
  return objectStorageService.normalizeObjectEntityPath(url.pathname);
}

function thumbnailArgs(input: string, at: string, outputPath: string): string[] {
  // -ss before -i seeks the input, so over a URL ffmpeg only fetches the
  // bytes around that frame instead of reading from the start.
  return ['-ss', at, '-i', input, '-vframes', '1', '-vf', 'scale=640:-1', '-q:v', '2', '-y', outputPath];
}

async function makeThumbnail(input: string, thumbnailPath: string): Promise<void> {
  try {
    await runFFmpeg(thumbnailArgs(input, '00:00:01', thumbnailPath), THUMBNAIL_TIMEOUT_MS);
  } catch {
    // Clips under a second long have no frame at 1 s.
  }
  if (!fs.existsSync(thumbnailPath)) {
    await runFFmpeg(thumbnailArgs(input, '00:00:00', thumbnailPath), THUMBNAIL_TIMEOUT_MS);
  }
}

export async function processVideo(clipId: string): Promise<void> {
  const workDir = path.join(TEMP_DIR, clipId);

  try {
    fs.mkdirSync(workDir, { recursive: true });
    
    await storage.updateVideoClip(clipId, { 
      processingStatus: 'processing' 
    });
    
    const clip = await storage.getVideoClipById(clipId);
    if (!clip) {
      throw new Error(`Video clip not found: ${clipId}`);
    }
    
    const thumbnailPath = path.join(workDir, 'thumbnail.jpg');
    const inputPath = path.join(workDir, 'input.mp4');
    console.log(`Processing video clip ${clipId}: ${clip.title}`);

    // ffprobe and the thumbnail read only the parts of the file they need,
    // straight from storage. Downloading a whole clip took most of the
    // processing time on this server. If reading from storage directly
    // fails, fall back to downloading it.
    let input = await objectStorageService.getSignedReadUrl(clip.url, SOURCE_URL_TTL_SEC);
    let downloaded = false;
    let remux: RemuxPlan;
    try {
      remux = await probePlan(input);
    } catch (error) {
      console.error('Probing from storage failed, downloading instead:', error);
      await downloadVideo(clip.url, inputPath);
      input = inputPath;
      downloaded = true;
      remux = await probeRemux(inputPath);
    }
    console.log('Generating thumbnail...');
    await makeThumbnail(input, thumbnailPath);

    let transcodedUrl: string | null = null;
    if (isPlayableAsIs(remux)) {
      // H.264 and AAC already play in browsers, so the original is served
      // as it is rather than as a second, repackaged copy.
      console.log('Original plays as is; skipping repackaging');
    } else {
      const transcodedPath = path.join(workDir, 'transcoded.mp4');
      if (!downloaded) {
        await downloadVideo(clip.url, inputPath);
        console.log(`Downloaded video to: ${inputPath}`);
      }
      const videoArgs = remux.video
        ? ['-c:v', 'copy', ...remux.videoArgs]
        : ['-vf', 'scale=-2:1080', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
      const audioArgs = remux.audio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k'];
      console.log(remux.video ? 'Repackaging without re-encoding...' : 'Transcoding to 1080p...');
      await runFFmpeg([
        '-i', inputPath,
        ...videoArgs,
        ...audioArgs,
        '-movflags', '+faststart',
        '-y',
        transcodedPath
      ]);
      transcodedUrl = await uploadProcessedFile(transcodedPath, 'transcoded');
    }

    console.log('Uploading thumbnail...');
    const thumbnailUrl = await uploadProcessedFile(thumbnailPath, 'thumbnail');
    
    await storage.updateVideoClip(clipId, {
      thumbnailUrl,
      transcodedUrl,
      processingStatus: 'ready',
      processingError: null,
    });
    
    console.log(`Video processing complete for clip ${clipId}`);
    
  } catch (error) {
    console.error(`Video processing failed for clip ${clipId}:`, error);
    
    await storage.updateVideoClip(clipId, {
      processingStatus: 'error',
      processingError: error instanceof Error ? error.message : 'Unknown error'
    });
    
  } finally {
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

// One clip at a time: each job downloads the original, runs ffmpeg and
// uploads the result, and several at once exhaust a small server.
const queue = createSerialQueue(processVideo);

export function startVideoProcessing(clipId: string): void {
  queue.add(clipId);
}

/** True while this server process has the clip running or waiting its turn. */
export function isVideoProcessingActive(clipId: string): boolean {
  return queue.has(clipId);
}

/**
 * Puts a clip back in the queue unless this process is already handling it.
 * A clip left 'pending' or 'processing' with no job behind it is stuck, for
 * example after its job was killed without the server restarting.
 */
export async function reprocessVideoClip(clipId: string): Promise<'queued' | 'already_active' | 'not_found'> {
  const clip = await storage.getVideoClipById(clipId);
  if (!clip) return 'not_found';
  if (queue.has(clipId)) return 'already_active';
  await storage.updateVideoClip(clipId, { processingStatus: 'pending', processingError: null });
  queue.add(clipId);
  return 'queued';
}

// Jobs run inside the web server, so a restart (such as a Publish) kills them
// and leaves clips stuck in 'pending' or 'processing'. Queue them again, once:
// a clip that was already requeued and got interrupted again may be what is
// bringing the server down, so it is failed instead and left for a Retry.
const REQUEUED_AFTER_RESTART = 'Requeued after a server restart';

export async function recoverInterruptedVideoProcessing(): Promise<void> {
  try {
    const clips = await storage.getInterruptedVideoClips();
    let requeued = 0;
    for (const clip of clips) {
      if (clip.processingError === REQUEUED_AFTER_RESTART) {
        await storage.updateVideoClip(clip.id, {
          processingStatus: 'error',
          processingError: 'Processing was interrupted by a server restart twice. Retry to process again.',
        });
        continue;
      }
      await storage.updateVideoClip(clip.id, { processingStatus: 'pending', processingError: REQUEUED_AFTER_RESTART });
      queue.add(clip.id);
      requeued++;
    }
    if (clips.length > 0) {
      console.log(`Requeued ${requeued} of ${clips.length} interrupted video clip(s)`);
    }
  } catch (error) {
    console.error('Failed to recover interrupted video processing:', error);
  }
}
