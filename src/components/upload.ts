"use client";

import { useCallback, useState } from "react";
import type { MediaItem } from "@/lib/types";

const MAX_JPEG = 8 * 1024 * 1024;

interface Prepared {
  blob: Blob;
  name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
}

function canvasToJpeg(bmp: ImageBitmap, maxEdge: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // flatten transparency
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res({ blob: b, width: c.width, height: c.height }) : rej(new Error("Encode failed"))), "image/jpeg", quality),
  );
}

/**
 * Instagram accepts only JPEG ≤ 8 MB, so other image formats are converted in the browser.
 * Dimensions/duration are read client-side so the server needs no ffmpeg.
 */
export async function prepareFile(file: File): Promise<Prepared> {
  if (file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name)) {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error(`${file.name}: this browser can't read that image format. Export it as JPEG or PNG.`);
    }
    let out: Prepared = { blob: file, name: file.name, width: bmp.width, height: bmp.height, duration: null };
    if (file.type !== "image/jpeg" || file.size > MAX_JPEG) {
      let enc = await canvasToJpeg(bmp, 4096, 0.92);
      if (enc.blob.size > MAX_JPEG) enc = await canvasToJpeg(bmp, 2880, 0.85);
      out = { ...enc, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", duration: null };
    }
    bmp.close();
    return out;
  }
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(file.name)) {
    const meta = await new Promise<{ width: number | null; height: number | null; duration: number | null }>((resolve) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      const done = (r: { width: number | null; height: number | null; duration: number | null }) => {
        URL.revokeObjectURL(url);
        resolve(r);
      };
      const t = setTimeout(() => done({ width: null, height: null, duration: null }), 15000);
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        clearTimeout(t);
        done({ width: v.videoWidth || null, height: v.videoHeight || null, duration: Number.isFinite(v.duration) ? v.duration : null });
      };
      v.onerror = () => {
        clearTimeout(t);
        done({ width: null, height: null, duration: null });
      };
      v.src = url;
    });
    return { blob: file, name: file.name, ...meta };
  }
  throw new Error(`${file.name}: only images and videos are supported.`);
}

export function uploadPrepared(p: Prepared, onProgress: (f: number) => void): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.setRequestHeader("Content-Type", p.blob.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(p.name));
    if (p.width) xhr.setRequestHeader("X-Width", String(p.width));
    if (p.height) xhr.setRequestHeader("X-Height", String(p.height));
    if (p.duration) xhr.setRequestHeader("X-Duration", String(p.duration));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.media);
      else reject(new Error(body.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(p.blob);
  });
}

export interface UploadJob {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

export function useUploader(onUploaded: (m: MediaItem) => void) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const update = (key: string, patch: Partial<UploadJob>) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const keyed = list.map((f) => ({ f, key: `${f.name}-${f.size}-${Math.random()}` }));
      setJobs((js) => [...js, ...keyed.map(({ f, key }) => ({ key, name: f.name, progress: 0 }))]);
      // Sequential keeps order predictable (carousel order = selection order) and bandwidth focused.
      for (const { f, key } of keyed) {
        try {
          const prepared = await prepareFile(f);
          const media = await uploadPrepared(prepared, (p) => update(key, { progress: p }));
          onUploaded(media);
          setJobs((js) => js.filter((j) => j.key !== key));
        } catch (e) {
          update(key, { error: (e as Error).message });
        }
      }
    },
    [onUploaded],
  );

  const dismiss = (key: string) => setJobs((js) => js.filter((j) => j.key !== key));
  return { jobs, upload, dismiss };
}
