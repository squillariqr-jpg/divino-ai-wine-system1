-- Rete Squillari — nightly structured shortage ingestion: run state,
-- message/row provenance, and execution lock tables.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Reviewable design
-- artifact only, on branch feat/rete-squillari-email-shortage-ingest,
-- requires its own explicit-authorization step before `supabase db push`.
--
-- This migration adds ONLY internal job-bookkeeping tables: which
-- messages/rows the nightly job has already processed, and a lock so two
-- runs never overlap. It does not touch rete_requests or
-- rete_email_arbitration_log (see 20260721120000_..., which remains the
-- single write path for actually publishing a request via
-- rete_email_arbitrate_and_publish). These tables are never exposed to
-- stores and carry no mailbox credentials, no full email bodies, and no
-- raw attachment content — only hashes, redacted identifiers, and the
-- already-extracted structured fields needed to resume/audit a run.

BEGIN;

-- 1. Execution lock — prevents two nightly runs from overlapping, and
--    recovers automatically from a crashed run once its lease expires.
--    Acquisition is a single atomic INSERT ... ON CONFLICT ... DO UPDATE
--    guarded by an expiry check, so two concurrent callers can never both
--    believe they hold the lock.
CREATE TABLE IF NOT EXISTS "public"."rete_ingest_locks" (
    "lock_name" "text" NOT NULL PRIMARY KEY,
    "owner_run_id" "uuid" NOT NULL,
    "acquired_at" timestamp with time zone NOT NULL DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL,
    "heartbeat_at" timestamp with time zone NOT NULL DEFAULT "now"()
);

ALTER TABLE "public"."rete_ingest_locks" OWNER TO "postgres";
ALTER TABLE "public"."rete_ingest_locks" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."rete_ingest_locks" FROM PUBLIC;
-- No policies for authenticated/anon at all — this table is pure internal
-- job bookkeeping, reached only via the service role or the SECURITY
-- DEFINER functions below, never from the application's own RLS-scoped
-- client roles.

CREATE OR REPLACE FUNCTION "public"."rete_ingest_lock_acquire"(
    "p_lock_name" "text",
    "p_owner_run_id" "uuid",
    "p_ttl_seconds" integer DEFAULT 1800
)
RETURNS boolean
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_acquired boolean;
BEGIN
  INSERT INTO public.rete_ingest_locks (lock_name, owner_run_id, acquired_at, expires_at, heartbeat_at)
  VALUES (p_lock_name, p_owner_run_id, now(), now() + make_interval(secs => p_ttl_seconds), now())
  ON CONFLICT (lock_name) DO UPDATE
    SET owner_run_id = EXCLUDED.owner_run_id,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at,
        heartbeat_at = EXCLUDED.heartbeat_at
    -- Only steal the lock if the existing lease has already expired.
    -- A currently-held, unexpired lock is left completely untouched.
    WHERE public.rete_ingest_locks.expires_at < now()
  RETURNING (public.rete_ingest_locks.owner_run_id = p_owner_run_id) INTO v_acquired;

  RETURN COALESCE(v_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_ingest_lock_heartbeat"(
    "p_lock_name" "text",
    "p_owner_run_id" "uuid",
    "p_ttl_seconds" integer DEFAULT 1800
)
RETURNS boolean
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_updated boolean := false;
BEGIN
  UPDATE public.rete_ingest_locks
    SET heartbeat_at = now(),
        expires_at = now() + make_interval(secs => p_ttl_seconds)
    WHERE lock_name = p_lock_name AND owner_run_id = p_owner_run_id
  RETURNING true INTO v_updated;

  RETURN COALESCE(v_updated, false);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_ingest_lock_release"(
    "p_lock_name" "text",
    "p_owner_run_id" "uuid"
)
RETURNS boolean
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_deleted boolean := false;
BEGIN
  -- Only ever releases a lock this run still actually owns. If the lease
  -- already expired and a newer run reclaimed it, this call is a safe
  -- no-op rather than releasing someone else's active lock.
  DELETE FROM public.rete_ingest_locks
    WHERE lock_name = p_lock_name AND owner_run_id = p_owner_run_id
  RETURNING true INTO v_deleted;

  RETURN COALESCE(v_deleted, false);
