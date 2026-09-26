import { describe, expect, it } from 'vitest';

import { TransactionType } from '@/core/transaction.ts';

import {
    type ReportAccountInfo,
    type ReportCategoryInfo,
    type ReportContext,
    type ReportTransaction,
    buildReportAccountCashFlows,
    buildReportNetWorth,
    buildReportPeriodSummary,
    compareReportCategories,
    getReportAccountBalances,
    getReportChange,
    getLocalReportDateKey,
    getReportDateKey,
    getReportDateKeysInRange,
    getReportWeekday
} from '@/lib/report.ts';

// 2026-09-01 00:00:00 UTC to 2026-09-30 23:59:59 UTC
const SEPTEMBER_START = Date.UTC(2026, 8, 1) / 1000;
const SEPTEMBER_END = Date.UTC(2026, 9, 1) / 1000 - 1;

const accounts: Record<string, ReportAccountInfo> = {
    'cash': { id: 'cash', name: 'Cash', currency: 'IDR', isAsset: true, isLiability: false },
    'bank': { id: 'bank', name: 'Bank', currency: 'IDR', isAsset: true, isLiability: false },
    'usd': { id: 'usd', name: 'USD Wallet', currency: 'USD', isAsset: true, isLiability: false },
    'card': { id: 'card', name: 'Credit Card', currency: 'IDR', isAsset: false, isLiability: true },
    'jpy': { id: 'jpy', name: 'Yen Wallet', currency: 'JPY', isAsset: true, isLiability: false }
};

const categories: Record<string, ReportCategoryInfo> = {
    'food': { id: 'food', name: 'Food & Drink', parentId: '0' },
    'meal': { id: 'meal', name: 'Meal', parentId: 'food' },
    'coffee': { id: 'coffee', name: 'Coffee', parentId: 'food' },
    'transport': { id: 'transport', name: 'Transportation', parentId: '0' },
    'taxi': { id: 'taxi', name: 'Taxi', parentId: 'transport' },
    'salary': { id: 'salary', name: 'Salary', parentId: '0' }
};

// 1 USD = 16000 IDR, JPY cannot be converted
const context: ReportContext = {
    accounts: accounts,
    categories: categories,
    convert: (amount, currency) => {
        if (currency === 'IDR') {
            return amount;
        } else if (currency === 'USD') {
            return amount * 16000;
        }

        return null;
    }
};

let nextId = 1;

function tx(type: TransactionType, day: number, amount: number, fields: Partial<ReportTransaction> = {}): ReportTransaction {
    return {
        id: String(nextId++),
        type: type,
        time: Date.UTC(2026, 8, day, 10) / 1000,
        utcOffset: 0,
        categoryId: '',
        sourceAccountId: 'cash',
        destinationAccountId: '0',
        sourceAmount: amount,
        destinationAmount: 0,
        comment: '',
        ...fields
    };
}

// the report period and the daily statistics use the browser timezone
process.env['TZ'] = 'UTC';

describe('getReportDateKey', () => {
    it('returns the date in the browser timezone', () => {
        expect(getLocalReportDateKey(Date.UTC(2026, 8, 30, 23, 59, 59) / 1000)).toBe(20260930);
    });

    it('returns the date in the timezone of the transaction', () => {
        const time = Date.UTC(2026, 8, 30, 20) / 1000; // 2026-09-30 20:00 UTC
        expect(getReportDateKey(time, 0)).toBe(20260930);
        expect(getReportDateKey(time, 7 * 60)).toBe(20261001);
        expect(getReportDateKey(time, -21 * 60)).toBe(20260929);
    });
});

describe('getReportWeekday', () => {
    it('returns the weekday of the date', () => {
        expect(getReportWeekday(20260926)).toBe(6); // saturday
        expect(getReportWeekday(20260927)).toBe(0); // sunday
        expect(getReportWeekday(20260928)).toBe(1); // monday
    });
});

