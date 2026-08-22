-- =============================================================================
-- Row Level Security, integrity constraints, and the credit functions.
--
-- Everything here is outside Prisma's schema language: FKs into Supabase's
-- `auth` schema, CHECK constraints, RLS policies, triggers, and plpgsql.
-- Prisma applies this file verbatim and does not try to manage its contents,
-- so `prisma migrate dev` will never drop these objects.
--
-- Threat model: the browser holds a Supabase `anon` key and, once signed in,
-- acts as `authenticated`. It talks to PostgREST directly. Anything not
-- explicitly granted and policied here is reachable by a hostile client, so
-- the default posture is deny and only SELECT-on-own-rows is opened up.
-- The backend uses the service_role key, which has BYPASSRLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Link public.users to Supabase auth, and keep it in sync
-- -----------------------------------------------------------------------------

-- NO FOREIGN KEY to auth.users, deliberately. Triggers instead.
--
-- A real FK (public.users.id -> auth.users.id ON DELETE CASCADE) is the
-- obvious modelling choice and it works at runtime, but it makes
-- `prisma migrate dev` unusable: Prisma introspects the shadow database after
-- replaying migrations and rejects the cross-schema reference with
--   P4002 ... `public.users` points to `auth.users` in constraint
--   `users_id_fkey`. Please add `auth` to your `schemas` property
--
-- Satisfying that demand means enabling the `multiSchema` preview feature and
-- listing `auth` as a managed schema — at which point Prisma believes it owns
-- auth.users and will happily generate `DROP TABLE auth.users` against a real
-- Supabase project, because that table is not in schema.prisma. Losing one
-- constraint is a far smaller risk than handing Prisma a loaded gun pointed at
-- Supabase's auth table.
--
-- The two behaviours the FK would have given us are reproduced below:
--   * rows cannot outlive their auth user  -> AFTER DELETE trigger
--   * rows cannot exist without one        -> public.users is only ever written
--                                             by the AFTER INSERT trigger and
--                                             service_role
-- What is genuinely lost is enforcement against a direct bad INSERT by
-- service_role. That is an API-layer concern, not a client-reachable one.

CREATE OR REPLACE FUNCTION public.handle_deleted_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Mirrors ON DELETE CASCADE. Note that payments.user_id is ON DELETE
  -- RESTRICT, so deleting a user who has payment history raises here and
  -- aborts the auth.users delete too — which is the intended behaviour:
  -- settle or anonymise the payments first.
  DELETE FROM public.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_deleted_auth_user();

