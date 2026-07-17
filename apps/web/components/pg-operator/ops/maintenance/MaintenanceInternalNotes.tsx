"use client";

import { useState } from "react";
import { Button } from "@cribliv/ui";
import type {
  PgMaintenanceInternalNoteResponse,
  PgMaintenanceRequest
} from "@cribliv/shared-types";
import { Loader2 } from "lucide-react";
import { addMaintenanceInternalNote } from "@/lib/pg-operations-api";
import { useToast } from "@/components/ui/toast/use-toast";
import { createMaintenanceUploadId } from "./useMaintenancePhotoUpload";
import styles from "../MaintenanceWorkspace.module.css";

type InternalNoteSubmission = {
  body: string;
  idempotencyKey: string;
  optimisticNote: PgMaintenanceInternalNoteResponse;
};

export default function MaintenanceInternalNotes({
  request,
  propertyId,
  token,
  onCreated,
  onRollback
}: {
  request: PgMaintenanceRequest;
  propertyId: string;
  token: string;
  onCreated: (note: PgMaintenanceInternalNoteResponse, replaceId?: string) => void;
  onRollback: (noteId: string) => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(retrySubmission?: InternalNoteSubmission) {
    if (pending) return;
    const trimmed = retrySubmission?.body ?? body.trim();
    if (!trimmed) {
      setError("Enter an internal note.");
      return;
    }
    const idempotencyKey = retrySubmission?.idempotencyKey ?? createMaintenanceUploadId();
    const optimisticNote =
      retrySubmission?.optimisticNote ??
      ({
        id: `optimistic-note-${idempotencyKey}`,
        request_id: request.id,
        author_user_id: null,
        author_role: "pg_operator",
        visibility: "operator_internal",
        body: trimmed,
        attachments: [],
        attachment_urls: [],
        created_at: new Date().toISOString()
      } satisfies PgMaintenanceInternalNoteResponse);
    const submission: InternalNoteSubmission = {
      body: trimmed,
      idempotencyKey,
      optimisticNote
    };

    setPending(true);
    setError(null);
    onCreated(optimisticNote);
    try {
      const created = await addMaintenanceInternalNote(
        propertyId,
        request.id,
        { body: trimmed },
        token,
        idempotencyKey
      );
      setBody("");
      onCreated(created, optimisticNote.id);
      toast.success(`Added internal note to ticket ${request.id}`);
    } catch {
      onRollback(optimisticNote.id);
      toast.error(`Could not add internal note to ticket ${request.id}.`, {
        action: { label: "Retry", onClick: () => void submit(submission) }
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.internalNotes} aria-label="Internal notes">
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <label className={styles.commentForm}>
        <span>Internal note</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          disabled={pending}
        />
      </label>
      <div className={styles.formActions}>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void submit()}>
          {pending ? <Loader2 size={16} className={styles.spin} /> : null}
          Add internal note
        </Button>
      </div>
    </section>
  );
}
