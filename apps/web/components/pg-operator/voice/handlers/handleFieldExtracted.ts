import type { PgWizardAction } from "@/lib/pg-wizard-state";

export interface FieldExtractedEvent {
  field: string;
  value: unknown;
  confidence: number;
  draft_id: string;
}
export interface HandlerDeps {
  dispatch: (a: PgWizardAction) => void;
  onTranscriptLine?: (line: string) => void;
}

export function handleFieldExtracted(ev: FieldExtractedEvent, deps: HandlerDeps) {
  let value = ev.value;
  if (ev.field.endsWith("_paise") && typeof value === "number" && value < 100_000 && value > 0) {
    value = value * 100; // defensive: agent may pass rupees by mistake
  }
  deps.dispatch({ type: "VOICE_EXTRACTED", field: ev.field, value, confidence: ev.confidence });
  deps.onTranscriptLine?.(`Filled ${ev.field}: ${JSON.stringify(value)}`);
}
