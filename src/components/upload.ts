"use client";

import { useCallback, useState } from "react";
import type { MediaItem } from "@/lib/types";
import { fmtBytes } from "@/lib/format";
import { getStorage, storageChanged } from "./storage";

const MAX_JPEG = 8 * 1024 * 1024;
const THUMB_EDGE = 480;

interface Prepared {
  blob: Blob;
  /** ~480px JPEG preview for grids; null when the browser couldn't decode the file. */
  thumb: Blob | null;
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
    const thumb = (await canvasToJpeg(bmp, THUMB_EDGE, 0.8).catch(() => null))?.blob ?? null;
    let out: Prepared = { blob: file, thumb, name: file.name, width: bmp.width, height: bmp.height, duration: null };
    if (file.type !== "image/jpeg" || file.size > MAX_JPEG) {
      let enc = await canvasToJpeg(bmp, 4096, 0.92);
      if (enc.blob.size > MAX_JPEG) enc = await canvasToJpeg(bmp, 2880, 0.85);
      out = { ...enc, thumb, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", duration: null };
    }
    bmp.close();
    return out;
  }
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(file.name)) {
    type Meta = { width: number | null; height: number | null; duration: number | null; thumb: Blob | null };
    const meta = await new Promise<Meta>((resolve) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      let settled = false;
      let partial: Meta = { width: null, height: null, duration: null, thumb: null };
      const done = (r: Meta) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        URL.revokeObjectURL(url);
        v.removeAttribute("src");
        v.load();
        resolve(r);
      };
      const t = setTimeout(() => done(partial), 15000);
      v.preload = "auto";
      v.muted = true;
      v.playsInline = true;
      v.onloadedmetadata = () => {
        partial = { width: v.videoWidth || null, height: v.videoHeight || null, duration: Number.isFinite(v.duration) ? v.duration : null, thumb: null };
        // Grab a frame a little way in (the first frame is often black).
        v.currentTime = Math.min(1, (partial.duration ?? 0) * 0.1);
      };
      v.onseeked = () => {
        if (!v.videoWidth) return done(partial);
        const scale = Math.min(1, THUMB_EDGE / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => done({ ...partial, thumb: b }), "image/jpeg", 0.8);
      };
      v.onerror = () => done(partial);
      v.src = url;
    });
    const { thumb, ...dims } = meta;
    return { blob: file, thumb, name: file.name, ...dims };
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
      if (xhr.status >= 200 && xhr.status < 300) {
        const media = body.media as MediaItem;
        if (!p.thumb) return resolve(media);
        fetch(`/api/media/${media.id}/thumb`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: p.thumb })
          .then((r) => (r.ok ? r.json() : null))
          .then((t) => resolve(t?.thumbUrl ? { ...media, thumbUrl: t.thumbUrl } : media))
          .catch(() => resolve(media));
      }
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
          // Refuse before sending gigabytes that the server would reject at the end.
          const s = getStorage();
          if (s && prepared.blob.size > s.uploadable) {
            throw new Error(
              s.uploadable <= 0
                ? `Storage is full (${fmtBytes(s.used)} of ${fmtBytes(s.limit)}). Free up space under Media → Storage.`
                : `${fmtBytes(prepared.blob.size)} won't fit: ${fmtBytes(s.uploadable)} left. Free up space under Media → Storage.`,
            );
          }
          const media = await uploadPrepared(prepared, (p) => update(key, { progress: p }));
          onUploaded(media);
          storageChanged();
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
