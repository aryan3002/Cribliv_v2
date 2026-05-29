import { terminationCopy } from "@/lib/pg-termination-copy";

export interface SessionEndedEvent {
  draft_id: string;
  listing_id: string | null;
  reason: string;
}
export interface HandlerDeps {
  toast: { show: (args: { title: string; body: string; tone: string }) => void };
}

export function handleSessionEnded(ev: SessionEndedEvent, deps: HandlerDeps) {
  const c = terminationCopy(ev.reason);
  if (c.silent) return;
  deps.toast.show({ title: c.title, body: c.body, tone: c.tone });
}
