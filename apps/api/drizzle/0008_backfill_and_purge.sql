-- Daily claim cooldown is now stored per wallet.
UPDATE wallets SET next_daily_claim_at = last_daily_claim_at + interval '24 hours'
  WHERE last_daily_claim_at IS NOT NULL;
--> statement-breakpoint
-- Backfill the play counters from the ledger.
UPDATE wallets w SET
  lifetime_profit = s.profit,
  total_wagered = s.wagered,
  biggest_win = s.biggest
FROM (
  SELECT user_id,
    COALESCE(SUM(amount) FILTER (WHERE type IN ('bet', 'payout', 'refund')), 0) AS profit,
    COALESCE(-SUM(amount) FILTER (WHERE type = 'bet'), 0) AS wagered,
    COALESCE(MAX(amount) FILTER (WHERE type = 'payout'), 0) AS biggest
  FROM transactions GROUP BY user_id
) s
WHERE s.user_id = w.user_id;
--> statement-breakpoint
-- This week's profit (weeks start Monday 00:00 UTC; week 0 began 1970-01-05).
UPDATE wallets w SET
  week_key = floor((extract(epoch FROM now()) - 345600) / 604800)::int,
  week_profit = COALESCE(s.profit, 0)
FROM (
  SELECT user_id, SUM(amount) AS profit FROM transactions
  WHERE type IN ('bet', 'payout', 'refund')
    AND created_at >= to_timestamp(345600 + floor((extract(epoch FROM now()) - 345600) / 604800) * 604800)
  GROUP BY user_id
) s
WHERE s.user_id = w.user_id;
--> statement-breakpoint
-- The ledger stays append-only, except inside a purge transaction that sets snk.purge = 'on'
-- (used only to remove guests and all their data). UPDATE is never allowed.
CREATE OR REPLACE FUNCTION transactions_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('snk.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'transactions is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
