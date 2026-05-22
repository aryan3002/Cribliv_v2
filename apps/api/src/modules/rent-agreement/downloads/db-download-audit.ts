// DB-backed download audit recorder. Replaces `makeNoopAuditRecorder()` when the
// database is enabled. Writes one row per claimed download to
// `rent_agreement_downloads` (IP is already hashed by DownloadsService).

import type { DatabaseService } from "../../../common/database.service";
import type { DownloadAuditRecord, RecordDownloadAudit } from "./downloads.service";

export function makeDbDownloadAuditRecorder(db: DatabaseService): RecordDownloadAudit {
  return async (record: DownloadAuditRecord): Promise<void> => {
    await db.query(
      `INSERT INTO rent_agreement_downloads
         (agreement_id, ip_hash, user_agent, sas_expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        record.agreement_id,
        record.ip_hash,
        record.user_agent,
        record.sas_expires_at.toISOString(),
        record.created_at.toISOString()
      ]
    );
  };
}