-- Signup provisioning. A user with no wallet is a broken account: the first
-- deduct_credits() call would fail on a missing row. Creating both in one
-- trigger makes "user exists" and "wallet exists" the same event.
--
-- SECURITY DEFINER because the trigger runs as the auth system's role, which
-- has no rights on public. search_path is pinned: an unpinned search_path in a
-- SECURITY DEFINER function is a privilege-escalation vector.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, updated_at)
  VALUES (
    NEW.id,
    lower(NEW.email),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.credit_wallets (id, user_id, balance_credits, updated_at)
  VALUES (gen_random_uuid(), NEW.id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 2. updated_at maintenance
-- -----------------------------------------------------------------------------
-- Prisma's @updatedAt only fires for writes made through the Prisma client.
-- The credit functions below write via plain SQL, so the guarantee has to live
-- in the database or updated_at silently goes stale.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.credit_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Integrity constraints Prisma cannot express
-- -----------------------------------------------------------------------------

-- The ledger's sign convention, enforced by the database rather than by
-- convention. This is what makes SUM(amount) a trustworthy balance: a
-- deduction that was accidentally written positive would otherwise silently
-- inflate the balance.
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_amount_sign_ck CHECK (
    (type = 'deposit'   AND amount > 0) OR
    (type = 'refund'    AND amount > 0) OR
    (type = 'deduction' AND amount < 0)
  );

-- Cross-field attribution: a movement may only carry the reference that makes
-- sense for its type. A deposit is payment-attributed and must not name a task;
-- a deduction or refund is task-attributed and must not name a payment.
--
-- Note what this deliberately does NOT require: a deposit may have a NULL
-- related_payment_id. That is the operator grant path — hand-crediting a tester
-- or issuing goodwill credits without inventing a fake Payment row. Such a
-- deposit is intentionally unattributed, and `SELECT * FROM wallet_transactions
-- WHERE type = 'deposit' AND related_payment_id IS NULL` is the audit query
-- that lists every credit granted outside a real sale.
--
-- Deposits that DO originate from a sale are linked by the payment crediting
-- path, which always passes the payment id; nothing here weakens that.
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_attribution_ck CHECK (
    (type = 'deposit' AND related_task_id IS NULL) OR
    (type IN ('deduction', 'refund') AND related_payment_id IS NULL)
  );

ALTER TABLE public.credit_wallets
  ADD CONSTRAINT credit_wallets_balance_non_negative_ck CHECK (balance_credits >= 0);

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_duration_positive_ck CHECK (video_duration_seconds > 0);
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_credits_cost_non_negative_ck CHECK (credits_cost >= 0);
-- A FAILED task must say why; a non-FAILED task must not carry a stale reason.
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_error_message_ck CHECK (
    (status = 'FAILED' AND error_message IS NOT NULL) OR
    (status <> 'FAILED' AND error_message IS NULL)
  );

ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_positive_ck CHECK (amount_dzd > 0);
ALTER TABLE public.payments
  ADD CONSTRAINT payments_credits_positive_ck CHECK (credits_purchased > 0);

-- -----------------------------------------------------------------------------
-- 4. Reconciliation view — proves the cached balance still matches the ledger
-- -----------------------------------------------------------------------------
-- Should always return zero rows. Alert if it ever does not: a non-empty
-- result means a code path wrote balance_credits without a ledger row, which
-- is the exact failure the ledger exists to detect.

CREATE OR REPLACE VIEW public.wallet_balance_drift AS
SELECT
  w.id                                        AS wallet_id,
  w.user_id,
  w.balance_credits                           AS cached_balance,
  COALESCE(SUM(t.amount), 0)::numeric(10, 2)  AS ledger_balance,
  w.balance_credits - COALESCE(SUM(t.amount), 0) AS drift
FROM public.credit_wallets w
LEFT JOIN public.wallet_transactions t ON t.wallet_id = w.id
GROUP BY w.id, w.user_id, w.balance_credits
HAVING w.balance_credits <> COALESCE(SUM(t.amount), 0);

-- -----------------------------------------------------------------------------
-- 5. Credit functions
-- -----------------------------------------------------------------------------

-- Atomically spend credits.
--
-- Returns TRUE when the credits were spent, FALSE when the balance is
-- insufficient. Insufficient funds is an expected business outcome, not an
-- error: raising here would abort the caller's whole transaction and force the
-- API to distinguish "declined" from "database broke" by parsing error text.
--
-- Concurrency: SELECT ... FOR UPDATE takes a row lock before the balance is
-- read, so two simultaneous requests for the same wallet serialise. Without
-- that lock both could read the same balance, both see it as sufficient, and
-- both deduct — spending the same credits twice. The lock is the entire reason
-- this is a database function rather than application code.
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_wallet_id uuid,
  p_amount    numeric,
  p_task_id   uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric(10, 2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'deduct_credits: amount must be positive (got %)', p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT balance_credits INTO v_balance
  FROM public.credit_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'deduct_credits: wallet % does not exist', p_wallet_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Declined, not broken. The caller turns this into a 402.
  IF v_balance < p_amount THEN
    RETURN false;
  END IF;

  INSERT INTO public.wallet_transactions (id, wallet_id, amount, type, related_task_id)
  VALUES (gen_random_uuid(), p_wallet_id, -p_amount, 'deduction', p_task_id);

  UPDATE public.credit_wallets
  SET balance_credits = balance_credits - p_amount
  WHERE id = p_wallet_id;

  RETURN true;
END;
$$;

-- Atomically return credits, normally after a task failed.
--
-- Returns TRUE on success, FALSE when the refund would exceed what was actually
-- deducted for that task. That cap is what makes the function safe to call from
-- a retryable code path: a worker that fails, retries and fails again must not
-- be able to refund twice for one deduction. Without a task id there is nothing
-- to reconcile against, so the cap cannot be applied and the caller is
-- responsible for correctness.
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_wallet_id uuid,
  p_amount    numeric,
  p_task_id   uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exists      boolean;
  v_net_spent   numeric(10, 2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'refund_credits: amount must be positive (got %)', p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  -- Same lock ordering as deduct_credits: always the wallet row first.
  SELECT true INTO v_exists
  FROM public.credit_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_credits: wallet % does not exist', p_wallet_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_task_id IS NOT NULL THEN
    -- Net movement for this task: deductions are negative, refunds positive,
    -- so -SUM() is what is still outstanding and therefore refundable.
    SELECT COALESCE(-SUM(amount), 0) INTO v_net_spent
    FROM public.wallet_transactions
    WHERE wallet_id = p_wallet_id
      AND related_task_id = p_task_id;

    IF p_amount > v_net_spent THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO public.wallet_transactions (id, wallet_id, amount, type, related_task_id)
  VALUES (gen_random_uuid(), p_wallet_id, p_amount, 'refund', p_task_id);

  UPDATE public.credit_wallets
  SET balance_credits = balance_credits + p_amount
  WHERE id = p_wallet_id;

  RETURN true;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Lock down the ledger
-- -----------------------------------------------------------------------------
-- An append-only table you can UPDATE is not append-only. Revoked from every
-- role, service_role included: corrections are made by appending a
-- compensating row, which keeps the audit trail intact. BYPASSRLS does not
-- bypass table privileges, so this genuinely binds the backend too.

REVOKE UPDATE, DELETE, TRUNCATE ON public.wallet_transactions FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.wallet_transactions FROM anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_wallets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments            ENABLE ROW LEVEL SECURITY;
-- Not in the brief, but a public-schema table with RLS disabled is exposed
-- through PostgREST to anyone holding the anon key. Raw webhook payloads
-- contain provider metadata and customer detail. Enabled with NO policies at
-- all, so only the BYPASSRLS backend can read it.
ALTER TABLE public.webhook_events      ENABLE ROW LEVEL SECURITY;

-- Start from zero privileges rather than trusting Supabase's defaults, which
-- grant broadly to anon/authenticated on the public schema.
REVOKE ALL ON public.users               FROM anon, authenticated;
REVOKE ALL ON public.credit_wallets      FROM anon, authenticated;
REVOKE ALL ON public.wallet_transactions FROM anon, authenticated;
REVOKE ALL ON public.tasks               FROM anon, authenticated;
REVOKE ALL ON public.payments            FROM anon, authenticated;
REVOKE ALL ON public.webhook_events      FROM anon, authenticated;
REVOKE ALL ON public.wallet_balance_drift FROM anon, authenticated;

-- Signed-in users may READ their own rows and nothing else. Every write path
-- (creating tasks, crediting wallets, recording payments) goes through the API
-- on the service_role connection, where business rules and pricing are applied.
-- There is deliberately no INSERT, UPDATE or DELETE policy anywhere below:
-- with RLS enabled, an operation with no matching policy is denied.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON public.users               TO authenticated;
GRANT SELECT ON public.credit_wallets      TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT SELECT ON public.tasks               TO authenticated;
GRANT SELECT ON public.payments            TO authenticated;

-- The backend's own privileges, granted EXPLICITLY rather than inherited from
-- Supabase's default-privilege setup. BYPASSRLS exempts service_role from row
-- level security but NOT from table privileges, so the broad REVOKEs above
-- would otherwise leave the API unable to read its own tables. Relying on
-- Supabase defaults also breaks the moment this schema is applied to a plain
-- Postgres (local dev, CI, a self-hosted deployment).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_wallets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_events TO service_role;

-- Ledger: append and read only. Deliberately no UPDATE/DELETE, which is what
-- keeps section 6's revocation meaningful for the backend as well.
GRANT SELECT, INSERT ON public.wallet_transactions TO service_role;

GRANT SELECT ON public.wallet_balance_drift TO service_role;

CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY credit_wallets_select_own ON public.credit_wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Ownership is one hop away, via the wallet.
CREATE POLICY wallet_transactions_select_own ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.credit_wallets w
      WHERE w.id = wallet_transactions.wallet_id
        AND w.user_id = auth.uid()
    )
  );

CREATE POLICY tasks_select_own ON public.tasks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY payments_select_own ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 8. Function privileges
-- -----------------------------------------------------------------------------
-- These are SECURITY DEFINER and move money. Exposing them to `authenticated`
-- would let any signed-in user call deduct_credits() or, worse,
-- refund_credits() on their own wallet straight from the browser.

REVOKE ALL ON FUNCTION public.deduct_credits(uuid, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_credits(uuid, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deduct_credits(uuid, numeric, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_credits(uuid, numeric, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, numeric, uuid) TO service_role;

COMMENT ON FUNCTION public.deduct_credits(uuid, numeric, uuid) IS
  'Atomically spend credits. Returns false on insufficient funds (a normal outcome, not an error). Locks the wallet row FOR UPDATE. service_role only.';
COMMENT ON FUNCTION public.refund_credits(uuid, numeric, uuid) IS
  'Atomically return credits. Returns false if the refund would exceed the net amount deducted for the given task. service_role only.';
COMMENT ON VIEW public.wallet_balance_drift IS
  'Reconciliation: rows where the cached wallet balance disagrees with SUM(ledger). Should always be empty.';