describe('getReportDateKeysInRange', () => {
    it('returns all dates across month and year boundaries', () => {
        expect(getReportDateKeysInRange(20261230, 20270102)).toEqual([20261230, 20261231, 20270101, 20270102]);
    });

    it('handles leap years', () => {
        expect(getReportDateKeysInRange(20280228, 20280301)).toEqual([20280228, 20280229, 20280301]);
    });

    it('returns the only day when start equals end', () => {
        expect(getReportDateKeysInRange(20260926, 20260926)).toEqual([20260926]);
    });
});

describe('getReportChange', () => {
    it('returns the difference and the percent', () => {
        expect(getReportChange(150, 100)).toEqual({ difference: 50, percent: 50 });
        expect(getReportChange(50, 100)).toEqual({ difference: -50, percent: -50 });
    });

    it('returns null percent when previous value is zero', () => {
        expect(getReportChange(100, 0)).toEqual({ difference: 100, percent: null });
    });

    it('uses the absolute previous value for the percent', () => {
        expect(getReportChange(-50, -100)).toEqual({ difference: 50, percent: 50 });
    });
});

describe('buildReportPeriodSummary', () => {
    const transactions: ReportTransaction[] = [
        tx(TransactionType.Income, 1, 1000000000, { categoryId: 'salary', sourceAccountId: 'bank', comment: 'Salary' }),
        tx(TransactionType.Expense, 1, 5000000, { categoryId: 'meal', comment: 'Nasi Padang' }),
        tx(TransactionType.Expense, 2, 3000000, { categoryId: 'meal', comment: ' nasi  padang ' }),
        tx(TransactionType.Expense, 2, 2500000, { categoryId: 'coffee', comment: 'Coffee' }),
        tx(TransactionType.Expense, 5, 10000000, { categoryId: 'taxi', sourceAccountId: 'card' }),
        tx(TransactionType.Expense, 6, 1000, { categoryId: 'food', sourceAccountId: 'usd' }), // 10.00 USD = 160,000 IDR
        tx(TransactionType.Expense, 7, 999, { categoryId: 'food', sourceAccountId: 'jpy' }), // cannot be converted
        tx(TransactionType.Transfer, 10, 20000000, { sourceAccountId: 'bank', destinationAccountId: 'cash', destinationAmount: 20000000 }),
        tx(TransactionType.ModifyBalance, 11, 7000000, { sourceAccountId: 'cash' }),
        tx(TransactionType.Expense, 1, 999999999, { time: SEPTEMBER_START - 1 }), // out of range
        tx(TransactionType.Expense, 1, 999999999, { time: SEPTEMBER_END + 1 }) // out of range
    ];

    const summary = buildReportPeriodSummary(transactions, SEPTEMBER_START, SEPTEMBER_END, context);

    it('calculates totals in default currency', () => {
        expect(summary.income).toBe(1000000000);
        expect(summary.expense).toBe(5000000 + 3000000 + 2500000 + 10000000 + 16000000);
        expect(summary.net).toBe(summary.income - summary.expense);
        expect(summary.savingsRate).toBeCloseTo((summary.income - summary.expense) / summary.income * 100);
        expect(summary.incomeCount).toBe(1);
        expect(summary.expenseCount).toBe(5);
        expect(summary.transferCount).toBe(1);
        expect(summary.transferAmount).toBe(20000000);
        expect(summary.hasUnconvertibleAmount).toBe(true);
    });

    it('calculates day based statistics', () => {
        expect(summary.dayCount).toBe(30);
        expect(summary.dailyAmounts).toHaveLength(30);
        expect(summary.averageDailyExpense).toBe(Math.round(summary.expense / 30));
        expect(summary.averageExpensePerTransaction).toBe(Math.round(summary.expense / 5));
        expect(summary.activeDayCount).toBe(4); // 1st, 2nd, 5th and 6th, the expense of 7th cannot be converted
        expect(summary.noExpenseDayCount).toBe(30 - 4);
    });

    it('groups secondary categories into primary categories', () => {
        expect(summary.expenseCategories.map(row => row.categoryId)).toEqual(['food', 'transport']);

        const food = summary.expenseCategories[0]!;
        expect(food.amount).toBe(5000000 + 3000000 + 2500000 + 16000000);
        expect(food.count).toBe(4);
        expect(food.subCategories.map(row => [row.categoryId, row.amount, row.count])).toEqual([
            ['meal', 8000000, 2],
            ['coffee', 2500000, 1]
        ]);

        const total = summary.expenseCategories.reduce((sum, row) => sum + row.percent, 0);
        expect(total).toBeCloseTo(100);
    });

    it('returns top transactions sorted by amount', () => {
        expect(summary.topExpenses.map(row => row.amount)).toEqual([16000000, 10000000, 5000000, 3000000, 2500000]);
        expect(summary.topIncomes).toHaveLength(1);
        expect(summary.topExpenses[0]!.dateKey).toBe(20260906);
    });

    it('groups descriptions case-insensitively and ignores the unique ones', () => {
        expect(summary.frequentExpenseDescriptions).toEqual([
            { description: 'Nasi Padang', count: 2, amount: 8000000 }
        ]);
    });

    it('aggregates weekday amounts', () => {
        const totalDays = summary.weekdayAmounts.reduce((sum, row) => sum + row.dayCount, 0);
        const totalExpense = summary.weekdayAmounts.reduce((sum, row) => sum + row.expense, 0);
        expect(totalDays).toBe(30);
        expect(totalExpense).toBe(summary.expense);
        expect(summary.weekdayAmounts[2]!.expense).toBe(5000000); // 2026-09-01 is tuesday
    });

    it('records account flows in account currency', () => {
        expect(summary.accountFlows['cash']).toEqual({ accountId: 'cash', income: 0, expense: 10500000, transferIn: 20000000, transferOut: 0, adjustment: 7000000 });
        expect(summary.accountFlows['bank']).toEqual({ accountId: 'bank', income: 1000000000, expense: 0, transferIn: 0, transferOut: 20000000, adjustment: 0 });
        expect(summary.accountFlows['usd']!.expense).toBe(1000);
        expect(summary.accountFlows['jpy']!.expense).toBe(999);
    });

    it('only counts the elapsed days in the day based statistics', () => {
        const currentTime = Date.UTC(2026, 8, 10, 12) / 1000; // 2026-09-10 12:00 UTC
        const ongoingSummary = buildReportPeriodSummary(transactions, SEPTEMBER_START, SEPTEMBER_END, context, currentTime);

        expect(ongoingSummary.dayCount).toBe(10);
        expect(ongoingSummary.dailyAmounts).toHaveLength(30);
        expect(ongoingSummary.averageDailyExpense).toBe(Math.round(ongoingSummary.expense / 10));
        expect(ongoingSummary.noExpenseDayCount).toBe(10 - 4);
        expect(ongoingSummary.weekdayAmounts.reduce((sum, row) => sum + row.dayCount, 0)).toBe(10);
    });

    it('counts all days of the finished period', () => {
        const finishedSummary = buildReportPeriodSummary(transactions, SEPTEMBER_START, SEPTEMBER_END, context, SEPTEMBER_END + 86400);
        expect(finishedSummary.dayCount).toBe(30);
    });

    it('returns empty summary when there is no transaction', () => {
        const emptySummary = buildReportPeriodSummary([], SEPTEMBER_START, SEPTEMBER_END, context);
        expect(emptySummary.income).toBe(0);
        expect(emptySummary.expense).toBe(0);
        expect(emptySummary.savingsRate).toBeNull();
        expect(emptySummary.averageExpensePerTransaction).toBe(0);
        expect(emptySummary.expenseCategories).toEqual([]);
        expect(emptySummary.noExpenseDayCount).toBe(30);
    });
});

