/**
 * Shared contract for every Step{N}Form component.
 *
 * Each step form collects its fields locally (useState/useReducer — no form
 * library), validates with its Zod schema, and on success calls `onSubmit`
 * with the parsed payload. The parent step page wires `onSubmit` to the
 * advance-step mutation.
 */
export interface StepFormProps {
  /** The draft id — only Step6Form (signature upload) needs it. */
  agreementId: string;
  /** Called with the validated payload when the user advances. */
  onSubmit: (payload: unknown) => Promise<void>;
  /** True while the advance request is in flight — disables the submit button. */
  busy?: boolean;
}
