import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "../../ui";
import { clamp, formatTime, parseTime } from "./time";
import "./trimmer.css";

/** Arrow keys nudge a clamp; shift jumps a second. ~1.5 frames at 30fps, which
 *  is the resolution the cut itself actually has. */
const NUDGE = 0.05;
const NUDGE_COARSE = 1;
/** Shortest cut worth making, and the gap the two clamps keep from each other. */
const MIN_SPAN = 0.05;
/** Tightest zoom: half a second spread across the whole track. */
const MIN_VIEW = 0.5;
const ZOOM_STEP = 1.6;
/** Auto-pan once a moving clamp or the playhead comes within this much of
 *  the edge of the visible window. */
const REVEAL_MARGIN = 0.1;

type Edge = "start" | "end";

/** The arrow/Home/End contract, written once: returns where the key wants to
 *  go, or null if it is not one of ours. */
function arrowTarget(
  e: React.KeyboardEvent,
  at: number,
  step: number,
  max: number,
): number | null {
  const moves: Record<string, number> = {
    ArrowLeft: at - step,
    ArrowRight: at + step,
    Home: 0,
    End: max,
  };
  if (!(e.key in moves)) return null;
  e.preventDefault();
  return moves[e.key];
}

export interface Selection {
  start: number;
  end: number;
}


/** The slice of the video the track is currently showing. Zooming narrows
 *  `span`; panning slides `start`. At `span === duration` the track shows the
 *  whole video, which is where it starts. */
interface View {
  start: number;
  span: number;
}

