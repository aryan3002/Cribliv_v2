interface Props {
  onDescribe: () => void;
  onManual: () => void;
  error?: string | null;
}

export function CaptureEntry({ onDescribe, onManual, error }: Props) {
  return (
    <div className="card capture-entry">
      <div className="capture-entry__header">
        <h2 className="capture-entry__title">How would you like to create your listing?</h2>
        <p className="caption" style={{ margin: 0, color: "var(--text-secondary)" }}>
          Nothing is published until you submit.
        </p>
      </div>

      <button
        type="button"
        className="capture-entry__option capture-entry__option--voice"
        onClick={onDescribe}
      >
        <span className="capture-entry__icon" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="1" width="6" height="14" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="21" x2="12" y2="17" />
            <line x1="8" y1="21" x2="16" y2="21" />
          </svg>
        </span>
        <span className="capture-entry__text">
          <strong>Describe your property</strong>
          <span className="caption">Speak naturally &mdash; our AI will fill the form for you</span>
        </span>
        <span className="capture-entry__badge">AI-Powered</span>
      </button>

      <button type="button" className="capture-entry__option" onClick={onManual}>
        <span className="capture-entry__icon" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </span>
        <span className="capture-entry__text">
          <strong>Fill manually</strong>
          <span className="caption">Step-by-step form with all fields</span>
        </span>
      </button>

      {error ? <p className="alert alert--error">{error}</p> : null}
    </div>
  );
}