END;
$$;

REVOKE ALL ON FUNCTION "public"."rete_ingest_lock_acquire"("text", "uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_ingest_lock_heartbeat"("text", "uuid", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_ingest_lock_release"("text", "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."rete_ingest_lock_acquire"("text", "uuid", integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."rete_ingest_lock_heartbeat"("text", "uuid", integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."rete_ingest_lock_release"("text", "uuid") TO "service_role";

-- 2. Run metadata — one row per nightly job execution (dry-run or live).
CREATE TABLE IF NOT EXISTS "public"."rete_email_ingest_runs" (
    "run_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "mode" "text" NOT NULL,
    "started_at" timestamp with time zone NOT NULL DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "status" "text" NOT NULL DEFAULT 'RUNNING',
    "emails_scanned" integer NOT NULL DEFAULT 0,
    "messages_new" integer NOT NULL DEFAULT 0,
    "attachments_parsed" integer NOT NULL DEFAULT 0,
    "rows_analyzed" integer NOT NULL DEFAULT 0,
    "requests_created" integer NOT NULL DEFAULT 0,
    "duplicates_skipped" integer NOT NULL DEFAULT 0,
    "rows_rejected" integer NOT NULL DEFAULT 0,
    "failures" integer NOT NULL DEFAULT 0,
    "duration_ms" integer,
    "error_summary" "text",
    "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),

    CONSTRAINT "rete_email_ingest_runs_mode_check" CHECK (("mode" = ANY (ARRAY['dry-run'::"text", 'live'::"text"]))),
    CONSTRAINT "rete_email_ingest_runs_status_check" CHECK (("status" = ANY (ARRAY['RUNNING'::"text", 'COMPLETED'::"text", 'FAILED'::"text", 'LOCK_HELD'::"text"])))
);

ALTER TABLE "public"."rete_email_ingest_runs" OWNER TO "postgres";
ALTER TABLE "public"."rete_email_ingest_runs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."rete_email_ingest_runs" FROM PUBLIC;

CREATE POLICY "central reads ingest runs" ON "public"."rete_email_ingest_runs" FOR SELECT TO "authenticated"
    USING ((EXISTS ( SELECT 1 FROM "public"."rete_memberships" m
        WHERE m.user_id = auth.uid() AND m.active AND m.role = 'central')));
GRANT SELECT ON TABLE "public"."rete_email_ingest_runs" TO "authenticated";

-- 3. Message provenance — persistent processing state, independent of
--    IMAP Seen/Unseen flags. A message is "new" precisely when its hash
--    has no row here with processing_status = 'COMPLETED'. Never stores
--    the full subject, only a redacted/hashed form; never stores mailbox
--    credentials or the message body.
CREATE TABLE IF NOT EXISTS "public"."rete_email_ingest_messages" (
    "message_hash" "text" NOT NULL PRIMARY KEY,
    "message_id" "text",
    "sender" "text" NOT NULL,
    "received_at" timestamp with time zone NOT NULL,
    "subject_redacted" "text",
    "processing_status" "text" NOT NULL DEFAULT 'NEW',
    "first_seen_run_id" "uuid" REFERENCES "public"."rete_email_ingest_runs"("run_id"),
    "last_processed_run_id" "uuid" REFERENCES "public"."rete_email_ingest_runs"("run_id"),
    "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT "now"(),

    CONSTRAINT "rete_email_ingest_messages_status_check"
        CHECK (("processing_status" = ANY (ARRAY['NEW'::"text", 'PARTIALLY_PROCESSED'::"text", 'COMPLETED'::"text", 'FAILED'::"text"])))
);

ALTER TABLE "public"."rete_email_ingest_messages" OWNER TO "postgres";
ALTER TABLE "public"."rete_email_ingest_messages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."rete_email_ingest_messages" FROM PUBLIC;

CREATE POLICY "central reads ingest messages" ON "public"."rete_email_ingest_messages" FOR SELECT TO "authenticated"
    USING ((EXISTS ( SELECT 1 FROM "public"."rete_memberships" m
        WHERE m.user_id = auth.uid() AND m.active AND m.role = 'central')));
GRANT SELECT ON TABLE "public"."rete_email_ingest_messages" TO "authenticated";

-- 4. Row provenance — one row per (message, attachment, source table row,
--    resolved product, resolved store) ever evaluated. The unique index
--    below IS the source-row idempotency key required by the ingestion
--    design: the exact same row can never be recorded twice, even under a
--    concurrent/retried run, which is what makes "one bad row never stops
--    the batch, and no row is ever double-counted" a database-enforced
--    guarantee rather than only an application-level convention.
CREATE TABLE IF NOT EXISTS "public"."rete_email_ingest_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "run_id" "uuid" NOT NULL REFERENCES "public"."rete_email_ingest_runs"("run_id"),
    "message_hash" "text" NOT NULL REFERENCES "public"."rete_email_ingest_messages"("message_hash"),
    "attachment_hash" "text" NOT NULL,
    "source_filename_hash" "text",
    "source_row" integer NOT NULL,
    "internal_product_code" "text",
    "requesting_store" "text",
    "requesting_location_id" smallint,
    "source_status" "text",
    "requested_quantity" integer,
    "quantity_source" "text",
    "decision" "text" NOT NULL,
    "rejection_reason" "text",
    "request_id" "uuid",
    "retry_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),

    CONSTRAINT "rete_email_ingest_rows_decision_check" CHECK (("decision" = ANY (ARRAY[
        'WOULD_CREATE'::"text",
        'CREATED'::"text",
        'SKIPPED_EXACT_DUPLICATE'::"text",
        'SKIPPED_OPEN_REQUEST'::"text",
        'REJECTED_FILENAME_STORE'::"text",
        'REJECTED_UNKNOWN_CODE'::"text",
        'REJECTED_AMBIGUOUS_CODE'::"text",
        'REJECTED_INACTIVE_PRODUCT'::"text",
        'REJECTED_DESCRIPTION_CONFLICT'::"text",
        'REJECTED_EAN_CONFLICT'::"text",
        'REJECTED_NOT_ZERO_STOCK'::"text",
        'REJECTED_CATALOG_UNAVAILABLE'::"text",
        'REJECTED_UNSUPPORTED_ATTACHMENT'::"text",
        'FAILED_DATABASE_WRITE'::"text"
    ])))
);

-- The source-row idempotency key from Phase 7: message + attachment +
-- source table row + resolved product + resolved store. Applied only to
-- rows that could plausibly recur (a code/store pair) - every candidate
-- row still gets exactly one record per (message, attachment, row index),
-- which the second unique index below enforces unconditionally.
CREATE UNIQUE INDEX IF NOT EXISTS "rete_email_ingest_rows_source_idempotency_idx"
    ON "public"."rete_email_ingest_rows" ("message_hash", "attachment_hash", "source_row", "internal_product_code", "requesting_store");

ALTER TABLE "public"."rete_email_ingest_rows" OWNER TO "postgres";
ALTER TABLE "public"."rete_email_ingest_rows" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."rete_email_ingest_rows" FROM PUBLIC;

CREATE POLICY "central reads ingest rows" ON "public"."rete_email_ingest_rows" FOR SELECT TO "authenticated"
    USING ((EXISTS ( SELECT 1 FROM "public"."rete_memberships" m
        WHERE m.user_id = auth.uid() AND m.active AND m.role = 'central')));
GRANT SELECT ON TABLE "public"."rete_email_ingest_rows" TO "authenticated";

-- No INSERT/UPDATE/DELETE policies for authenticated/anon on any of the
-- three run-state tables - all writes happen via the service role from
-- the nightly job process itself, never from a browser/application
-- session, and never seen by stores (central-only SELECT above).

COMMIT;