function Trimmer({
  src,
  busy,
  onCut,
}: {
  src: string;
  busy: boolean;
  onCut: (selection: Selection) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<Selection>({ start: 0, end: 0 });
  const [view, setView] = useState<View>({ start: 0, span: 0 });
  const [dragging, setDragging] = useState<Edge | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [panning, setPanning] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Previous frame's currentTime, so playback pauses on *crossing* the end
   *  clamp rather than any time it happens to sit past it. */
  const lastTime = useRef(0);
  /** Where inside the window the overview strip was grabbed, so dragging it
   *  slides the window rather than teleporting its left edge to the cursor. */
  const grab = useRef(0);

  const zoom = view.span > 0 ? duration / view.span : 1;
  const zoomed = zoom > 1.001;

  // Track geometry. Position and width are different conversions once the view
  // has an offset, so they are two functions and not one.
  const posPct = (t: number) => (view.span ? ((t - view.start) / view.span) * 100 : 0);
  const spanPct = (s: number) => (view.span ? (s / view.span) * 100 : 0);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || !view.span) return 0;
      const rect = el.getBoundingClientRect();
      const t = view.start + ((clientX - rect.left) / rect.width) * view.span;
      return clamp(t, 0, duration);
    },
    [view, duration],
  );

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    lastTime.current = t;
    setCurrent(t);
  }, []);

  /** Slide the window so `t` is comfortably inside it. */
  const reveal = useCallback(
    (t: number) => {
      setView((v) => {
        const margin = v.span * REVEAL_MARGIN;
        const limit = Math.max(duration - v.span, 0);
        let start = v.start;
        if (t < v.start + margin) start = t - margin;
        else if (t > v.start + v.span - margin) start = t - v.span + margin;
        start = clamp(start, 0, limit);
        return start === v.start ? v : { ...v, start };
      });
    },
    [duration],
  );

  const zoomTo = useCallback(
    (span: number, anchor: number) => {
      setView((v) => {
        const next = clamp(span, Math.min(MIN_VIEW, duration), duration);
        // Keep whatever was under the anchor pinned where it was.
        const ratio = v.span ? (anchor - v.start) / v.span : 0.5;
        const start = clamp(anchor - ratio * next, 0, Math.max(duration - next, 0));
        return { start, span: next };
      });
    },
    [duration],
  );

  const panTo = useCallback(
    (start: number) =>
      setView((v) => {
        // Returning the same object when nothing moved matters: `view` keys
        // timeAt, which keys the wheel listener's effect. Minting a new one
        // per pointer-move would re-register that listener at pointer rate.
        const next = clamp(start, 0, Math.max(duration - v.span, 0));
        return next === v.start ? v : { ...v, start: next };
      }),
    [duration],
  );

  /** The overview strip spans the whole video, so its mapping is its own. */
  const mapTimeAt = (clientX: number) => {
    const el = mapRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  // timeupdate fires ~4x a second, which makes the playhead visibly lurch, so
  // while playing we read currentTime on every frame instead -- and that is
  // also where playback stops itself at the end clamp.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime;
        if (lastTime.current < sel.end && t >= sel.end) v.pause();
        lastTime.current = t;
        setCurrent(t);
        reveal(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, sel.end, reveal]);

  // The handler reads `view`, so it is rebuilt every render; the listener is
  // registered once and trampolines through a ref. Keying the effect on the
  // handler instead would add and remove a native listener on every pan
  // frame -- pointer rate while dragging, 60/s while playing zoomed in.
  const handleWheel = (e: WheelEvent) => {
    const el = trackRef.current;
    if (!el || !duration) return;
    e.preventDefault();
    if (e.shiftKey) {
      const dt = (e.deltaY / el.getBoundingClientRect().width) * view.span;
      panTo(view.start + dt);
    } else {
      zoomTo(view.span * (e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), timeAt(e.clientX));
    }
  };
  const wheelRef = useRef(handleWheel);
  useEffect(() => {
    wheelRef.current = handleWheel;
  });

  // React attaches wheel at the root as a passive listener, so preventDefault
  // there is ignored and the page scrolls instead of the track zooming.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [duration]);

  const moveEdge = useCallback(
    (edge: Edge, t: number) => {
      // Computed outside setSel: seeking is a side effect, and StrictMode
      // invokes state updaters twice.
      const next =
        edge === "start"
          ? { ...sel, start: clamp(t, 0, sel.end - MIN_SPAN) }
          : { ...sel, end: clamp(t, sel.start + MIN_SPAN, duration) };
      const at = edge === "start" ? next.start : next.end;
      setSel(next);
      // Seeking to the clamp is the point: a precise cut needs the frame you
      // are cutting on to be on screen.
      seek(at);
      reveal(at);
    },
    [sel, duration, seek, reveal],
  );

  const onClampDown = (edge: Edge) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(edge);
    videoRef.current?.pause();
  };

  const onClampKey = (edge: Edge) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const at = edge === "start" ? sel.start : sel.end;
    const to = arrowTarget(e, at, e.shiftKey ? NUDGE_COARSE : NUDGE, duration);
    if (to !== null) moveEdge(edge, to);
  };

  const playSelection = () => {
    const v = videoRef.current;
    if (!v) return;
    seek(sel.start);
    void v.play();
  };

  const stepZoom = (factor: number) =>
    zoomTo(view.span * factor, clamp(current, view.start, view.start + view.span));

  const span = Math.max(sel.end - sel.start, 0);
  const whole = duration > 0 && sel.start === 0 && sel.end === duration;

  return (
    <div className="trim">
      <div className="trim-player">
        <video
          ref={videoRef}
          className="trim-video"
          src={src}
          controls
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (!Number.isFinite(d) || d <= 0) return setFailed(true);
            setDuration(d);
            setSel({ start: 0, end: d });
            setView({ start: 0, span: d });
          }}
          onPlay={(e) => {
            lastTime.current = e.currentTarget.currentTime;
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          onSeeked={(e) => {
            lastTime.current = e.currentTarget.currentTime;
            setCurrent(e.currentTarget.currentTime);
          }}
          onTimeUpdate={(e) => !playing && setCurrent(e.currentTarget.currentTime)}
          onError={() => setFailed(true)}
        />
        {!failed && (
          <div className="trim-controls">
            <button
              type="button"
              className="trim-rewind"
              onClick={playSelection}
              disabled={span <= 0}
              title="Play from the start clamp"
              aria-label="Play from the start clamp"
            >
              ⏮
            </button>
          </div>
        )}
      </div>

      {failed ? (
        <p className="trim-note">
          This browser cannot play the downloaded file, so it cannot be trimmed here.
          Download it above and cut it locally.
        </p>
      ) : (
        <>
          <div
            className="trim-track"
            ref={trackRef}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setScrubbing(true);
              seek(timeAt(e.clientX));
            }}
            onPointerMove={(e) => scrubbing && seek(timeAt(e.clientX))}
            onPointerUp={() => setScrubbing(false)}
            onPointerCancel={() => setScrubbing(false)}
          >
            <div
              className="trim-sel"
              style={{ left: `${posPct(sel.start)}%`, width: `${spanPct(span)}%` }}
            />
            <div className="trim-play" style={{ left: `${posPct(current)}%` }} />
            {(["start", "end"] as const).map((edge) => {
              const at = edge === "start" ? sel.start : sel.end;
              return (
                <button
                  key={edge}
                  type="button"
                  className="trim-clamp"
                  data-edge={edge}
                  data-dragging={dragging === edge}
                  style={{ left: `${posPct(at)}%` }}
                  role="slider"
                  aria-label={edge === "start" ? "Selection start" : "Selection end"}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={at}
                  aria-valuetext={formatTime(at)}
                  onPointerDown={onClampDown(edge)}
                  onPointerMove={(e) => dragging === edge && moveEdge(edge, timeAt(e.clientX))}
                  onPointerUp={() => setDragging(null)}
                  onPointerCancel={() => setDragging(null)}
                  onKeyDown={onClampKey(edge)}
                  onFocus={() => reveal(at)}
                >
                  <span className="jaw" />
                </button>
              );
            })}
          </div>

          {/* Only worth the space once the track no longer shows the whole
              video: it is the only thing that says where the window sits. */}
          {zoomed && (
            <div
              className="trim-map"
              ref={mapRef}
              data-panning={panning}
              role="slider"
              tabIndex={0}
              aria-label="Visible window"
              aria-valuemin={0}
              aria-valuemax={Math.max(duration - view.span, 0)}
              aria-valuenow={view.start}
              aria-valuetext={`${formatTime(view.start)} to ${formatTime(view.start + view.span)}`}
              onPointerDown={(e) => {
                const t = mapTimeAt(e.clientX);
                // Grabbing inside the window slides it; grabbing outside jumps
                // it to the cursor first, then slides from there.
                const inside = t >= view.start && t <= view.start + view.span;
                grab.current = inside ? t - view.start : view.span / 2;
                e.currentTarget.setPointerCapture(e.pointerId);
                setPanning(true);
                panTo(t - grab.current);
              }}
              onPointerMove={(e) => panning && panTo(mapTimeAt(e.clientX) - grab.current)}
              onPointerUp={() => setPanning(false)}
              onPointerCancel={() => setPanning(false)}
              onKeyDown={(e) => {
                const step = view.span * (e.shiftKey ? 1 : 0.25);
                const to = arrowTarget(e, view.start, step, duration);
                if (to !== null) panTo(to);
              }}
            >
              <div
                className="trim-map-sel"
                style={{ left: `${(sel.start / duration) * 100}%`, width: `${(span / duration) * 100}%` }}
              />
              <div
                className="trim-map-view"
                style={{ left: `${(view.start / duration) * 100}%`, width: `${(view.span / duration) * 100}%` }}
              />
            </div>
          )}

          <div className="trim-times">
            <TimeInput
              label="start"
              value={sel.start}
              onCommit={(t) => moveEdge("start", t)}
              onSet={() => moveEdge("start", current)}
            />
            <TimeInput
              label="end"
              value={sel.end}
              onCommit={(t) => moveEdge("end", t)}
              onSet={() => moveEdge("end", current)}
            />
            <div className="trim-time">
              <span>length</span>
              <output>{formatTime(span)}</output>
            </div>
            {/* Resets the selection, not the zoom -- so it sits with the
                readouts it clears, not with the zoom controls. */}
            <Button
              variant="ghost"
              className="trim-reset"
              onClick={() => setSel({ start: 0, end: duration })}
              disabled={whole}
            >
              Reset
            </Button>
            <div className="trim-zoom">
              <Button
                variant="ghost"
                onClick={() => stepZoom(ZOOM_STEP)}
                disabled={!zoomed}
                aria-label="Zoom out"
              >
                −
              </Button>
              <output>{zoom < 9.95 ? zoom.toFixed(1) : Math.round(zoom)}×</output>
              <Button
                variant="ghost"
                onClick={() => stepZoom(1 / ZOOM_STEP)}
                disabled={view.span <= Math.min(MIN_VIEW, duration)}
                aria-label="Zoom in"
              >
                +
              </Button>
            </div>
          </div>

          <div className="row">
            <Button
              className="trim-go"
              onClick={() => onCut(sel)}
              disabled={busy || span < MIN_SPAN}
            >
              {busy ? "Fetching\u2026" : whole ? "Download whole video" : "Download segment"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A running job emits log and progress events several times a second, and
 *  each one re-renders the page. Nothing here depends on that. */
export default memo(Trimmer);

/** A timestamp you can type into, whose label is the button that sets it to
 *  the playhead. Edits are held as text until they commit, so a half-typed
 *  "1:" is not repeatedly reparsed into a clamp jumping around. */
function TimeInput({
  label,
  value,
  onCommit,
  onSet,
}: {
  label: string;
  value: number;
  onCommit: (t: number) => void;
  onSet: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseTime(draft);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };

  return (
    <div className="trim-time">
      <button
        type="button"
        className="trim-set"
        onClick={onSet}
        title={`Set ${label} to the playhead`}
      >
        {label}
      </button>
      <input
        aria-label={label}
        value={draft ?? formatTime(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
          }
        }}
        spellCheck={false}
        inputMode="decimal"
      />
    </div>
  );
}
