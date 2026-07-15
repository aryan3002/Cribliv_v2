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

export default function MaintenanceInternalNotes({
  request,
  propertyId,
  token,
  onCreated
}: {
  request: PgMaintenanceRequest;
  propertyId: string;
  token: string;
  onCreated: (note: PgMaintenanceInternalNoteResponse) => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Enter an internal note.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await addMaintenanceInternalNote(
        propertyId,
        request.id,
        { body: trimmed },
        token,
        createMaintenanceUploadId()
      );
      setBody("");
      onCreated(created);
      toast.success(`Added internal note to ticket ${request.id}`);
    } catch {
      toast.error(`Could not add internal note to ticket ${request.id}.`, {
        action: { label: "Retry", onClick: () => void submit() }
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
