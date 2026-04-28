// Concierge stylesheet — must be imported once for the wizard to look right.
import "./concierge.css";

// New concierge components
export { VoiceCoPilot } from "./VoiceCoPilot";
export { VoiceOrb } from "./VoiceOrb";

// Restyled core wizard pieces
export { WizardStepIndicator } from "./WizardStepIndicator";
export { BasicsStep } from "./BasicsStep";
export { LocationStep } from "./LocationStep";
export { DetailsStep } from "./DetailsStep";
export { TitleDescriptionStep } from "./TitleDescriptionStep";
export { PhotosStep } from "./PhotosStep";
export { ReviewStep } from "./ReviewStep";

// Legacy exports — kept so any other route importing them keeps building.
// They are no longer used by the new listing wizard.
export { CaptureEntry } from "./CaptureEntry";
export { VoiceRecordingPanel } from "./VoiceRecordingPanel";
export { CaptureConfirmation } from "./CaptureConfirmation";
export { VoiceAgentPanel } from "./VoiceAgentPanel";
export { VoiceAgentInline, VoiceMicButton } from "./VoiceAgentInline";

export * from "./types";
