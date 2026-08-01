-- Adds item_code (Vastra's itemTypeID) to the stock and source tables.
-- Non-destructive — run this against an existing database instead of
-- re-applying schema.sql, which drops every table.
--
--   mysql -h HOST -u USER -p DBNAME < server/migrations/add-item-code.sql
--
-- Existing rows get '' and are backfilled by the app the next time an add or
-- move merges a coded line into them. Re-running this errors with
-- ER_DUP_FIELDNAME (1060), which just means it is already applied.

ALTER TABLE item_location
  ADD COLUMN item_code VARCHAR(60) NOT NULL DEFAULT '' AFTER item;

ALTER TABLE source_transaction
  ADD COLUMN item_code VARCHAR(60) NOT NULL DEFAULT '' AFTER item;
