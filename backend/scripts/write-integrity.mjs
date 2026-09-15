import { writeFileSync } from 'node:fs';
const statements = [];
for (const table of ['audit_logs', 'inventory_movements', 'quote_redemptions', 'payment_allocations']) {
  for (const operation of ['UPDATE', 'DELETE']) statements.push(`CREATE TRIGGER ${table}_immutable_${operation.toLowerCase()} BEFORE ${operation} ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Append-only table';`);
}
statements.push(`CREATE TRIGGER journal_draft_insert BEFORE INSERT ON journal_entries FOR EACH ROW BEGIN IF NEW.status <> 'DRAFT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Create journal as DRAFT'; END IF; END;`);
statements.push(`CREATE TRIGGER journal_post_update BEFORE UPDATE ON journal_entries FOR EACH ROW BEGIN
DECLARE line_count INT; DECLARE total_debit DECIMAL(38,0); DECLARE total_credit DECIMAL(38,0);
IF OLD.status = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal is immutable'; END IF;
IF NEW.status = 'POSTED' THEN
SELECT COUNT(*), COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO line_count,total_debit,total_credit FROM journal_lines WHERE journal_entry_id = OLD.id;
IF line_count < 2 OR total_debit <> total_credit THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unbalanced journal'; END IF;
END IF; END;`);
statements.push(`CREATE TRIGGER journal_delete BEFORE DELETE ON journal_entries FOR EACH ROW BEGIN IF OLD.status = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal is immutable'; END IF; END;`);
for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
  const row = operation === 'DELETE' ? 'OLD' : 'NEW';
  statements.push(`CREATE TRIGGER journal_lines_${operation.toLowerCase()} BEFORE ${operation} ON journal_lines FOR EACH ROW BEGIN
DECLARE parent_state VARCHAR(32);
${operation === 'UPDATE' ? "IF NEW.journal_entry_id <> OLD.journal_entry_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot move journal line'; END IF;" : ''}
SELECT status INTO parent_state FROM journal_entries WHERE id = ${row}.journal_entry_id FOR UPDATE;
IF parent_state = 'POSTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal lines are immutable'; END IF; END;`);
}
for (const [table, provider] of [['payment_attempts','MIDTRANS'],['shipments','BITESHIP'],['shipping_quotes','BITESHIP']]) {
  for (const operation of ['INSERT','UPDATE']) statements.push(`CREATE TRIGGER ${table}_provider_${operation.toLowerCase()} BEFORE ${operation} ON ${table} FOR EACH ROW BEGIN
DECLARE provider_name VARCHAR(32); SELECT provider INTO provider_name FROM provider_accounts WHERE id = NEW.provider_account_id;
IF provider_name <> '${provider}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provider domain mismatch'; END IF; END;`);
}
writeFileSync('src/database/migrations/0003_transaction_integrity.sql', statements.join('\n--> statement-breakpoint\n'));
