import { expect, it } from 'vitest';
import { validatePosting } from '../src/modules/ledger/service.js';

it('balances the exact IDR journal from the ERD fixture without floating point', () => {
  const credits = [217560n, 146670n, 35000n, 7000n, 770n];
  expect(validatePosting([{ accountId: 'clearing', debit: 407000n, credit: 0n }, ...credits.map((credit, index) => ({ accountId: `account-${index}`, debit: 0n, credit }))])).toEqual({ debit: 407000n, credit: 407000n });
});
it('rejects unbalanced and ambiguous postings', () => {
  expect(() => validatePosting([{ accountId: 'a', debit: 100n, credit: 0n }, { accountId: 'b', debit: 0n, credit: 99n }])).toThrow('Total debit');
  expect(() => validatePosting([{ accountId: 'a', debit: 100n, credit: 100n }, { accountId: 'b', debit: 0n, credit: 0n }])).toThrow('tepat satu');
});
