import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { journalEntries, journalLines, ledgerAccounts } from '../../database/schema.js';
import type { Database, DatabaseTransaction } from '../../database/index.js';
import { AppError } from '../../shared/errors.js';

export interface PostingLine { accountId: string; vendorOrderId?: string; debit: bigint; credit: bigint }
export async function ensureAccount(tx: DatabaseTransaction, code: string, kind = 'LIABILITY', storeId?: string) {
  await tx.insert(ledgerAccounts).values({ code, name: code, kind, storeId: storeId ?? null, currency: 'IDR' }).onDuplicateKeyUpdate({ set: { code } });
  const [account] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).limit(1);
  if (!account || account.currency !== 'IDR' || account.kind !== kind || account.storeId !== (storeId ?? null)) throw new AppError(409, 'LEDGER_ACCOUNT_MISMATCH', 'Konfigurasi akun jurnal tidak cocok.');
  return account.id;
}
const maximum = BigInt(Number.MAX_SAFE_INTEGER);

export function validatePosting(lines: PostingLine[]) {
  if (lines.length < 2 || lines.length > 1000) throw new AppError(422, 'INVALID_JOURNAL', 'Jurnal harus memiliki 2–1000 baris.');
  let debit = 0n, credit = 0n;
  for (const line of lines) {
    if (line.debit < 0n || line.credit < 0n || line.debit > maximum || line.credit > maximum || !((line.debit > 0n && line.credit === 0n) || (line.credit > 0n && line.debit === 0n))) throw new AppError(422, 'INVALID_JOURNAL_LINE', 'Baris harus memiliki tepat satu debit atau kredit positif.');
    debit += line.debit; credit += line.credit;
  }
  if (debit !== credit) throw new AppError(422, 'UNBALANCED_JOURNAL', 'Total debit dan kredit harus sama.');
  return { debit, credit };
}

/** Internal service; financial endpoints must perform RBAC/MFA and source reconciliation first. */
export interface PostingInput { eventKey: string; description: string; lines: PostingLine[]; paymentReceiptId?: string; refundId?: string; payoutId?: string; reversalOfId?: string }
export async function postJournal(db: Database, input: PostingInput) { return db.transaction(tx => postJournalInTransaction(tx, input)); }
export async function postJournalInTransaction(tx: DatabaseTransaction, input: PostingInput) {
  validatePosting(input.lines);
  if (!input.eventKey || input.eventKey.length > 191 || !input.description.trim()) throw new AppError(422, 'INVALID_JOURNAL', 'Referensi event dan alasan jurnal wajib diisi.');
    // Unique business event also handles two concurrent attempts without double posting.
    const [previous] = await tx.select().from(journalEntries).where(eq(journalEntries.eventKey, input.eventKey)).for('update');
    if (previous) throw new AppError(409, 'JOURNAL_EVENT_EXISTS', 'Event bisnis ini sudah memiliki jurnal.');
    const accountIds = [...new Set(input.lines.map(line => line.accountId))].sort();
    const accounts = await tx.select().from(ledgerAccounts).where(inArray(ledgerAccounts.id, accountIds)).orderBy(ledgerAccounts.id).for('update');
    if (accounts.length !== accountIds.length || accounts.some(account => account.currency !== 'IDR')) throw new AppError(422, 'INVALID_LEDGER_ACCOUNT', 'Seluruh akun harus tersedia dan memakai IDR.');
    const id = randomUUID();
    await tx.insert(journalEntries).values({ id, eventKey: input.eventKey, description: input.description, status: 'DRAFT', paymentReceiptId: input.paymentReceiptId, refundId: input.refundId, payoutId: input.payoutId, reversalOfId: input.reversalOfId });
    await tx.insert(journalLines).values(input.lines.map((line, index) => ({ journalEntryId: id, ledgerAccountId: line.accountId, vendorOrderId: line.vendorOrderId, debit: Number(line.debit), credit: Number(line.credit), lineNo: index + 1 })));
    await tx.update(journalEntries).set({ status: 'POSTED', postedAt: new Date() }).where(eq(journalEntries.id, id));
    return { id, status: 'POSTED' as const };
}
