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

  return (
    <div className="card capture-recorder">
      <div className="capture-recorder__header">
        <div className="capture-recorder__pulse" aria-hidden="true" />
        <h3>Voice recording</h3>
      </div>
      <p className="caption">
        Speak naturally for up to 60 seconds. Describe your property — type, location, rent, rooms,
        amenities.
      </p>

      <div className="capture-recorder__progress">
        <div className="capture-recorder__bar">
          <div className="capture-recorder__bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="capture-recorder__timer">
          {minutes}:{secs} / 01:00
        </p>
      </div>

      <div className="capture-recorder__waveform" aria-hidden="true">
        {Array.from({ length: 20 }).map((_, i) => (
          <span
            key={i}
            className="capture-recorder__wave-bar"
            style={{
              animationDelay: `${i * 0.05}s`,
              height: isProcessing ? "4px" : undefined
            }}
          />
        ))}
      </div>

      <div className="capture-recorder__actions">
        <button type="button" className="btn btn--primary" onClick={onStop} disabled={isProcessing}>
          {isProcessing ? (
            <>
              <span className="btn-spinner" aria-hidden="true" /> Processing...
            </>
          ) : (
            "Stop & Continue"
          )}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onManual}
          disabled={isProcessing}
        >
          Fill Manually
        </button>
      </div>

      {error ? <p className="alert alert--error">{error}</p> : null}
    </div>
  );
}