describe('compareReportCategories', () => {
    it('merges current and previous categories', () => {
        const current = buildReportPeriodSummary([
            tx(TransactionType.Expense, 1, 300, { categoryId: 'meal' }),
            tx(TransactionType.Expense, 1, 100, { categoryId: 'taxi' })
        ], SEPTEMBER_START, SEPTEMBER_END, context);
        const previous = buildReportPeriodSummary([
            tx(TransactionType.Expense, 1, 200, { categoryId: 'meal' }),
            tx(TransactionType.Expense, 1, 50, { categoryId: 'coffee' }),
            tx(TransactionType.Expense, 1, 80, { categoryId: 'salary' })
        ], SEPTEMBER_START, SEPTEMBER_END, context);

        const rows = compareReportCategories(current.expenseCategories, previous.expenseCategories);

        expect(rows.map(row => [row.categoryId, row.amount, row.previousAmount])).toEqual([
            ['food', 300, 250],
            ['transport', 100, 0],
            ['salary', 0, 80]
        ]);
        expect(rows[0]!.change.percent).toBeCloseTo(20);
        expect(rows[1]!.change.percent).toBeNull();
        expect(rows[2]!.change.percent).toBe(-100);
        expect(rows[0]!.subCategories.map(row => [row.categoryId, row.amount, row.previousAmount])).toEqual([
            ['meal', 300, 200],
            ['coffee', 0, 50]
        ]);
    });
});

