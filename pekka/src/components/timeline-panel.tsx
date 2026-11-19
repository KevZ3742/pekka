"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  cardLabel,
  cardSlug,
  formatTime,
  parseCardName,
  stripVariantWords,
  type CardVariant,
} from "@/lib/format";
import { listCards } from "@/lib/library-client";
import type { Analysis, HandPeriod, Marker, PlayEvent } from "@/lib/types";

export type AnalysisStatus = {
  /** 0..1 while the worker is running, null when idle. */
  progress: number | null;
  error: string | null;
  warning: string | null;
};

type TimelinePanelProps = {
  markers: Marker[];
  time: number;
  hasVideo: boolean;
  /** Id of the saved recording, needed to load unknown-card pictures. */
  entryId: string | null;
  analysis: Analysis | null;
  status: AnalysisStatus;
  onSeek: (t: number) => void;
  onAnalyze: () => void;
  onCancelAnalyze: () => void;
  /** Name an unrecognised card (resolves when saved; rejects with a message to show). */
  onNameCard: (unknown: string, name: string) => Promise<void>;
  onAdd: () => void;
  onLabel: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
};

type Tab = "plays" | "marks";

const TEAM_STYLE = {
  red: "bg-red-500",
  blue: "bg-sky-500",
} as const;

/** The little card picture: reference art, or the crop we saved for an unknown card. */
function CardIcon({ card, entryId }: { card: string; entryId: string | null }) {
  const [failed, setFailed] = useState(false);
  const isUnknown = card.startsWith("unknown-");
  const src = isUnknown
    ? entryId && `/api/library/${entryId}/analysis/${card}.png`
    : `/api/cards/${card}`;
  if (!src || failed) {
    return <span className="grid h-9 w-7 shrink-0 place-items-center rounded bg-seam text-xs text-dim">?</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-9 w-7 shrink-0 rounded object-cover"
    />
  );
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Where in the video to look to see a card in a hand slot (just after it slid in). */
const lookTime = (h: HandPeriod) => Math.min(h.start + 0.6, (h.start + h.end) / 2);

/**
 * One unrecognised card: its picture, every moment it was on screen (the saved picture can
 * be partly covered, so jump to the video and look yourself), and a box to say what it is.
 * The suggestion list sits under the box, scrolls, and never floats over it.
 */
function NameCardRow({
  card,
  entryId,
  options,
  appearances,
  onSeek,
  onName,
}: {
  card: string;
  entryId: string | null;
  options: string[];
  appearances: HandPeriod[];
  onSeek: (t: number) => void;
  onName: (unknown: string, name: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [variant, setVariant] = useState<CardVariant>("normal");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Words typed into the box ("evo valkyrie") count too, but a card is only ever one version.
  const parsed = parseCardName(value);
  const both = parsed.evo && parsed.hero;
  const effective: CardVariant = parsed.hero ? "hero" : parsed.evo ? "evo" : variant;
  const finalSlug = parsed.base ? cardSlug(parsed.base, effective) : "";
  const canSave = !!finalSlug && !both && !saving;

  const query = norm(stripVariantWords(value));
  const matches = options
    .map((slug) => ({ slug, label: cardLabel(slug) }))
    .filter((o) => !query || norm(o.label).includes(query))
    .sort((a, b) => Number(norm(b.label).startsWith(query)) - Number(norm(a.label).startsWith(query)));
  const listOpen = open && matches.length > 0;

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const pick = (label: string) => {
    setValue(label);
    setOpen(false);
    setHi(-1);
  };

  const chooseVariant = (v: CardVariant) => {
    setVariant(v);
    setValue((text) => stripVariantWords(text)); // the buttons win over words in the box
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setProblem(null);
    try {
      await onName(card, cardLabel(finalSlug));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't save that name.");
      setSaving(false);
    }
  };

  const shown = appearances.slice(0, 8);

  return (
    <li className="flex items-start gap-3 px-5 py-2">
      <CardIcon card={card} entryId={entryId} />
      <div className="min-w-0 flex-1">
        {shown.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1 text-sm">
            <span className="text-dim">Seen at</span>
            {shown.map((h) => (
              <button
                key={`${h.team}-${h.slot}-${h.start}`}
                onClick={(e) => {
                  onSeek(lookTime(h));
                  e.currentTarget.blur(); // keep Space for play/pause
                }}
                title={`${h.team === "red" ? "Red (top)" : "Blue (bottom)"} player, slot ${h.slot + 1}`}
                className="flex items-center gap-1.5 rounded border border-seam px-1.5 py-0.5 tabular-nums text-elixir transition-colors hover:bg-seam"
              >
                <span className={`size-2 rounded-full ${TEAM_STYLE[h.team]}`} />
                {formatTime(lookTime(h), 1)}
              </button>
            ))}
            {appearances.length > shown.length && (
              <span className="text-dim">+{appearances.length - shown.length} more</span>
            )}
          </div>
        )}

        <input
          value={value}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Which card is this? e.g. Valkyrie"
          aria-label={`Name for ${cardLabel(card)}`}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setHi(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            e.stopPropagation(); // typing here must not trigger player hotkeys
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHi((h) => Math.min(h + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (listOpen && hi >= 0) pick(matches[hi].label);
              else void save();
            }
          }}
          className="w-full rounded border border-seam bg-iron px-2 py-1 text-bone placeholder:text-dim"
        />

        {listOpen && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="mt-1 max-h-44 overflow-y-auto rounded border border-seam bg-iron py-1"
          >
            {matches.map((o, i) => (
              <li key={o.slug} role="option" aria-selected={i === hi} data-active={i === hi}>
                <button
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in the box
                    pick(o.label);
                  }}
                  className={`block w-full truncate px-2 py-1 text-left text-bone ${
                    i === hi ? "bg-seam" : "hover:bg-seam/60"
                  }`}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div role="radiogroup" aria-label="Version" className="flex rounded border border-seam text-sm">
            {(["normal", "evo", "hero"] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={effective === v}
                onClick={(e) => {
                  chooseVariant(v);
                  e.currentTarget.blur();
                }}
                className={`px-2.5 py-0.5 transition-colors ${
                  effective === v ? "bg-seam text-bone" : "text-dim hover:text-bone"
                }`}
              >
                {v === "normal" ? "Normal" : v === "evo" ? "Evo" : "Hero"}
              </button>
            ))}
          </div>
          <span className="min-w-0 truncate text-sm text-dim">
            {both
              ? "Pick either Evo or Hero, not both."
              : finalSlug
                ? `Saves as ${cardLabel(finalSlug)}`
                : "Pick a card, then its version"}
          </span>
        </div>

        {problem && <p className="mt-1 text-sm text-bone">{problem}</p>}
      </div>
      <button
        onClick={() => void save()}
        disabled={!canSave}
        className="shrink-0 rounded bg-elixir px-3 py-1 text-sm font-semibold text-iron disabled:opacity-40"
      >
        Save
      </button>
    </li>
  );
}

function PlayRow({
  event,
  active,
  entryId,
  onSeek,
}: {
  event: PlayEvent;
  active: boolean;
  entryId: string | null;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li
      ref={ref}
      className={`border-l-2 ${active ? "border-elixir bg-iron/60" : "border-transparent"}`}
    >
      <button
        onClick={(e) => {
          onSeek(event.t);
          e.currentTarget.blur(); // keep Space for play/pause
        }}
        title="Jump to this play"
        className="flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors hover:bg-seam/50"
      >
        <span className="w-16 shrink-0 text-sm tabular-nums text-elixir">
          {formatTime(event.t, 1)}
        </span>
        <span
          className={`size-2.5 shrink-0 rounded-full ${TEAM_STYLE[event.team]}`}
          title={event.team === "red" ? "Red (top)" : "Blue (bottom)"}
        />
        <CardIcon card={event.card} entryId={entryId} />
        <span className="min-w-0 flex-1 truncate text-bone">{cardLabel(event.card)}</span>
      </button>
    </li>
  );
}

/** Plays (read from the video) and marks (flagged by hand) for the open recording. */
export function TimelinePanel(props: TimelinePanelProps) {
  const { markers, time, hasVideo, analysis, status } = props;
  const [tab, setTab] = useState<Tab>("plays");
  const activeMarkId = [...markers].reverse().find((m) => m.time <= time)?.id;

  const events = analysis?.events ?? [];
  let activePlay = -1;
  for (let i = 0; i < events.length; i++) if (events[i].t <= time) activePlay = i;
  const analyzing = status.progress !== null;
  const unknownCards = analysis?.unknownCards ?? [];
  const [knownCards, setKnownCards] = useState<string[]>([]);
  const hasUnknown = unknownCards.length > 0;
  // Evo and hero are chosen with the buttons, so the list holds plain cards only.
  const baseCards = [...new Set(knownCards.map((c) => parseCardName(c).base))].filter(Boolean);
  useEffect(() => {
    if (!hasUnknown) return;
    let alive = true;
    void listCards().then((c) => alive && setKnownCards(c));
    return () => {
      alive = false;
    };
  }, [hasUnknown]);

  const tabButton = (id: Tab, label: string, count: number) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded px-3 py-1 text-sm transition-colors ${
        tab === id ? "bg-seam text-bone" : "text-dim hover:text-bone"
      }`}
    >
      {label}
      {count > 0 && <span className="ml-1.5 tabular-nums text-dim">{count}</span>}
    </button>
  );

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-t border-seam bg-plate lg:flex-1 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-3 border-b border-seam px-5 py-3">
        <h2 className="text-lg font-semibold text-bone">Timeline</h2>
        <div className="flex gap-2">
          <button
            disabled={!hasVideo}
            onClick={props.onAdd}
            title="Mark this moment (M)"
            className="rounded bg-elixir px-3 py-1.5 text-sm font-semibold text-iron transition-opacity disabled:opacity-40"
          >
            Mark moment
          </button>
          <button
            disabled={markers.length === 0}
            onClick={props.onExport}
            className="rounded border border-seam px-3 py-1.5 text-sm text-bone transition-colors hover:bg-seam disabled:opacity-40"
          >
            Export
          </button>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-seam px-4 py-2">
        {tabButton("plays", "Plays", events.length)}
        {tabButton("marks", "Marks", markers.length)}
      </div>

      {tab === "plays" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {analyzing && (
            <div className="border-b border-seam px-5 py-3" role="status">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-bone">Reading the recording…</span>
                <span className="tabular-nums text-dim">
                  {Math.round((status.progress ?? 0) * 100)}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Analysis progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((status.progress ?? 0) * 100)}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-seam"
              >
                <div
                  className="h-full rounded-full bg-elixir transition-[width] duration-300"
                  style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }}
                />
              </div>
              <button
                onClick={props.onCancelAnalyze}
                className="mt-2 text-sm text-dim underline-offset-2 hover:text-bone hover:underline"
              >
                Cancel
              </button>
            </div>
          )}

          {status.error && (
            <p className="border-b border-seam px-5 py-3 text-sm text-bone" role="alert">
              {status.error}
            </p>
          )}
          {status.warning && !analyzing && (
            <p className="border-b border-seam px-5 py-3 text-sm text-dim">{status.warning}</p>
          )}

          {!analysis ? (
            !analyzing && (
              <div className="px-5 py-6">
                <p className="text-dim">
                  {hasVideo
                    ? "Read the recording to list every card that was played. You can jump to any of them."
                    : "Open a recording to see which cards were played."}
                </p>
                {hasVideo && (
                  <button
                    onClick={props.onAnalyze}
                    className="mt-4 rounded bg-elixir px-3 py-1.5 text-sm font-semibold text-iron"
                  >
                    Analyze plays
                  </button>
                )}
              </div>
            )
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-seam px-5 py-2 text-sm text-dim">
                <span>
                  {events.length} play{events.length === 1 ? "" : "s"}
                  {analysis.unknownCards.length > 0 &&
                    ` · ${analysis.unknownCards.length} unrecognised card${analysis.unknownCards.length === 1 ? "" : "s"}`}
                </span>
                <button
                  onClick={props.onAnalyze}
                  disabled={analyzing}
                  className="underline-offset-2 hover:text-bone hover:underline disabled:opacity-40"
                >
                  Re-analyze
                </button>
              </div>
              {hasUnknown && (
                <div className="max-h-[22rem] overflow-y-auto border-b border-seam py-2">
                  <p className="px-5 pb-1 text-sm text-dim">
                    These cards aren&apos;t in the downloaded art (often evolved or hero versions).
                    Pick the card, then Normal, Evo or Hero. It&apos;s remembered from now on.
                  </p>
                  <ul>
                    {unknownCards.map((u) => (
                      <NameCardRow
                        key={u}
                        card={u}
                        entryId={props.entryId}
                        options={baseCards}
                        appearances={(analysis?.hands ?? [])
                          .filter((h) => h.card === u)
                          .sort((a, b) => a.start - b.start)}
                        onSeek={props.onSeek}
                        onName={props.onNameCard}
                      />
                    ))}
                  </ul>
                </div>
              )}
              {events.length === 0 ? (
                <p className="px-5 py-6 text-dim">No plays found in this recording.</p>
              ) : (
                <ol className="min-h-0 flex-1 overflow-y-auto py-1">
                  {events.map((e, i) => (
                    <PlayRow
                      key={`${e.t}-${e.team}-${e.slot}`}
                      event={e}
                      active={i === activePlay}
                      entryId={props.entryId}
                      onSeek={props.onSeek}
                    />
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      ) : markers.length === 0 ? (
        <p className="px-5 py-6 text-dim">
          {hasVideo
            ? "Nothing marked yet. Pause on a play and press M to flag it."
            : "Open a recording to start marking moments."}
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto py-2">
          {markers.map((m) => (
            <li
              key={m.id}
              className={`flex items-center gap-3 border-l-2 px-4 py-2 ${
                m.id === activeMarkId ? "border-elixir bg-iron/60" : "border-transparent"
              }`}
            >
              <button
                onClick={() => props.onSeek(m.time)}
                title="Jump to this moment"
                className="w-16 shrink-0 rounded px-1 py-0.5 text-left text-sm tabular-nums text-elixir hover:bg-seam"
              >
                {formatTime(m.time, 1)}
              </button>
              <input
                value={m.label}
                placeholder="What happened?"
                aria-label={`Note for ${formatTime(m.time, 1)}`}
                onChange={(e) => props.onLabel(m.id, e.target.value)}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-bone placeholder:text-dim hover:border-seam focus:border-seam"
              />
              <button
                onClick={() => props.onDelete(m.id)}
                aria-label={`Delete marker at ${formatTime(m.time, 1)}`}
                className="grid size-7 shrink-0 place-items-center rounded text-dim hover:bg-seam hover:text-bone"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
