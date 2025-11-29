import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { storage } from './storage';
import { objectStorageService } from './objectStorage';

const TEMP_DIR = '/tmp/video-processing';

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

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
    
    console.log('Transcoding to 1080p...');
    await runFFmpeg([
      '-i', inputPath,
      '-vf', 'scale=-2:1080',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
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
