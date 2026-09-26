import { TransactionType } from '@/core/transaction.ts';

// all amounts in this module are integer amounts in cents (the same unit as the api responses),
// and all aggregated amounts are converted to the default currency of the current user

export interface ReportTransaction {
    readonly id: string;
    readonly type: number;
    readonly time: number;
    readonly utcOffset: number;
    readonly categoryId: string;
    readonly sourceAccountId: string;
    readonly destinationAccountId: string;
    readonly sourceAmount: number;
    readonly destinationAmount: number;
    readonly comment: string;
}

export interface ReportAccountInfo {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
    readonly isAsset: boolean;
    readonly isLiability: boolean;
}

export interface ReportCategoryInfo {
    readonly id: string;
    readonly name: string;
    readonly parentId: string;
}

// ReportAmountConverter converts an amount in the specified currency to the default currency, returns null if it cannot be converted
export type ReportAmountConverter = (amount: number, currency: string) => number | null;

export interface ReportContext {
    readonly accounts: Record<string, ReportAccountInfo>;
    readonly categories: Record<string, ReportCategoryInfo>;
    readonly convert: ReportAmountConverter;
}

export interface ReportCategoryRow {
    readonly categoryId: string;
    readonly name: string;
    amount: number;
    count: number;
    percent: number;
    readonly subCategories: ReportCategoryRow[];
}

export interface ReportTransactionRow {
    readonly transaction: ReportTransaction;
    readonly amount: number;
    readonly dateKey: number;
}

export interface ReportDescriptionRow {
    readonly description: string;
    count: number;
    amount: number;
}

export interface ReportDailyAmount {
    readonly dateKey: number;
    income: number;
    expense: number;
    count: number;
}

export interface ReportWeekdayAmount {
    readonly weekday: number; // 0 = sunday
    expense: number;
    income: number;
    count: number;
    dayCount: number;
}

export interface ReportAccountFlow {
    readonly accountId: string;
    income: number;
    expense: number;
    transferIn: number;
    transferOut: number;
    adjustment: number;
}

export interface ReportPeriodSummary {
    readonly startTime: number;
    readonly endTime: number;
    readonly dayCount: number; // the count of the elapsed days in the period
    readonly income: number;
    readonly expense: number;
    readonly net: number;
    readonly savingsRate: number | null;
    readonly incomeCount: number;
    readonly expenseCount: number;
    readonly transferCount: number;
    readonly transferAmount: number;
    readonly averageDailyExpense: number;
    readonly averageExpensePerTransaction: number;
    readonly activeDayCount: number;
    readonly noExpenseDayCount: number;
    readonly hasUnconvertibleAmount: boolean;
    readonly expenseCategories: ReportCategoryRow[];
    readonly incomeCategories: ReportCategoryRow[];
    readonly topExpenses: ReportTransactionRow[];
    readonly topIncomes: ReportTransactionRow[];
    readonly frequentExpenseDescriptions: ReportDescriptionRow[];
    readonly dailyAmounts: ReportDailyAmount[];
    readonly weekdayAmounts: ReportWeekdayAmount[];
    readonly accountFlows: Record<string, ReportAccountFlow>;
}

export interface ReportChange {
    readonly difference: number;
    readonly percent: number | null; // null when the previous value is zero
}

export interface ReportCategoryComparisonRow {
    readonly categoryId: string;
    readonly name: string;
    readonly amount: number;
    readonly count: number;
    readonly percent: number;
    readonly previousAmount: number;
    readonly change: ReportChange;
    readonly subCategories: ReportCategoryComparisonRow[];
}

export interface ReportAccountBalance {
    readonly opening: number;
    readonly closing: number;
}

export interface ReportAccountCashFlowRow {
    readonly account: ReportAccountInfo;
    readonly opening: number;
    readonly income: number;
    readonly expense: number;
    readonly transferIn: number;
    readonly transferOut: number;
    readonly adjustment: number;
    readonly closing: number;
}

export interface ReportNetWorth {
    readonly openingAssets: number;
    readonly openingLiabilities: number;
    readonly openingNetWorth: number;
    readonly closingAssets: number;
    readonly closingLiabilities: number;
    readonly closingNetWorth: number;
    readonly hasUnconvertibleAmount: boolean;
}

