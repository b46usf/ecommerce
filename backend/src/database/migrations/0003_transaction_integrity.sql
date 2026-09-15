CREATE TRIGGER audit_logs_immutable_update BEFORE UPDATE ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable_delete BEFORE DELETE ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER inventory_movements_immutable_update BEFORE UPDATE ON inventory_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER inventory_movements_immutable_delete BEFORE DELETE ON inventory_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER quote_redemptions_immutable_update BEFORE UPDATE ON quote_redemptions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER quote_redemptions_immutable_delete BEFORE DELETE ON quote_redemptions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER payment_allocations_immutable_update BEFORE UPDATE ON payment_allocations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER payment_allocations_immutable_delete BEFORE DELETE ON payment_allocations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';
--> statement-breakpoint
CREATE TRIGGER journal_draft_insert BEFORE INSERT ON journal_entries FOR EACH ROW BEGIN IF NEW.status <> 'DRAFT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Create journal as DRAFT'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER journal_post_update BEFORE UPDATE ON journal_entries FOR EACH ROW BEGIN
DECLARE line_count INT; DECLARE total_debit DECIMAL(38,0); DECLARE total_credit DECIMAL(38,0);
IF OLD.status = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal is immutable'; END IF;
IF NEW.status = 'POSTED' THEN
SELECT COUNT(*), COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO line_count,total_debit,total_credit FROM journal_lines WHERE journal_entry_id = OLD.id;
IF line_count < 2 OR total_debit <> total_credit THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unbalanced journal'; END IF;
END IF; END;
--> statement-breakpoint
CREATE TRIGGER journal_delete BEFORE DELETE ON journal_entries FOR EACH ROW BEGIN IF OLD.status = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER journal_lines_insert BEFORE INSERT ON journal_lines FOR EACH ROW BEGIN
DECLARE parent_state VARCHAR(32);

SELECT status INTO parent_state FROM journal_entries WHERE id = NEW.journal_entry_id FOR UPDATE;
IF parent_state = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal lines are immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER journal_lines_update BEFORE UPDATE ON journal_lines FOR EACH ROW BEGIN
DECLARE parent_state VARCHAR(32);
IF NEW.journal_entry_id <> OLD.journal_entry_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot move journal line'; END IF;
SELECT status INTO parent_state FROM journal_entries WHERE id = NEW.journal_entry_id FOR UPDATE;
IF parent_state = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal lines are immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER journal_lines_delete BEFORE DELETE ON journal_lines FOR EACH ROW BEGIN
DECLARE parent_state VARCHAR(32);

SELECT status INTO parent_state FROM journal_entries WHERE id = OLD.journal_entry_id FOR UPDATE;
IF parent_state = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal lines are immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER payment_attempts_provider_insert BEFORE INSERT ON payment_attempts FOR EACH ROW BEGIN
DECLARE provider_name VARCHAR(32); SELECT provider INTO provider_name FROM provider_accounts WHERE id = NEW.provider_account_id;
IF provider_name <> 'MIDTRANS' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provider domain mismatch'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER payment_attempts_provider_update BEFORE UPDATE ON payment_attempts FOR EACH ROW BEGIN
DECLARE provider_name VARCHAR(32); SELECT provider INTO provider_name FROM provider_accounts WHERE id = NEW.provider_account_id;
IF provider_name <> 'MIDTRANS' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provider domain mismatch'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER shipments_provider_insert BEFORE INSERT ON shipments FOR EACH ROW BEGIN
DECLARE provider_name VARCHAR(32); SELECT provider INTO provider_name FROM provider_accounts WHERE id = NEW.provider_account_id;
IF provider_name <> 'BITESHIP' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provider domain mismatch'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER shipments_provider_update BEFORE UPDATE ON shipments FOR EACH ROW BEGIN
DECLARE provider_name VARCHAR(32); SELECT provider INTO provider_name FROM provider_accounts WHERE id = NEW.provider_account_id;
IF provider_name <> 'BITESHIP' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provider domain mismatch'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER shipping_quotes_provider_insert BEFORE INSERT ON shipping_quotes FOR EACH ROW BEGIN
DECLARE provider_name VARCHAR(32); SELECT provider INTO provider_name FROM provider_accounts WHERE id = NEW.provider_account_id;
IF provider_name <> 'BITESHIP' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provider domain mismatch'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER shipping_quotes_provider_update BEFORE UPDATE ON shipping_quotes FOR EACH ROW BEGIN
DECLARE provider_name VARCHAR(32); SELECT provider INTO provider_name FROM provider_accounts WHERE id = NEW.provider_account_id;
IF provider_name <> 'BITESHIP' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provider domain mismatch'; END IF; END;