describe('getReportAccountBalances', () => {
    it('uses the first opening balance and the last closing balance', () => {
        const balances = getReportAccountBalances([
            { items: [{ accountId: 'cash', accountOpeningBalance: '100', accountClosingBalance: '150' }, { accountId: 'bank', accountOpeningBalance: '1000', accountClosingBalance: '1000' }] },
            { items: [{ accountId: 'cash', accountOpeningBalance: '150', accountClosingBalance: '120' }] }
        ]);

        expect(balances).toEqual({
            'cash': { opening: 100, closing: 120 },
            'bank': { opening: 1000, closing: 1000 }
        });
    });
});

describe('buildReportAccountCashFlows and buildReportNetWorth', () => {
    const summary = buildReportPeriodSummary([
        tx(TransactionType.Income, 1, 1000, { sourceAccountId: 'bank' }),
        tx(TransactionType.Expense, 2, 300, { sourceAccountId: 'card' }),
        tx(TransactionType.Transfer, 3, 200, { sourceAccountId: 'bank', destinationAccountId: 'card', destinationAmount: 200 })
    ], SEPTEMBER_START, SEPTEMBER_END, context);

    const rows = buildReportAccountCashFlows(Object.values(accounts), summary.accountFlows, {
        'bank': { opening: 5000, closing: 5800 },
        'card': { opening: -1000, closing: -1100 },
        'usd': { opening: 10, closing: 10 },
        'jpy': { opening: 0, closing: 0 }
    });

    it('ignores accounts without balance and transactions', () => {
        expect(rows.map(row => row.account.id)).toEqual(['bank', 'usd', 'card']);
    });

    it('keeps opening + flows = closing', () => {
        for (const row of rows) {
            expect(row.opening + row.income - row.expense + row.transferIn - row.transferOut + row.adjustment).toBe(row.closing);
        }
    });

    it('calculates net worth with liabilities as positive amounts', () => {
        const netWorth = buildReportNetWorth(rows, context.convert);
        expect(netWorth).toEqual({
            openingAssets: 5000 + 160000,
            openingLiabilities: 1000,
            openingNetWorth: 5000 + 160000 - 1000,
            closingAssets: 5800 + 160000,
            closingLiabilities: 1100,
            closingNetWorth: 5800 + 160000 - 1100,
            hasUnconvertibleAmount: false
        });
    });
});