export const REPORT_TOP_TRANSACTION_COUNT = 10;
export const REPORT_TOP_DESCRIPTION_COUNT = 10;


// getReportDateKey returns the date (yyyymmdd) of the transaction in its own timezone
export function getReportDateKey(time: number, utcOffset: number): number {
    const date = new Date((time + utcOffset * 60) * 1000);
    return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

// getLocalReportDateKey returns the date (yyyymmdd) of the unix time in the browser timezone,
// which is the same timezone as the start time and end time of the report period
export function getLocalReportDateKey(time: number): number {
    return getReportDateKey(time, -new Date(time * 1000).getTimezoneOffset());
}

// getReportWeekday returns the weekday (0 = sunday) of the date key
export function getReportWeekday(dateKey: number): number {
    return new Date(Date.UTC(Math.trunc(dateKey / 10000), Math.trunc((dateKey % 10000) / 100) - 1, dateKey % 100)).getUTCDay();
}

// getReportDateKeysInRange returns all date keys between the start date key and the end date key (both inclusive)
export function getReportDateKeysInRange(startDateKey: number, endDateKey: number): number[] {
    const ret: number[] = [];
    const date = new Date(Date.UTC(Math.trunc(startDateKey / 10000), Math.trunc((startDateKey % 10000) / 100) - 1, startDateKey % 100));

    for (let i = 0; i < 400 * 10; i++) {
        const dateKey = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();

        if (dateKey > endDateKey) {
            break;
        }

        ret.push(dateKey);
        date.setUTCDate(date.getUTCDate() + 1);
    }

    return ret;
}

export function getReportChange(current: number, previous: number): ReportChange {
    return {
        difference: current - previous,
        percent: previous !== 0 ? (current - previous) / Math.abs(previous) * 100 : null
    };
}

function normalizeDescription(description: string): string {
    return description.trim().replace(/\s+/g, ' ');
}

function getOrCreateAccountFlow(accountFlows: Record<string, ReportAccountFlow>, accountId: string): ReportAccountFlow {
    let accountFlow = accountFlows[accountId];

    if (!accountFlow) {
        accountFlow = { accountId: accountId, income: 0, expense: 0, transferIn: 0, transferOut: 0, adjustment: 0 };
        accountFlows[accountId] = accountFlow;
    }

    return accountFlow;
}

function addToCategoryRows(primaryRows: Map<string, ReportCategoryRow>, secondaryRows: Map<string, ReportCategoryRow>, context: ReportContext, categoryId: string, amount: number): void {
    const category = context.categories[categoryId];
    const parentCategory = category && category.parentId && category.parentId !== '0' ? context.categories[category.parentId] : undefined;
    const primaryCategoryId = parentCategory ? parentCategory.id : categoryId;
    const primaryCategoryName = parentCategory ? parentCategory.name : (category ? category.name : '');

    let primaryRow = primaryRows.get(primaryCategoryId);

    if (!primaryRow) {
        primaryRow = { categoryId: primaryCategoryId, name: primaryCategoryName, amount: 0, count: 0, percent: 0, subCategories: [] };
        primaryRows.set(primaryCategoryId, primaryRow);
    }

    primaryRow.amount += amount;
    primaryRow.count++;

    if (!parentCategory) {
        return;
    }

    let secondaryRow = secondaryRows.get(categoryId);

    if (!secondaryRow) {
        secondaryRow = { categoryId: categoryId, name: category ? category.name : '', amount: 0, count: 0, percent: 0, subCategories: [] };
        secondaryRows.set(categoryId, secondaryRow);
        primaryRow.subCategories.push(secondaryRow);
    }

    secondaryRow.amount += amount;
    secondaryRow.count++;
}

function finishCategoryRows(primaryRows: Map<string, ReportCategoryRow>, total: number): ReportCategoryRow[] {
    const rows = Array.from(primaryRows.values());

    for (const row of rows) {
        row.percent = total > 0 ? row.amount / total * 100 : 0;
        row.subCategories.sort((a, b) => b.amount - a.amount);

        for (const subCategory of row.subCategories) {
            subCategory.percent = total > 0 ? subCategory.amount / total * 100 : 0;
        }
    }

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getTopRows(rows: ReportTransactionRow[], count: number): ReportTransactionRow[] {
    return rows.slice().sort((a, b) => b.amount - a.amount || b.transaction.time - a.transaction.time).slice(0, count);
}

// buildReportPeriodSummary aggregates all transactions within the period,
// the day based statistics (e.g. average daily expense) only count the days before the current time
export function buildReportPeriodSummary(transactions: ReportTransaction[], startTime: number, endTime: number, context: ReportContext, currentTime?: number): ReportPeriodSummary {
    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let transferCount = 0;
    let transferAmount = 0;
    let hasUnconvertibleAmount = false;

    const expensePrimaryRows = new Map<string, ReportCategoryRow>();
    const expenseSecondaryRows = new Map<string, ReportCategoryRow>();
    const incomePrimaryRows = new Map<string, ReportCategoryRow>();
    const incomeSecondaryRows = new Map<string, ReportCategoryRow>();
    const expenseRows: ReportTransactionRow[] = [];
    const incomeRows: ReportTransactionRow[] = [];
    const descriptions = new Map<string, ReportDescriptionRow>();
    const dailyAmounts = new Map<number, ReportDailyAmount>();
    const accountFlows: Record<string, ReportAccountFlow> = {};

    const convert = (amount: number, accountId: string): number | null => {
        const account = context.accounts[accountId];

        if (!account) {
            return null;
        }

        const converted = context.convert(amount, account.currency);

        if (converted === null) {
            hasUnconvertibleAmount = true;
        }

        return converted;
    };

    for (const transaction of transactions) {
        if (transaction.time < startTime || transaction.time > endTime) {
            continue;
        }

        if (transaction.type === TransactionType.ModifyBalance) {
            getOrCreateAccountFlow(accountFlows, transaction.sourceAccountId).adjustment += transaction.sourceAmount;
            continue;
        }

        if (transaction.type === TransactionType.Transfer) {
            getOrCreateAccountFlow(accountFlows, transaction.sourceAccountId).transferOut += transaction.sourceAmount;
            getOrCreateAccountFlow(accountFlows, transaction.destinationAccountId).transferIn += transaction.destinationAmount;

            const amount = convert(transaction.sourceAmount, transaction.sourceAccountId);
            transferCount++;
            transferAmount += amount ?? 0;
            continue;
        }

        if (transaction.type !== TransactionType.Income && transaction.type !== TransactionType.Expense) {
            continue;
        }

        const isIncome = transaction.type === TransactionType.Income;
        const accountFlow = getOrCreateAccountFlow(accountFlows, transaction.sourceAccountId);

        if (isIncome) {
            accountFlow.income += transaction.sourceAmount;
        } else {
            accountFlow.expense += transaction.sourceAmount;
        }

        const amount = convert(transaction.sourceAmount, transaction.sourceAccountId);

        if (amount === null) {
            continue;
        }

        const dateKey = getLocalReportDateKey(transaction.time);
        let dailyAmount = dailyAmounts.get(dateKey);

        if (!dailyAmount) {
            dailyAmount = { dateKey: dateKey, income: 0, expense: 0, count: 0 };
            dailyAmounts.set(dateKey, dailyAmount);
        }

        dailyAmount.count++;

        if (isIncome) {
            income += amount;
            incomeCount++;
            dailyAmount.income += amount;
            addToCategoryRows(incomePrimaryRows, incomeSecondaryRows, context, transaction.categoryId, amount);
            incomeRows.push({ transaction, amount, dateKey });
        } else {
            expense += amount;
            expenseCount++;
            dailyAmount.expense += amount;
            addToCategoryRows(expensePrimaryRows, expenseSecondaryRows, context, transaction.categoryId, amount);
            expenseRows.push({ transaction, amount, dateKey });

            const description = normalizeDescription(transaction.comment);

            if (description) {
                const key = description.toLowerCase();
                let descriptionRow = descriptions.get(key);

                if (!descriptionRow) {
                    descriptionRow = { description: description, count: 0, amount: 0 };
                    descriptions.set(key, descriptionRow);
                }

                descriptionRow.count++;
                descriptionRow.amount += amount;
            }
        }
    }

    const startDateKey = getLocalReportDateKey(startTime);
    const endDateKey = getLocalReportDateKey(endTime);
    const lastElapsedDateKey = currentTime !== undefined && currentTime < endTime ? getLocalReportDateKey(Math.max(startTime, currentTime)) : endDateKey;
    const allDateKeys = getReportDateKeysInRange(startDateKey, endDateKey);
    const dayCount = Math.max(1, allDateKeys.filter(dateKey => dateKey <= lastElapsedDateKey).length);
    const weekdayAmounts: ReportWeekdayAmount[] = [];

    for (let weekday = 0; weekday < 7; weekday++) {
        weekdayAmounts.push({ weekday: weekday, expense: 0, income: 0, count: 0, dayCount: 0 });
    }

    const allDailyAmounts: ReportDailyAmount[] = [];
    let noExpenseDayCount = 0;

    for (const dateKey of allDateKeys) {
        const dailyAmount = dailyAmounts.get(dateKey) ?? { dateKey: dateKey, income: 0, expense: 0, count: 0 };
        const weekdayAmount = weekdayAmounts[getReportWeekday(dateKey)]!;

        weekdayAmount.expense += dailyAmount.expense;
        weekdayAmount.income += dailyAmount.income;
        weekdayAmount.count += dailyAmount.count;
        allDailyAmounts.push(dailyAmount);

        if (dateKey > lastElapsedDateKey) {
            continue;
        }

        weekdayAmount.dayCount++;

        if (dailyAmount.expense === 0) {
            noExpenseDayCount++;
        }
    }

    const frequentExpenseDescriptions = Array.from(descriptions.values())
        .filter(row => row.count > 1)
        .sort((a, b) => b.count - a.count || b.amount - a.amount)
        .slice(0, REPORT_TOP_DESCRIPTION_COUNT);

    return {
        startTime: startTime,
        endTime: endTime,
        dayCount: dayCount,
        income: income,
        expense: expense,
        net: income - expense,
        savingsRate: income > 0 ? (income - expense) / income * 100 : null,
        incomeCount: incomeCount,
        expenseCount: expenseCount,
        transferCount: transferCount,
        transferAmount: transferAmount,
        averageDailyExpense: Math.round(expense / dayCount),
        averageExpensePerTransaction: expenseCount > 0 ? Math.round(expense / expenseCount) : 0,
        activeDayCount: dailyAmounts.size,
        noExpenseDayCount: noExpenseDayCount,
        hasUnconvertibleAmount: hasUnconvertibleAmount,
        expenseCategories: finishCategoryRows(expensePrimaryRows, expense),
        incomeCategories: finishCategoryRows(incomePrimaryRows, income),
        topExpenses: getTopRows(expenseRows, REPORT_TOP_TRANSACTION_COUNT),
        topIncomes: getTopRows(incomeRows, REPORT_TOP_TRANSACTION_COUNT),
        frequentExpenseDescriptions: frequentExpenseDescriptions,
        dailyAmounts: allDailyAmounts,
        weekdayAmounts: weekdayAmounts,
        accountFlows: accountFlows
    };
}

function compareCategoryRowList(currentRows: ReportCategoryRow[], previousRows: ReportCategoryRow[]): ReportCategoryComparisonRow[] {
    const previousRowsMap = new Map<string, ReportCategoryRow>();

    for (const row of previousRows) {
        previousRowsMap.set(row.categoryId, row);
    }

    const ret: ReportCategoryComparisonRow[] = [];

    for (const row of currentRows) {
        const previousRow = previousRowsMap.get(row.categoryId);
        previousRowsMap.delete(row.categoryId);

        ret.push({
            categoryId: row.categoryId,
            name: row.name,
            amount: row.amount,
            count: row.count,
            percent: row.percent,
            previousAmount: previousRow ? previousRow.amount : 0,
            change: getReportChange(row.amount, previousRow ? previousRow.amount : 0),
            subCategories: compareCategoryRowList(row.subCategories, previousRow ? previousRow.subCategories : [])
        });
    }

    // the categories which only have amounts in the previous period
    for (const previousRow of previousRowsMap.values()) {
        ret.push({
            categoryId: previousRow.categoryId,
            name: previousRow.name,
            amount: 0,
            count: 0,
            percent: 0,
            previousAmount: previousRow.amount,
            change: getReportChange(0, previousRow.amount),
            subCategories: compareCategoryRowList([], previousRow.subCategories)
        });
    }

    return ret;
}

// compareReportCategories merges the category rows of current period and previous period
export function compareReportCategories(currentRows: ReportCategoryRow[], previousRows: ReportCategoryRow[]): ReportCategoryComparisonRow[] {
    return compareCategoryRowList(currentRows, previousRows);
}

// buildReportAccountCashFlows returns the cash flow of each account in its own currency,
// the accounts without any balance or any transaction in the period are ignored
export function buildReportAccountCashFlows(accounts: ReportAccountInfo[], accountFlows: Record<string, ReportAccountFlow>, balances: Record<string, ReportAccountBalance>): ReportAccountCashFlowRow[] {
    const ret: ReportAccountCashFlowRow[] = [];

    for (const account of accounts) {
        const flow = accountFlows[account.id];
        const balance = balances[account.id];

        if (!flow && (!balance || (balance.opening === 0 && balance.closing === 0))) {
            continue;
        }

        const opening = balance ? balance.opening : 0;
        const income = flow ? flow.income : 0;
        const expense = flow ? flow.expense : 0;
        const transferIn = flow ? flow.transferIn : 0;
        const transferOut = flow ? flow.transferOut : 0;
        const adjustment = flow ? flow.adjustment : 0;

        ret.push({
            account: account,
            opening: opening,
            income: income,
            expense: expense,
            transferIn: transferIn,
            transferOut: transferOut,
            adjustment: adjustment,
            closing: balance ? balance.closing : opening + income - expense + transferIn - transferOut + adjustment
        });
    }

    return ret;
}

// buildReportNetWorth returns the total assets, total liabilities and net worth at the beginning and the end of the period
export function buildReportNetWorth(rows: ReportAccountCashFlowRow[], convert: ReportAmountConverter): ReportNetWorth {
    let openingAssets = 0;
    let openingLiabilities = 0;
    let closingAssets = 0;
    let closingLiabilities = 0;
    let hasUnconvertibleAmount = false;

    for (const row of rows) {
        const opening = convert(row.opening, row.account.currency);
        const closing = convert(row.closing, row.account.currency);

        if (opening === null || closing === null) {
            hasUnconvertibleAmount = true;
            continue;
        }

        // the balance of liability accounts is negative when there is debt
        if (row.account.isLiability) {
            openingLiabilities -= opening;
            closingLiabilities -= closing;
        } else {
            openingAssets += opening;
            closingAssets += closing;
        }
    }

    return {
        openingAssets: openingAssets,
        openingLiabilities: openingLiabilities,
        openingNetWorth: openingAssets - openingLiabilities,
        closingAssets: closingAssets,
        closingLiabilities: closingLiabilities,
        closingNetWorth: closingAssets - closingLiabilities,
        hasUnconvertibleAmount: hasUnconvertibleAmount
    };
}

// getReportAccountBalances returns the opening balance and closing balance of each account from the daily balances,
// the daily balances must be sorted by date in ascending order
export function getReportAccountBalances(dailyBalances: { items: { accountId: string, accountOpeningBalance: string | number, accountClosingBalance: string | number }[] }[]): Record<string, ReportAccountBalance> {
    const ret: Record<string, { opening: number, closing: number }> = {};

    for (const dailyBalance of dailyBalances) {
        for (const item of dailyBalance.items) {
            const existed = ret[item.accountId];

            if (existed) {
                existed.closing = Number(item.accountClosingBalance);
            } else {
                ret[item.accountId] = {
                    opening: Number(item.accountOpeningBalance),
                    closing: Number(item.accountClosingBalance)
                };
            }
        }
    }

    return ret;
}
