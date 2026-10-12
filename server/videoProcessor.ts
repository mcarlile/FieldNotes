import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { storage } from './storage';
import { objectStorageService } from './objectStorage';

const TEMP_DIR = '/tmp/video-processing';

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Clips being processed by this server process. A clip whose status is
// 'processing' but isn't in this set was orphaned by a restart.
const activeJobs = new Set<string>();

interface ProcessingResult {
  thumbnailUrl: string;
  transcodedUrl: string;
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running FFmpeg with args:`, args.join(' '));
    const ffmpeg = spawn('ffmpeg', args, { 
      stdio: ['ignore', 'pipe', 'pipe'] 
    });
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
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

interface StreamInfo {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  height?: number;
}

// Browser-playable H.264 at 1080p or below only needs repackaging, which
// takes seconds instead of a full re-encode.
async function canRemux(inputPath: string): Promise<{ video: boolean; audio: boolean }> {
  try {
    const output = await runFFprobe([
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,pix_fmt,height',
      '-of', 'json',
      inputPath
    ]);
    const streams: StreamInfo[] = JSON.parse(output).streams ?? [];
    const video = streams.find(s => s.codec_type === 'video');
    const audio = streams.find(s => s.codec_type === 'audio');
    return {
      video: !!video && video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' &&
        (video.height ?? Infinity) <= 1080,
      audio: !audio || audio.codec_name === 'aac',
    };
  } catch (error) {
    console.error('FFprobe failed, falling back to full transcode:', error);
    return { video: false, audio: false };
  }
}

async function downloadVideo(sourceUrl: string, destPath: string): Promise<void> {
  console.log(`Downloading video from: ${sourceUrl}`);
  
  const objectFile = await objectStorageService.getFileFromRawPath(sourceUrl);
  const writeStream = fs.createWriteStream(destPath);
  
  return new Promise((resolve, reject) => {
    objectStorageService.downloadObjectToStream(objectFile, writeStream)
      .then(() => {
        writeStream.close();
        resolve();
      })
      .catch(reject);
  });
}

async function uploadProcessedFile(filePath: string, prefix: string): Promise<string> {
  const filename = `${prefix}-${Date.now()}-${path.basename(filePath)}`;
  const fileBuffer = fs.readFileSync(filePath);
  
  const uploadUrl = await objectStorageService.generateUploadUrl(filename);
  
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': filePath.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4',
    },
    body: fileBuffer,
  });
  
  if (!response.ok) {
    throw new Error(`Failed to upload processed file: ${response.status}`);
  }
  
  const url = new URL(uploadUrl);
  return objectStorageService.normalizeObjectEntityPath(url.pathname);
}

export async function processVideo(clipId: string): Promise<void> {
  const workDir = path.join(TEMP_DIR, clipId);
  activeJobs.add(clipId);
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    
    await storage.updateVideoClip(clipId, { 
      processingStatus: 'processing' 
    });
    
    const clip = await storage.getVideoClipById(clipId);
    if (!clip) {
      throw new Error(`Video clip not found: ${clipId}`);
    }
    
    const inputPath = path.join(workDir, 'input.mp4');
    const thumbnailPath = path.join(workDir, 'thumbnail.jpg');
    const transcodedPath = path.join(workDir, 'transcoded.mp4');
    
    console.log(`Processing video clip ${clipId}: ${clip.title}`);
    
    await downloadVideo(clip.url, inputPath);
    console.log(`Downloaded video to: ${inputPath}`);
    
    console.log('Generating thumbnail...');
    await runFFmpeg([
      '-i', inputPath,
      '-ss', '00:00:01',
      '-vframes', '1',
      '-vf', 'scale=640:-1',
      '-q:v', '2',
      '-y',
      thumbnailPath
    ]);
    
    if (!fs.existsSync(thumbnailPath)) {
      await runFFmpeg([
        '-i', inputPath,
        '-ss', '00:00:00',
        '-vframes', '1',
        '-vf', 'scale=640:-1',
        '-q:v', '2',
        '-y',
        thumbnailPath
      ]);
    }
    
    const remux = await canRemux(inputPath);
    const videoArgs = remux.video
      ? ['-c:v', 'copy']
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
    
    console.log('Uploading processed files...');
    const thumbnailUrl = await uploadProcessedFile(thumbnailPath, 'thumbnail');
    const transcodedUrl = await uploadProcessedFile(transcodedPath, 'transcoded');
    
    await storage.updateVideoClip(clipId, {
      thumbnailUrl,
      transcodedUrl,
      processingStatus: 'ready'
    });
    
    console.log(`Video processing complete for clip ${clipId}`);
    
  } catch (error) {
    console.error(`Video processing failed for clip ${clipId}:`, error);
    
    await storage.updateVideoClip(clipId, {
      processingStatus: 'error',
      processingError: error instanceof Error ? error.message : 'Unknown error'
    });
    
  } finally {
    activeJobs.delete(clipId);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

export function startVideoProcessing(clipId: string): void {
  setImmediate(() => {
    processVideo(clipId).catch((error) => {
      console.error(`Background video processing error for ${clipId}:`, error);
    });
  });
}

export function isVideoProcessingActive(clipId: string): boolean {
  return activeJobs.has(clipId);
}

// Jobs run inside the web server, so a restart kills them and leaves clips
// stuck in 'pending' or 'processing'. Mark them failed so they can be retried.
export async function recoverInterruptedVideoProcessing(): Promise<void> {
  try {
    const count = await storage.failInterruptedVideoClips(
      'Processing was interrupted by a server restart. Retry to process again.'
    );
    if (count > 0) {
      console.log(`Marked ${count} interrupted video clip(s) as failed`);
    }
  } catch (error) {
    console.error('Failed to recover interrupted video processing:', error);
  }
}
