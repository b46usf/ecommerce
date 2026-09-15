import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/index.js';
import { journalEntries, journalLines, ledgerAccounts } from '../src/database/schema.js';
import { postJournal } from '../src/modules/ledger/service.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('ledger posting and database immutability', () => {
  let database: ReturnType<typeof createDatabase>;
  const debitAccount = randomUUID(), creditAccount = randomUUID();
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    database = createDatabase({ databaseUrl: url });
    await database.db.insert(ledgerAccounts).values([
      { id: debitAccount, code: debitAccount, name: 'Provider clearing', kind: 'ASSET', currency: 'IDR' },
      { id: creditAccount, code: creditAccount, name: 'Vendor payable', kind: 'LIABILITY', currency: 'IDR' },
    ]);
  });
  afterAll(async () => { if (database) await database.close(); });

  it('posts balanced entries atomically and rejects edits to posted entries and lines', async () => {
    const posted = await postJournal(database.db, { eventKey: randomUUID(), description: 'Integration payment', lines: [
      { accountId: debitAccount, debit: 407000n, credit: 0n }, { accountId: creditAccount, debit: 0n, credit: 407000n },
    ] });
    await expect(database.db.update(journalEntries).set({ description: 'tampered' }).where(eq(journalEntries.id, posted.id))).rejects.toThrow();
    await expect(database.db.delete(journalEntries).where(eq(journalEntries.id, posted.id))).rejects.toThrow();
    await expect(database.db.update(journalLines).set({ debit: 1 }).where(eq(journalLines.journalEntryId, posted.id))).rejects.toThrow();
    await expect(database.db.delete(journalLines).where(eq(journalLines.journalEntryId, posted.id))).rejects.toThrow();
    await expect(database.db.insert(journalLines).values({ journalEntryId: posted.id, ledgerAccountId: debitAccount, lineNo: 3, debit: 1, credit: 0 })).rejects.toThrow();
  });
  it('guards balance and draft-first creation even when callers bypass the posting service', async () => {
    const id = randomUUID();
    await database.db.insert(journalEntries).values({ id, eventKey: id, status: 'DRAFT', description: 'Unbalanced draft' });
    await database.db.insert(journalLines).values([
      { journalEntryId: id, ledgerAccountId: debitAccount, lineNo: 1, debit: 100, credit: 0 },
      { journalEntryId: id, ledgerAccountId: creditAccount, lineNo: 2, debit: 0, credit: 90 },
    ]);
    await expect(database.db.update(journalEntries).set({ status: 'POSTED', postedAt: new Date() }).where(eq(journalEntries.id, id))).rejects.toThrow();
    await expect(database.db.insert(journalEntries).values({ eventKey: randomUUID(), status: 'POSTED', postedAt: new Date(), description: 'Bypass lines' })).rejects.toThrow();
  });
  it('permits only one posting per permanent business event under concurrency', async () => {
    const eventKey = randomUUID();
    const results = await Promise.allSettled([1, 2].map(() => postJournal(database.db, { eventKey, description: 'Concurrent event', lines: [
      { accountId: debitAccount, debit: 500n, credit: 0n }, { accountId: creditAccount, debit: 0n, credit: 500n },
    ] })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rows = await database.db.select().from(journalEntries).where(eq(journalEntries.eventKey, eventKey));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('POSTED');
  });
});
