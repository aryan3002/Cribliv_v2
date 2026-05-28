interface Props {
  seconds: number;
  isProcessing: boolean;
  error?: string | null;
  onStop: () => void;
  onManual: () => void;
}

export function VoiceRecordingPanel({ seconds, isProcessing, error, onStop, onManual }: Props) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  const progress = Math.min((seconds / 60) * 100, 100);
  const remaining = 60 - seconds;

  return (
    <div className="capture-recorder">
      {/* Status badge */}
      <div className="capture-recorder__status">
        <span
          className={`capture-recorder__status-dot ${isProcessing ? "capture-recorder__status-dot--processing" : ""}`}
        />
        <span className="capture-recorder__status-label">
          {isProcessing ? "Processing your recording…" : "Listening — speak now"}
        </span>
      </div>

      {/* Timer ring */}
      <div className="capture-recorder__ring-wrap">
        <svg className="capture-recorder__ring" width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r="72" fill="none" stroke="var(--border)" strokeWidth="6" />
          <circle
            cx="80"
            cy="80"
            r="72"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 72}`}
            strokeDashoffset={`${2 * Math.PI * 72 * (1 - progress / 100)}`}
            style={{
              transition: "stroke-dashoffset 1s linear",
              transform: "rotate(-90deg)",
              transformOrigin: "center"
            }}
          />
        </svg>
        <div className="capture-recorder__ring-inner">
          <span className="capture-recorder__timer">
            {minutes}:{secs}
          </span>
          <span className="capture-recorder__timer-hint">{remaining}s left</span>
        </div>
      </div>

      {/* Waveform */}
      <div className="capture-recorder__waveform" aria-hidden="true">
        {Array.from({ length: 32 }).map((_, i) => (
          <span
            key={i}
            className="capture-recorder__wave-bar"
            style={{
              animationDelay: `${i * 0.04}s`,
              height: isProcessing ? "3px" : undefined
            }}
          />
        ))}
      </div>

      {/* Hint */}
      <p className="capture-recorder__hint">
        Describe type, location, rent, rooms &amp; amenities — the AI fills the rest.
      </p>

      {/* Progress bar (subtle) */}
      <div className="capture-recorder__bar">
        <div className="capture-recorder__bar-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Actions */}
      <div className="capture-recorder__actions">
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={onStop}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <>
              <span className="btn-spinner" aria-hidden="true" /> Analysing…
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop &amp; Continue
            </>
          )}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onManual} disabled={isProcessing}>
          Switch to manual
        </button>
      </div>

      {error ? (
        <p className="alert alert--error" style={{ marginTop: 16 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
