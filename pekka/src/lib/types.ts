/** A moment you flag while reviewing. Later this grows into plays, leaks, blunders, etc. */
export type Marker = {
  id: string;
  /** Seconds into the video. */
  time: number;
  label: string;
};

/** Shape written by "Export". Versioned so the format can evolve. */
export type ReviewExport = {
  version: 1;
  video: string;
  fps: number;
  markers: Marker[];
};

/**
 * One saved recording in the history. Lives on disk as
 * <library>/<id>/{meta.json, original.<ext>, video.mp4}.
 */
export type LibraryEntry = {
  id: string;
  /** name|size|lastModified of the file you opened; used to spot re-opens. */
  key: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  /** File name of the untouched upload inside the entry's folder. */
  originalFile: string;
  originalType: string;
  /** True once video.mp4 (H.264, constant frame rate) exists. */
  converted: boolean;
  convertedAt?: string;
  convertedFps?: number;
  /** Frame rate used for frame stepping and conversion. */
  fps: number;
  duration?: number;
  width?: number;
  height?: number;
  markers: Marker[];
};
