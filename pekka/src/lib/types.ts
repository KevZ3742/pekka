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
