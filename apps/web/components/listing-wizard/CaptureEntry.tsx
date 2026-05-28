interface Props {
  onDescribe: () => void;
  onManual: () => void;
  error?: string | null;
}

export function CaptureEntry({ onDescribe, onManual, error }: Props) {
  return (
    <div className="capture-entry">
      <div className="capture-entry__header">
        <span className="capture-entry__step-label">Step 1 of 5</span>
        <h2 className="capture-entry__title">How would you like to create your listing?</h2>
        <p className="capture-entry__subtitle">
          Choose a method below. Nothing is published until you review and submit.
        </p>
      </div>

      <div className="capture-entry__options">
        <button
          type="button"
          className="capture-entry__option capture-entry__option--voice"
          onClick={onDescribe}
        >
          <div className="capture-entry__option-icon capture-entry__option-icon--brand">
            <svg
              width="24"
              height="24"
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
          </div>
          <div className="capture-entry__option-content">
            <div className="capture-entry__option-title-row">
              <strong>Describe with voice</strong>
              <span className="capture-entry__badge">AI-Powered</span>
            </div>
            <span className="capture-entry__option-desc">
              Speak naturally for 60 seconds — our AI extracts all details and fills the form for
              you.
            </span>
          </div>
          <svg
            className="capture-entry__arrow"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        <button type="button" className="capture-entry__option" onClick={onManual}>
          <div className="capture-entry__option-icon">
            <svg
              width="24"
              height="24"
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
          </div>
          <div className="capture-entry__option-content">
            <strong>Fill manually</strong>
            <span className="capture-entry__option-desc">
              Step-by-step form — type, location, rent, photos. Full control over every field.
            </span>
          </div>
          <svg
            className="capture-entry__arrow"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
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
