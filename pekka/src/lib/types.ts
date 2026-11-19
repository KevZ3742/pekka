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
  /** Set once card recognition has run; analysis/analysis.json then exists. */
  analyzedAt?: string;
  /** Frame rate used for frame stepping and conversion. */
  fps: number;
  duration?: number;
  width?: number;
  height?: number;
  markers: Marker[];
};

export type Team = "red" | "blue"; // red = top of the screen, blue = bottom

/** One card being played. `card` is a reference-art slug ("the-log") or "unknown-N". */
export type PlayEvent = {
  /** Seconds into the video when the card left the hand (i.e. was played). */
  t: number;
  team: Team;
  /** 0-3, left to right. */
  slot: number;
  card: string;
  /** How well the card matched its reference art (0..1). */
  confidence: number;
  /** The card that arrived in that slot; null if the clip ended first. */
  replacedBy: string | null;
};

/** One stretch where a hand slot held a single card. */
export type HandPeriod = {
  team: Team;
  slot: number;
  card: string;
  score: number;
  start: number;
  end: number;
};

export type Analysis = {
  version: 1;
  created: string;
  video: string;
  fps: number;
  duration: number;
  /** Cards we have no reference art for: unknown-1, unknown-2, ... */
  unknownCards: string[];
  events: PlayEvent[];
  hands: HandPeriod[];
  /** Both elixir bars sampled `hz` times a second. */
  elixir: { hz: number; red: number[]; blue: number[] };
};
