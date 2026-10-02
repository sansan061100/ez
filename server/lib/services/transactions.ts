import { DateTime } from 'luxon';

import type { Context } from '../core/context';
import type { TaskProcessUpdateHandler } from '../core/types';
import { MATCH_MODE_DEFAULT, MATCH_MODE_IGNORE_CASE } from '../core/types';
import { type Database, type Query, type Session, SqlCond } from '../datastore/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    type Account,
    ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS,
    type AccountCategory,
    AccountTable,
    CATEGORY_TYPE_EXPENSE,
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    getTemplateTagIds,
    isAssetAccountCategory,
    isLiabilityAccountCategory,
    LevelOneTransactionCategoryParentId,
    MaximumTransactionAmount,
    MinimumTransactionAmount,
    newTransaction,
    newTransactionTagIndex,
    TRANSACTION_DB_TYPE_EXPENSE,
    TRANSACTION_DB_TYPE_INCOME,
    TRANSACTION_DB_TYPE_MODIFY_BALANCE,
    TRANSACTION_DB_TYPE_TRANSFER_IN,
    TRANSACTION_DB_TYPE_TRANSFER_OUT,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DAILY,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_MONTHLY,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_WEEKLY,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_YEARLY,
    TRANSACTION_TAG_FILTER_HAS_ALL,
    TRANSACTION_TAG_FILTER_HAS_ANY,
    TRANSACTION_TAG_FILTER_NOT_HAS_ALL,
    TRANSACTION_TAG_FILTER_NOT_HAS_ANY,
    TRANSACTION_TEMPLATE_TYPE_SCHEDULE,
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_TRANSFER,
    type Transaction,
    TransactionCategoryTable,
    type TransactionDbType,
    transactionDbTypeName,
    type TransactionPictureInfo,
    TransactionPictureInfoTable,
    TransactionPictureNewPictureTransactionId,
    TransactionTable,
    type TransactionTagFilter,
    type TransactionTagIndex,
    TransactionTagIndexTable,
    TransactionTagTable,
    type TransactionTemplate,
    TransactionTemplateTable,
    type TransactionTotalAmount,
    type TransactionType,
    transactionTypeToTransactionDbType,
    type TransactionWithAccountBalance,
} from '../models/index';
import { stringArrayToInt64Array, stringToInt32, stringToInt64 } from '../utils/converter';
import {
    fixedZone,
    formatUnixTimeToLongDateTime,
    formatUnixTimeToNumericLocalDateTime,
    formatUnixTimeToNumericYearMonth,
    formatUnixTimeToNumericYearMonthDay,
    getMaxDayOfMonth,
    getMaxTransactionTimeFromUnixTime,
    getMaxUnixTimeWithSameLocalDateTime,
    getMinTransactionTimeFromUnixTime,
    getMinUnixTimeWithSameLocalDateTime,
    getTimezoneOffsetMinutes,
    getTransactionTimeRangeByYearMonth,
    getUnixTimeFromTransactionTime,
    isUnixTimeEqualsYearAndMonth,
    type Timezone,
} from '../utils/datetimes';
import { addInt64, subtractInt64 } from '../utils/numbers';
import { toUniqueInt64Slice } from '../utils/slices';
import { UUID_TYPE_TAG_INDEX, UUID_TYPE_TRANSACTION } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

const pageCountForLoadTransactionAmounts = 1000;
const int64Max = 2n ** 63n - 1n;
const int64Min = -(2n ** 63n);

// TransactionQueryFilter represents the common filter parameters for querying transactions
export interface TransactionQueryFilter {
    transactionType: TransactionType;
    categoryIds: bigint[] | null;
    accountIds: bigint[] | null;
    tagFilters: TransactionTagFilter[] | null;
    noTags: boolean;
    amountFilter: string;
    keyword: string;
    matchMode: number;
    mustHavePictures: boolean;
}

export const emptyTransactionQueryFilter: TransactionQueryFilter = {
    transactionType: 0,
    categoryIds: null,
    accountIds: null,
    tagFilters: null,
    noTags: false,
    amountFilter: '',
    keyword: '',
    matchMode: MATCH_MODE_DEFAULT,
    mustHavePictures: false,
};

function withFilter(filter: Partial<TransactionQueryFilter>): TransactionQueryFilter {
    return { ...emptyTransactionQueryFilter, ...filter };
}

function nowMaxTransactionTime(): number {
    return getMaxTransactionTimeFromUnixTime(nowUnix());
}

function transactionTimezone(transaction: Transaction): Timezone {
    return fixedZone(transaction.timezoneUtcOffset);
}

// TransactionService represents transaction service
export class TransactionService extends ServiceBase {
    // getTotalTransactionCountByUid returns total transaction count of user
    public async getTotalTransactionCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).count(TransactionTable);
    }

    // getAllTransactions returns all transactions
    public async getAllTransactions(c: Context, uid: bigint, pageCount: number, noDuplicated: boolean): Promise<Transaction[]> {
        let maxTransactionTime = nowMaxTransactionTime();
        const allTransactions: Transaction[] = [];

        while (maxTransactionTime > 0) {
            const transactions = await this.getTransactionsByMaxTime(c, uid, maxTransactionTime, 0, emptyTransactionQueryFilter, 1, pageCount, false, noDuplicated);
            allTransactions.push(...transactions);

            if (transactions.length < pageCount) {
                break;
            }

            maxTransactionTime = transactions[transactions.length - 1]!.transactionTime - 1;
        }

        return allTransactions;
    }

    // getAllSpecifiedTransactions returns all transactions that match given conditions
    public async getAllSpecifiedTransactions(c: Context, uid: bigint, maxTransactionTime: number, minTransactionTime: number, filter: TransactionQueryFilter, pageCount: number, noDuplicated: boolean): Promise<Transaction[]> {
        if (maxTransactionTime <= 0) {
            maxTransactionTime = nowMaxTransactionTime();
        }

        const allTransactions: Transaction[] = [];

        while (maxTransactionTime > 0) {
            const transactions = await this.getTransactionsByMaxTime(c, uid, maxTransactionTime, minTransactionTime, filter, 1, pageCount, false, noDuplicated);
            allTransactions.push(...transactions);

            if (transactions.length < pageCount) {
                break;
            }

            maxTransactionTime = transactions[transactions.length - 1]!.transactionTime - 1;
        }

        return allTransactions;
    }

    // getAllTransactionsInOneAccountWithAccountBalanceByMaxTime returns account statement within time range
    public async getAllTransactionsInOneAccountWithAccountBalanceByMaxTime(c: Context, uid: bigint, pageCount: number, maxTransactionTime: number, minTransactionTime: number, accountId: bigint, accountCategory: AccountCategory): Promise<[TransactionWithAccountBalance[], bigint, bigint, bigint, bigint]> {
        if (maxTransactionTime <= 0) {
            maxTransactionTime = nowMaxTransactionTime();
        }

        const allTransactions: Transaction[] = [];

        while (maxTransactionTime > 0) {
            const transactions = await this.getTransactionsByMaxTime(c, uid, maxTransactionTime, 0, withFilter({ accountIds: [accountId] }), 1, pageCount, false, true);
            allTransactions.push(...transactions);

            if (transactions.length < pageCount) {
                break;
            }

            maxTransactionTime = transactions[transactions.length - 1]!.transactionTime - 1;
        }

        const allTransactionsAndAccountBalance: TransactionWithAccountBalance[] = [];

        if (allTransactions.length < 1) {
            return [allTransactionsAndAccountBalance, 0n, 0n, 0n, 0n];
        }

        let totalInflows = 0n;
        let totalOutflows = 0n;
        let openingBalance = 0n;
        let accumulatedBalance = 0n;
        let lastAccumulatedBalance = 0n;

        for (let i = allTransactions.length - 1; i >= 0; i--) {
            const transaction = allTransactions[i]!;

            if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                accumulatedBalance += BigInt(transaction.relatedAccountAmount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
                accumulatedBalance += BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                accumulatedBalance -= BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                accumulatedBalance -= BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                accumulatedBalance += BigInt(transaction.amount);
            } else {
                log.errorf(c, `[transactions.GetAllTransactionsInOneAccountWithAccountBalanceByMaxTime] trasaction type (${transaction.transactionId}) is invalid (id:${transaction.type})`);
                throw errs.ErrTransactionTypeInvalid;
            }

            if (transaction.transactionTime < minTransactionTime) {
                openingBalance = accumulatedBalance;
                lastAccumulatedBalance = accumulatedBalance;
                continue;
            }

            if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                if (isAssetAccountCategory(accountCategory)) {
                    totalInflows += BigInt(transaction.relatedAccountAmount);
                } else if (isLiabilityAccountCategory(accountCategory)) {
                    totalOutflows -= BigInt(transaction.relatedAccountAmount);
                }
            } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
                totalInflows += BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                totalOutflows += BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                totalOutflows += BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                totalInflows += BigInt(transaction.amount);
            }

            allTransactionsAndAccountBalance.push({
                transaction: transaction,
                accountOpeningBalance: lastAccumulatedBalance,
                accountClosingBalance: accumulatedBalance,
            });

            lastAccumulatedBalance = accumulatedBalance;
        }

        return [allTransactionsAndAccountBalance, totalInflows, totalOutflows, openingBalance, accumulatedBalance];
    }

    // getAllAccountsDailyOpeningAndClosingBalance returns daily opening and closing balance of all accounts within time range
    public async getAllAccountsDailyOpeningAndClosingBalance(c: Context, uid: bigint, maxTransactionTime: number, minTransactionTime: number, clientTimezone: Timezone): Promise<Map<number, TransactionWithAccountBalance[]>> {
        if (maxTransactionTime <= 0) {
            maxTransactionTime = nowMaxTransactionTime();
        }

        const allTransactions: Transaction[] = [];

        while (maxTransactionTime > 0) {
            const transactions = await this.getTransactionsByMaxTime(c, uid, maxTransactionTime, 0, emptyTransactionQueryFilter, 1, pageCountForLoadTransactionAmounts, false, false);
            allTransactions.push(...transactions);

            if (transactions.length < pageCountForLoadTransactionAmounts) {
                break;
            }

            maxTransactionTime = transactions[transactions.length - 1]!.transactionTime - 1;
        }

        const accountDailyLastBalances = new Map<string, TransactionWithAccountBalance>();
        const accountDailyBalances = new Map<number, TransactionWithAccountBalance[]>();

        if (allTransactions.length < 1) {
            return accountDailyBalances;
        }

        const accumulatedBalances = new Map<bigint, bigint>();
        const accumulatedBalancesBeforeStartTime = new Map<bigint, bigint>();

        for (let i = allTransactions.length - 1; i >= 0; i--) {
            const transaction = allTransactions[i]!;
            let accumulatedBalance = accumulatedBalances.get(transaction.accountId) ?? 0n;
            const lastAccumulatedBalance = accumulatedBalance;

            if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                accumulatedBalance += BigInt(transaction.relatedAccountAmount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
                accumulatedBalance += BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                accumulatedBalance -= BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                accumulatedBalance -= BigInt(transaction.amount);
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                accumulatedBalance += BigInt(transaction.amount);
            } else {
                log.errorf(c, `[transactions.GetAllTransactionsWithAccountBalanceByMaxTime] trasaction type (${transaction.transactionId}) is invalid (id:${transaction.type})`);
                throw errs.ErrTransactionTypeInvalid;
            }

            accumulatedBalances.set(transaction.accountId, accumulatedBalance);

            if (transaction.transactionTime < minTransactionTime) {
                accumulatedBalancesBeforeStartTime.set(transaction.accountId, accumulatedBalance);
                continue;
            }

            const yearMonthDay = formatUnixTimeToNumericYearMonthDay(getUnixTimeFromTransactionTime(transaction.transactionTime), clientTimezone);
            const groupKey = `${yearMonthDay}_${transaction.accountId}`;
            const dailyAccountBalance = accountDailyLastBalances.get(groupKey);

            if (dailyAccountBalance) {
                dailyAccountBalance.accountClosingBalance = accumulatedBalance;
            } else {
                accountDailyLastBalances.set(groupKey, {
                    transaction: newTransaction({ accountId: transaction.accountId }),
                    accountOpeningBalance: lastAccumulatedBalance,
                    accountClosingBalance: accumulatedBalance,
                });
            }
        }

        let firstTransactionTime = allTransactions[allTransactions.length - 1]!.transactionTime;

        if (minTransactionTime > firstTransactionTime) {
            firstTransactionTime = minTransactionTime;
        }

        const firstYearMonthDay = formatUnixTimeToNumericYearMonthDay(getUnixTimeFromTransactionTime(firstTransactionTime), clientTimezone);

        for (const [accountId, accumulatedBalance] of accumulatedBalancesBeforeStartTime) {
            if (accumulatedBalance === 0n) {
                continue;
            }

            const groupKey = `${firstYearMonthDay}_${accountId}`;

            if (accountDailyLastBalances.has(groupKey)) {
                continue;
            }

            accountDailyLastBalances.set(groupKey, {
                transaction: newTransaction({ accountId: accountId }),
                accountOpeningBalance: accumulatedBalance,
                accountClosingBalance: accumulatedBalance,
            });
        }

        for (const [groupKey, transactionWithAccountBalance] of accountDailyLastBalances) {
            const yearMonthDay = stringToInt32(groupKey.split('_')[0]!);
            let dailyAccountBalances = accountDailyBalances.get(yearMonthDay);

            if (!dailyAccountBalances) {
                dailyAccountBalances = [];
                accountDailyBalances.set(yearMonthDay, dailyAccountBalances);
            }

            dailyAccountBalances.push(transactionWithAccountBalance);
        }

        return accountDailyBalances;
    }

    // getTransactionsByMaxTimeUpToCount returns transactions before given time up to the count
    public async getTransactionsByMaxTimeUpToCount(c: Context, uid: bigint, maxTransactionTime: number, minTransactionTime: number, filter: TransactionQueryFilter, page: number, count: number, pageCount: number, needOneMoreItem: boolean, noDuplicated: boolean): Promise<Transaction[]> {
        if (maxTransactionTime <= 0) {
            maxTransactionTime = nowMaxTransactionTime();
        }

        if (page < 0) {
            throw errs.ErrPageIndexInvalid;
        } else if (page === 0) {
            page = 1;
        }

        if (count < 1) {
            throw errs.ErrPageCountInvalid;
        }

        let finalExpectedCount = count;

        if (needOneMoreItem) {
            finalExpectedCount++;
        }

        const allTransactions: Transaction[] = [];
        const startOffset = (page - 1) * count;
        let firstFetchCount = pageCount;

        if (finalExpectedCount < firstFetchCount) {
            firstFetchCount = finalExpectedCount;
        }

        const transactions = await this.getTransactionsByMaxTimeWithOffset(c, uid, maxTransactionTime, minTransactionTime, filter, startOffset, firstFetchCount, noDuplicated);
        allTransactions.push(...transactions);

        if (transactions.length < firstFetchCount) {
            return allTransactions;
        }

        maxTransactionTime = transactions[transactions.length - 1]!.transactionTime - 1;

        while (allTransactions.length < finalExpectedCount && maxTransactionTime > 0) {
            const remainingCount = finalExpectedCount - allTransactions.length;
            let fetchCount = pageCount;

            if (remainingCount < fetchCount) {
                fetchCount = remainingCount;
            }

            const moreTransactions = await this.getTransactionsByMaxTime(c, uid, maxTransactionTime, minTransactionTime, filter, 1, fetchCount, false, noDuplicated);
            allTransactions.push(...moreTransactions);

            if (moreTransactions.length < fetchCount) {
                break;
            }

            maxTransactionTime = moreTransactions[moreTransactions.length - 1]!.transactionTime - 1;
        }

        return allTransactions;
    }

    // getTransactionsByMaxTime returns transactions before given time
    public async getTransactionsByMaxTime(c: Context, uid: bigint, maxTransactionTime: number, minTransactionTime: number, filter: TransactionQueryFilter, page: number, count: number, needOneMoreItem: boolean, noDuplicated: boolean): Promise<Transaction[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (page < 0) {
            throw errs.ErrPageIndexInvalid;
        } else if (page === 0) {
            page = 1;
        }

        if (count < 1) {
            throw errs.ErrPageCountInvalid;
        }

        let finalCount = count;

        if (needOneMoreItem) {
            finalCount++;
        }

        return this.getTransactionsByMaxTimeWithOffset(c, uid, maxTransactionTime, minTransactionTime, filter, count * (page - 1), finalCount, noDuplicated);
    }

    private async getTransactionsByMaxTimeWithOffset(c: Context, uid: bigint, maxTransactionTime: number, minTransactionTime: number, filter: TransactionQueryFilter, offset: number, limit: number, noDuplicated: boolean): Promise<Transaction[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        let transactionDbType: TransactionDbType = 0;

        if (filter.transactionType > 0) {
            transactionDbType = transactionTypeToTransactionDbType(filter.transactionType);
        }

        const [condition, conditionParams] = this.buildTransactionQueryCondition(uid, maxTransactionTime, minTransactionTime, transactionDbType, filter.categoryIds, filter.accountIds, filter.tagFilters, filter.amountFilter, filter.keyword, filter.matchMode, noDuplicated);
        let query = this.userDataDB(uid).newSession(c).where(condition, ...conditionParams);
        query = this.appendFilterTagIdsConditionToQuery(query, uid, maxTransactionTime, minTransactionTime, filter.tagFilters, filter.noTags);
        query = this.appendFilterPicturesConditionToQuery(query, uid, filter.mustHavePictures);

        return query.limit(limit, offset).orderBy('transaction_time desc').find(TransactionTable);
    }

    // getTransactionsInMonthByPage returns all transactions in given year and month
    public async getTransactionsInMonthByPage(c: Context, uid: bigint, year: number, month: number, filter: TransactionQueryFilter): Promise<Transaction[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        let transactionDbType: TransactionDbType = 0;

        if (filter.transactionType > 0) {
            transactionDbType = transactionTypeToTransactionDbType(filter.transactionType);
        }

        let minTransactionTime: number;
        let maxTransactionTime: number;

        try {
            [minTransactionTime, maxTransactionTime] = getTransactionTimeRangeByYearMonth(year, month);
        } catch {
            throw errs.ErrSystemError;
        }

        const [condition, conditionParams] = this.buildTransactionQueryCondition(uid, maxTransactionTime, minTransactionTime, transactionDbType, filter.categoryIds, filter.accountIds, filter.tagFilters, filter.amountFilter, filter.keyword, filter.matchMode, true);
        let query = this.userDataDB(uid).newSession(c).where(condition, ...conditionParams);
        query = this.appendFilterTagIdsConditionToQuery(query, uid, maxTransactionTime, minTransactionTime, filter.tagFilters, filter.noTags);
        query = this.appendFilterPicturesConditionToQuery(query, uid, filter.mustHavePictures);

        const transactions = await query.orderBy('transaction_time desc').find(TransactionTable);
        const transactionsInMonth: Transaction[] = [];

        for (const transaction of transactions) {
            const transactionUnixTime = getUnixTimeFromTransactionTime(transaction.transactionTime);

            if (isUnixTimeEqualsYearAndMonth(transactionUnixTime, transactionTimezone(transaction), year, month)) {
                transactionsInMonth.push(transaction);
            }
        }

        return transactionsInMonth;
    }

    // getTransactionByTransactionId returns a transaction model according to transaction id
    public async getTransactionByTransactionId(c: Context, uid: bigint, transactionId: bigint): Promise<Transaction> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (transactionId <= 0n) {
            throw errs.ErrTransactionIdInvalid;
        }

        const transaction = await this.userDataDB(uid).newSession(c).id(transactionId).where('uid=? AND deleted=?', uid, false).get(TransactionTable);

        if (!transaction) {
            throw errs.ErrTransactionNotFound;
        }

        return transaction;
    }

    // getTransactionsByTransactionIds returns transaction models according to transaction ids
    public async getTransactionsByTransactionIds(c: Context, uid: bigint, transactionIds: bigint[]): Promise<Transaction[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (transactionIds.length <= 0) {
            throw errs.ErrTransactionIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).in('transaction_id', transactionIds).find(TransactionTable);
    }

    // getAllTransactionCount returns total count of transactions
    public async getAllTransactionCount(c: Context, uid: bigint): Promise<number> {
        return this.getTransactionCount(c, uid, 0, 0, emptyTransactionQueryFilter);
    }

    // getTransactionCount returns count of transactions
    public async getTransactionCount(c: Context, uid: bigint, maxTransactionTime: number, minTransactionTime: number, filter: TransactionQueryFilter): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        let transactionDbType: TransactionDbType = 0;

        if (filter.transactionType > 0) {
            transactionDbType = transactionTypeToTransactionDbType(filter.transactionType);
        }

        const [condition, conditionParams] = this.buildTransactionQueryCondition(uid, maxTransactionTime, minTransactionTime, transactionDbType, filter.categoryIds, filter.accountIds, filter.tagFilters, filter.amountFilter, filter.keyword, filter.matchMode, true);
        let query = this.userDataDB(uid).newSession(c).where(condition, ...conditionParams);
        query = this.appendFilterTagIdsConditionToQuery(query, uid, maxTransactionTime, minTransactionTime, filter.tagFilters, filter.noTags);
        query = this.appendFilterPicturesConditionToQuery(query, uid, filter.mustHavePictures);

        return query.count(TransactionTable);
    }

    // createTransaction saves a new transaction to database
    public async createTransaction(c: Context, transaction: Transaction, tagIds: bigint[], pictureIds: bigint[] | null): Promise<void> {
        if (transaction.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        this.isAccountIdValid(transaction);

        const now = nowUnix();
        let needTransactionUuidCount = 1;

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            needTransactionUuidCount = 2;
        }

        const transactionUuids = this.generateUuids(UUID_TYPE_TRANSACTION, needTransactionUuidCount);

        if (!transactionUuids || transactionUuids.length < needTransactionUuidCount) {
            throw errs.ErrSystemIsBusy;
        }

        tagIds = toUniqueInt64Slice(tagIds);
        const tagIndexUuids = this.generateUuids(UUID_TYPE_TAG_INDEX, tagIds.length);

        if (!tagIndexUuids || tagIndexUuids.length < tagIds.length) {
            throw errs.ErrSystemIsBusy;
        }

        transaction.transactionId = transactionUuids[0]!;

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            transaction.relatedId = transactionUuids[1]!;
        }

        transaction.transactionTime = getMinTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
        transaction.createdUnixTime = now;
        transaction.updatedUnixTime = now;

        const transactionTagIndexes = tagIds.map((tagId, i) => newTransactionTagIndex({
            tagIndexId: tagIndexUuids[i]!,
            uid: transaction.uid,
            deleted: false,
            tagId: tagId,
            transactionId: transaction.transactionId,
            createdUnixTime: now,
            updatedUnixTime: now,
        }));

        const pictureUpdateModel: Partial<TransactionPictureInfo> = {
            transactionId: transaction.transactionId,
            updatedUnixTime: now,
        };

        const userDataDb = this.userDataDB(transaction.uid);

        await userDataDb.doTransaction(c, async sess => {
            await this.doCreateTransaction(c, userDataDb, sess, transaction, transactionTagIndexes, tagIds, pictureIds, pictureUpdateModel);
        });
    }

    // batchCreateTransactions saves new transactions to database
    public async batchCreateTransactions(c: Context, uid: bigint, transactions: Transaction[], allTagIds: Map<number, bigint[]>, processHandler: TaskProcessUpdateHandler | null): Promise<void> {
        const now = nowUnix();
        let currentProcess = 0;
        const processUpdateStep = Math.max(100, Math.floor(transactions.length / 100));
        let needTransactionUuidCount = 0;
        let needTagIndexUuidCount = 0;

        for (const transaction of transactions) {
            if (transaction.uid !== uid) {
                throw errs.ErrUserIdInvalid;
            }

            this.isAccountIdValid(transaction);

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                needTransactionUuidCount += 2;
            } else {
                needTransactionUuidCount++;
            }

            transaction.transactionTime = getMinTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
            transaction.createdUnixTime = now;
            transaction.updatedUnixTime = now;
        }

        for (const [index, tagIds] of allTagIds) {
            if (index < 0 || index >= transactions.length) {
                throw errs.ErrOperationFailed;
            }

            needTagIndexUuidCount += toUniqueInt64Slice(tagIds).length;
        }

        if (needTransactionUuidCount > 65535 || needTagIndexUuidCount > 65535) {
            throw errs.ErrImportTooManyTransaction;
        }

        const transactionUuids = this.generateUuids(UUID_TYPE_TRANSACTION, needTransactionUuidCount);
        let transactionUuidIndex = 0;

        if (!transactionUuids || transactionUuids.length < needTransactionUuidCount) {
            throw errs.ErrSystemIsBusy;
        }

        for (const transaction of transactions) {
            transaction.transactionId = transactionUuids[transactionUuidIndex++]!;

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                transaction.relatedId = transactionUuids[transactionUuidIndex++]!;
            }
        }

        const tagIndexUuids = this.generateUuids(UUID_TYPE_TAG_INDEX, needTagIndexUuidCount);
        let tagIndexUuidIndex = 0;

        if (!tagIndexUuids || tagIndexUuids.length < needTagIndexUuidCount) {
            throw errs.ErrSystemIsBusy;
        }

        const allTransactionTagIndexes = new Map<bigint, TransactionTagIndex[]>();
        const allTransactionTagIds = new Map<bigint, bigint[]>();

        for (const [index, tagIds] of allTagIds) {
            const transaction = transactions[index]!;
            const uniqueTagIds = toUniqueInt64Slice(tagIds);
            const transactionTagIndexes: TransactionTagIndex[] = [];

            for (const tagId of uniqueTagIds) {
                transactionTagIndexes.push(newTransactionTagIndex({
                    tagIndexId: tagIndexUuids[tagIndexUuidIndex++]!,
                    uid: transaction.uid,
                    deleted: false,
                    tagId: tagId,
                    transactionId: transaction.transactionId,
                    createdUnixTime: now,
                    updatedUnixTime: now,
                }));
            }

            allTransactionTagIndexes.set(transaction.transactionId, transactionTagIndexes);
            allTransactionTagIds.set(transaction.transactionId, uniqueTagIds);
        }

        const userDataDb = this.userDataDB(uid);

        await userDataDb.doTransaction(c, async sess => {
            for (let i = 0; i < transactions.length; i++) {
                const transaction = transactions[i]!;
                const transactionTagIndexes = allTransactionTagIndexes.get(transaction.transactionId) ?? [];
                const transactionTagIds = allTransactionTagIds.get(transaction.transactionId) ?? [];
                let createError: unknown = null;

                try {
                    await this.doCreateTransaction(c, userDataDb, sess, transaction, transactionTagIndexes, transactionTagIds, null, null);
                } catch (err) {
                    createError = err;
                }

                currentProcess = i / transactions.length * 100;

                if (processHandler && i % processUpdateStep === 0) {
                    processHandler(currentProcess);
                }

                if (createError !== null) {
                    const transactionUnixTime = getUnixTimeFromTransactionTime(transaction.transactionTime);
                    log.errorf(c, `[transactions.BatchCreateTransactions] failed to create trasaction (datetime: ${formatUnixTimeToLongDateTime(transactionUnixTime, transactionTimezone(transaction))}, type: ${transactionDbTypeName(transaction.type)}, amount: ${transaction.amount})`);
                    throw createError;
                }
            }
        });
    }

    // createScheduledTransactions saves all scheduled transactions that should be created now
    public async createScheduledTransactions(c: Context, currentUnixTime: number, intervalSeconds: number): Promise<void> {
        const allTemplates: TransactionTemplate[] = [];
        const intervalMinute = Math.floor(intervalSeconds / 60);
        const currentTime = DateTime.fromSeconds(currentUnixTime);
        const currentMinute = Math.floor(currentTime.minute / intervalMinute) * intervalMinute;
        const startTime = DateTime.fromObject({ year: currentTime.year, month: currentTime.month, day: currentTime.day, hour: currentTime.hour, minute: currentMinute, second: 0 });
        const startTimeInUTC = startTime.toUTC();
        const minutesElapsedOfDayInUtc = startTimeInUTC.hour * 60 + startTimeInUTC.minute;
        const secondsElapsedOfDayInUtc = minutesElapsedOfDayInUtc * 60;
        const todayFirstUnixTimeInUTC = Math.floor(startTimeInUTC.toSeconds()) - secondsElapsedOfDayInUtc;
        const startUnixTime = Math.floor(startTime.toSeconds());

        const minScheduledAt = minutesElapsedOfDayInUtc;
        const maxScheduledAt = minScheduledAt + intervalMinute;

        for (let i = 0; i < this.userDataDBCount(); i++) {
            const templates = await this.userDataDBByIndex(i).newSession(c).where('deleted=?' +
                ' AND template_type=?' +
                ' AND (scheduled_frequency_type=? OR scheduled_frequency_type=? OR scheduled_frequency_type=? OR scheduled_frequency_type=? OR scheduled_frequency_type=?)' +
                ' AND (scheduled_start_time IS NULL OR scheduled_start_time<=?)' +
                ' AND (scheduled_end_time IS NULL OR scheduled_end_time>=?)' +
                ' AND scheduled_at>=?' +
                ' AND scheduled_at<?',
            false,
            TRANSACTION_TEMPLATE_TYPE_SCHEDULE,
            TRANSACTION_SCHEDULE_FREQUENCY_TYPE_WEEKLY, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_MONTHLY, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DAILY, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_YEARLY, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS,
            startUnixTime,
            startUnixTime,
            minScheduledAt,
            maxScheduledAt).find(TransactionTemplateTable);

            allTemplates.push(...templates);
        }

        if (allTemplates.length < 1) {
            return;
        }

        log.infof(c, `[transactions.CreateScheduledTransactions] should process ${allTemplates.length} scheduled transaction templates now (scheduled at from ${minScheduledAt} to ${maxScheduledAt})`);

        let successCount = 0;
        let skipCount = 0;
        let failedCount = 0;

        for (const template of allTemplates) {
            if (template.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED) {
                skipCount++;
                log.warnf(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" disabled scheduled transaction frequency`);
                continue;
            }

            if ((template.scheduledFrequencyType !== TRANSACTION_SCHEDULE_FREQUENCY_TYPE_WEEKLY &&
                template.scheduledFrequencyType !== TRANSACTION_SCHEDULE_FREQUENCY_TYPE_MONTHLY &&
                template.scheduledFrequencyType !== TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DAILY &&
                template.scheduledFrequencyType !== TRANSACTION_SCHEDULE_FREQUENCY_TYPE_YEARLY &&
                template.scheduledFrequencyType !== TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS) ||
                template.scheduledFrequency === '') {
                skipCount++;
                log.warnf(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" has invalid scheduled transaction frequency`);
                continue;
            }

            let frequencyValues: number[];

            try {
                frequencyValues = stringArrayToInt64Array(template.scheduledFrequency.split(',')).map(v => Number(v));
            } catch (err) {
                skipCount++;
                log.warnf(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" has invalid scheduled transaction frequency, because ${(err as Error).message}`);
                continue;
            }

            const templateTimeZone = fixedZone(template.scheduledTimezoneUtcOffset);
            const transactionUnixTime = todayFirstUnixTimeInUTC + template.scheduledAt * 60;
            const transactionTime = DateTime.fromSeconds(transactionUnixTime, { zone: templateTimeZone });

            if (template.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_MONTHLY) {
                const maxDayInMonth = getMaxDayOfMonth(transactionTime.year, transactionTime.month);

                for (let j = 0; j < frequencyValues.length; j++) {
                    if (frequencyValues[j]! < 0) {
                        frequencyValues[j] = maxDayInMonth + frequencyValues[j]! + 1;
                    }
                }
            }

            const frequencyValueSet = new Set(frequencyValues);

            if (template.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_WEEKLY && !frequencyValueSet.has(transactionTime.weekday % 7)) {
                skipCount++;
                log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" does not need to create transaction, today is ${startTimeInUTC.toFormat('cccc')}`);
                continue;
            } else if (template.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_MONTHLY && !frequencyValueSet.has(transactionTime.day)) {
                skipCount++;
                log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" does not need to create transaction, today is ${startTimeInUTC.day} of month`);
                continue;
            } else if (template.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_YEARLY && !frequencyValueSet.has(transactionTime.month * 100 + transactionTime.day)) {
                skipCount++;
                log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" does not need to create transaction, today is ${startTimeInUTC.month}-${startTimeInUTC.day} of year`);
                continue;
            } else if (template.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS) {
                if (template.scheduledStartTime === null || frequencyValues.length !== 1 || frequencyValues[0]! <= 0) {
                    skipCount++;
                    log.warnf(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" has invalid scheduled transaction frequency for every N days`);
                    continue;
                }

                const n = frequencyValues[0]!;
                const startDate = DateTime.fromSeconds(template.scheduledStartTime, { zone: templateTimeZone });
                const startDateOnly = DateTime.fromObject({ year: startDate.year, month: startDate.month, day: startDate.day }, { zone: templateTimeZone });
                const transactionDateOnly = DateTime.fromObject({ year: transactionTime.year, month: transactionTime.month, day: transactionTime.day }, { zone: templateTimeZone });
                const daysDiff = Math.trunc(transactionDateOnly.diff(startDateOnly, 'hours').hours / 24);

                if (daysDiff < 0 || daysDiff % n !== 0) {
                    skipCount++;
                    log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" does not need to create transaction, days diff is ${daysDiff} with interval ${n}`);
                    continue;
                }
            }

            if (template.scheduledStartTime !== null && template.scheduledStartTime > transactionUnixTime) {
                skipCount++;
                log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" does not need to create transaction, now is earlier than the start time ${template.scheduledStartTime}`);
                continue;
            }

            if (template.scheduledEndTime !== null && template.scheduledEndTime < transactionUnixTime) {
                skipCount++;
                log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" does not need to create transaction, now is later than the end time ${template.scheduledEndTime}`);
                continue;
            }

            let transactionDbType: TransactionDbType;

            if (template.type === TRANSACTION_TYPE_EXPENSE) {
                transactionDbType = TRANSACTION_DB_TYPE_EXPENSE;
            } else if (template.type === TRANSACTION_TYPE_INCOME) {
                transactionDbType = TRANSACTION_DB_TYPE_INCOME;
            } else if (template.type === TRANSACTION_TYPE_TRANSFER) {
                transactionDbType = TRANSACTION_DB_TYPE_TRANSFER_OUT;
            } else {
                skipCount++;
                log.warnf(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" has invalid transaction type`);
                continue;
            }

            const transaction = newTransaction({
                uid: template.uid,
                type: transactionDbType,
                categoryId: template.categoryId,
                transactionTime: getMinTransactionTimeFromUnixTime(Math.floor(transactionTime.toSeconds())),
                timezoneUtcOffset: template.scheduledTimezoneUtcOffset,
                accountId: template.accountId,
                amount: template.amount,
                hideAmount: template.hideAmount,
                comment: template.comment,
                createdIp: c.clientIP(),
                scheduledCreated: true,
            });

            if (template.type === TRANSACTION_TYPE_TRANSFER) {
                transaction.relatedAccountId = template.relatedAccountId;
                transaction.relatedAccountAmount = template.relatedAccountAmount;
            }

            // the same window may be processed more than once (e.g. an external scheduler catching up the missed windows),
            // so skips the template whose transaction has been created in this window (including the deleted one)
            // ponytail: matched by account, category and time (not by template id, which transactions do not store),
            // two templates of the same account and category scheduled at the same minute are treated as one
            const createdCount = await this.userDataDB(template.uid).newSession(c).where('uid=? AND scheduled_created=? AND type=? AND account_id=? AND category_id=? AND transaction_time>=? AND transaction_time<=?',
                template.uid, true, transactionDbType, template.accountId, template.categoryId,
                getMinTransactionTimeFromUnixTime(Math.floor(transactionTime.toSeconds())), getMaxTransactionTimeFromUnixTime(Math.floor(transactionTime.toSeconds()))).count(TransactionTable);

            if (createdCount > 0) {
                skipCount++;
                log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" does not need to create transaction, it has been created`);
                continue;
            }

            const tagIds = getTemplateTagIds(template);

            try {
                await this.createTransaction(c, transaction, tagIds, null);
                successCount++;
                log.infof(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" has created a new trasaction "id:${transaction.transactionId}"`);
            } catch (err) {
                failedCount++;
                log.errorf(c, `[transactions.CreateScheduledTransactions] transaction template "id:${template.templateId}" failed to create new trasaction, because ${(err as Error).message}`);
            }
        }

        log.infof(c, `[transactions.CreateScheduledTransactions] ${successCount} transactions has been created successfully, ${skipCount} templates does not need to create transactions and ${failedCount} transactions failed to create`);
    }

    private async updateAccountBalanceOrThrow(c: Context, sess: Session, account: Account, delta: number, logPrefix: string, related: boolean = false): Promise<void> {
        let updatedRows: number;

        try {
            updatedRows = await this.updateAccountBalance(sess, account, delta);
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to update ${related ? 'related ' : ''}account balance, because ${(err as Error).message}`);
            throw err;
        }

        if (updatedRows < 1) {
            log.errorf(c, `[${logPrefix}] failed to update ${related ? 'related ' : ''}account balance`);
            throw errs.ErrDatabaseOperationFailed;
        }
    }

    // modifyTransaction saves an existed transaction to database
    public async modifyTransaction(c: Context, transaction: Transaction, changeToTransfer: boolean, currentTagIdsCount: number, addTagIds: bigint[], removeTagIds: bigint[], addPictureIds: bigint[], removePictureIds: bigint[]): Promise<void> {
        if (transaction.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (transaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE &&
            transaction.type !== TRANSACTION_DB_TYPE_INCOME &&
            transaction.type !== TRANSACTION_DB_TYPE_EXPENSE &&
            transaction.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            log.warnf(c, `[transactions.ModifyTransaction] not allowed to modify to transaction type ${transaction.type}`);
            throw errs.ErrTransactionTypeInvalid;
        }

        let newRelatedTransactionId = 0n;

        if (changeToTransfer) {
            newRelatedTransactionId = this.generateUuid(UUID_TYPE_TRANSACTION);

            if (newRelatedTransactionId < 1n) {
                throw errs.ErrSystemIsBusy;
            }
        }

        const tagIndexUuids = this.generateUuids(UUID_TYPE_TAG_INDEX, addTagIds.length);

        if (!tagIndexUuids || tagIndexUuids.length < addTagIds.length) {
            throw errs.ErrSystemIsBusy;
        }

        const updateCols: string[] = [];
        const now = nowUnix();

        transaction.transactionTime = getMinTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
        transaction.updatedUnixTime = now;
        updateCols.push('updated_unix_time');

        addTagIds = toUniqueInt64Slice(addTagIds);
        removeTagIds = toUniqueInt64Slice(removeTagIds);

        const transactionTagIndexes = addTagIds.map((tagId, i) => newTransactionTagIndex({
            tagIndexId: tagIndexUuids[i]!,
            uid: transaction.uid,
            deleted: false,
            tagId: tagId,
            transactionId: transaction.transactionId,
            createdUnixTime: now,
            updatedUnixTime: now,
        }));

        const logPrefix = 'transactions.ModifyTransaction';

        await this.userDataDB(transaction.uid).doTransaction(c, async sess => {
            let oldTransaction: Transaction | null;

            try {
                oldTransaction = await sess.id(transaction.transactionId).where('uid=? AND deleted=?', transaction.uid, false).get(TransactionTable);
            } catch (err) {
                log.errorf(c, `[transactions.ModifyTransaction] failed to get current transaction, because ${(err as Error).message}`);
                throw err;
            }

            if (!oldTransaction) {
                throw errs.ErrTransactionNotFound;
            }

            if (oldTransaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE &&
                oldTransaction.type !== TRANSACTION_DB_TYPE_INCOME &&
                oldTransaction.type !== TRANSACTION_DB_TYPE_EXPENSE &&
                oldTransaction.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                log.warnf(c, `[transactions.ModifyTransaction] transaction type ${oldTransaction.type} is not allowed to modify`);
                throw errs.ErrTransactionTypeInvalid;
            }

            if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE && oldTransaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                throw errs.ErrTransactionTypeInvalid;
            }

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                transaction.relatedId = oldTransaction.relatedId;
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && oldTransaction.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                if (newRelatedTransactionId < 1n) {
                    throw errs.ErrSystemIsBusy;
                }

                transaction.relatedId = newRelatedTransactionId;
                updateCols.push('related_id');
            }

            this.isAccountIdValid(transaction);

            let sourceAccount: Account;
            let destinationAccount: Account | null;

            try {
                [sourceAccount, destinationAccount] = await this.getAccountModels(sess, transaction);
            } catch (err) {
                log.errorf(c, `[transactions.ModifyTransaction] failed to get account, because ${(err as Error).message}`);
                throw err;
            }

            if (sourceAccount.hidden || (destinationAccount && destinationAccount.hidden)) {
                throw errs.ErrCannotModifyTransactionInHiddenAccount;
            }

            if (sourceAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS || (destinationAccount && destinationAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS)) {
                throw errs.ErrCannotModifyTransactionInParentAccount;
            }

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && sourceAccount.currency === destinationAccount!.currency && transaction.amount !== transaction.relatedAccountAmount) {
                throw errs.ErrTransactionSourceAndDestinationAmountNotEqual;
            }

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && (transaction.amount < 0 || transaction.relatedAccountAmount < 0)) {
                throw errs.ErrTransferTransactionAmountCannotBeLessThanZero;
            }

            let oldSourceAccount: Account;
            let oldDestinationAccount: Account | null;

            try {
                [oldSourceAccount, oldDestinationAccount] = await this.getOldAccountModels(sess, transaction, oldTransaction, sourceAccount, destinationAccount);
            } catch (err) {
                log.errorf(c, `[transactions.ModifyTransaction] failed to get old account, because ${(err as Error).message}`);
                throw err;
            }

            if (oldSourceAccount.hidden || (oldDestinationAccount && oldDestinationAccount.hidden)) {
                throw errs.ErrCannotAddTransactionToHiddenAccount;
            }

            // Append modified columns and verify
            if (transaction.type !== oldTransaction.type || transaction.categoryId !== oldTransaction.categoryId) {
                await this.isCategoryValid(sess, transaction);
                updateCols.push('category_id');
            }

            if (transaction.type !== oldTransaction.type) {
                updateCols.push('type');
            }

            let modifyTransactionTime = false;

            if (getUnixTimeFromTransactionTime(transaction.transactionTime) !== getUnixTimeFromTransactionTime(oldTransaction.transactionTime)) {
                if (oldTransaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                    throw errs.ErrBalanceModificationTransactionCannotModifyTime;
                }

                const minTransactionTime = getMinTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
                const maxTransactionTime = getMaxTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
                let sameSecondLatestTransaction: Transaction | null;

                try {
                    sameSecondLatestTransaction = await sess.where('uid=? AND transaction_time>=? AND transaction_time<=?', transaction.uid, minTransactionTime, maxTransactionTime).orderBy('transaction_time desc').limit(1).get(TransactionTable);
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to get trasaction time, because ${(err as Error).message}`);
                    throw err;
                }

                if (sameSecondLatestTransaction && sameSecondLatestTransaction.transactionTime < maxTransactionTime - 1) {
                    transaction.transactionTime = sameSecondLatestTransaction.transactionTime + 1;
                } else if (sameSecondLatestTransaction && sameSecondLatestTransaction.transactionTime === maxTransactionTime - 1) {
                    throw errs.ErrTooMuchTransactionInOneSecond;
                }

                updateCols.push('transaction_time');
                modifyTransactionTime = true;
            }

            if (transaction.timezoneUtcOffset !== oldTransaction.timezoneUtcOffset) {
                updateCols.push('timezone_utc_offset');
            }

            if (transaction.accountId !== oldTransaction.accountId) {
                updateCols.push('account_id');
            }

            if (transaction.amount !== oldTransaction.amount) {
                if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                    transaction.relatedAccountAmount = oldTransaction.relatedAccountAmount + transaction.amount - oldTransaction.amount;
                    updateCols.push('related_account_amount');
                }

                updateCols.push('amount');
            }

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                if (transaction.relatedAccountId !== oldTransaction.relatedAccountId || oldTransaction.type === TRANSACTION_DB_TYPE_INCOME || oldTransaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                    updateCols.push('related_account_id');
                }

                if (transaction.relatedAccountAmount !== oldTransaction.relatedAccountAmount || oldTransaction.type === TRANSACTION_DB_TYPE_INCOME || oldTransaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                    updateCols.push('related_account_amount');
                }
            } else if ((transaction.type === TRANSACTION_DB_TYPE_INCOME || transaction.type === TRANSACTION_DB_TYPE_EXPENSE) && oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                transaction.relatedAccountId = 0n;
                transaction.relatedAccountAmount = 0;
                updateCols.push('related_account_id');
                updateCols.push('related_account_amount');
            }

            if (transaction.hideAmount !== oldTransaction.hideAmount) {
                updateCols.push('hide_amount');
            }

            if (transaction.comment !== oldTransaction.comment) {
                updateCols.push('comment');
            }

            if (transaction.geoLongitude !== oldTransaction.geoLongitude) {
                updateCols.push('geo_longitude');
            }

            if (transaction.geoLatitude !== oldTransaction.geoLatitude) {
                updateCols.push('geo_latitude');
            }

            await this.isTagsValid(sess, transaction.uid, transactionTagIndexes, addTagIds);
            await this.isPicturesValid(sess, transaction, addPictureIds);

            // Not allow to add transaction before balance modification transaction
            if (transaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                let otherTransactionExists: boolean;

                try {
                    if (destinationAccount && sourceAccount.accountId !== destinationAccount.accountId) {
                        otherTransactionExists = await sess.cols('uid', 'deleted', 'account_id').where('uid=? AND deleted=? AND type=? AND (account_id=? OR account_id=?) AND transaction_time>=?', transaction.uid, false, TRANSACTION_DB_TYPE_MODIFY_BALANCE, sourceAccount.accountId, destinationAccount.accountId, transaction.transactionTime).limit(1).exist(TransactionTable);
                    } else {
                        otherTransactionExists = await sess.cols('uid', 'deleted', 'account_id').where('uid=? AND deleted=? AND type=? AND account_id=? AND transaction_time>=?', transaction.uid, false, TRANSACTION_DB_TYPE_MODIFY_BALANCE, sourceAccount.accountId, transaction.transactionTime).limit(1).exist(TransactionTable);
                    }
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to get whether other transactions exist, because ${(err as Error).message}`);
                    throw err;
                }

                if (otherTransactionExists) {
                    throw errs.ErrCannotAddTransactionBeforeBalanceModificationTransaction;
                }
            }

            // Update transaction row
            let updatedRows: number;

            try {
                updatedRows = await sess.id(transaction.transactionId).cols(...updateCols).where('uid=? AND deleted=?', transaction.uid, false).update(TransactionTable, transaction);
            } catch (err) {
                log.errorf(c, `[transactions.ModifyTransaction] failed to update transaction, because ${(err as Error).message}`);
                throw err;
            }

            if (updatedRows < 1) {
                throw errs.ErrTransactionNotFound;
            }

            // Update related transaction row
            if (transaction.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT && oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                let deletedRows: number;

                try {
                    deletedRows = await sess.id(oldTransaction.relatedId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', transaction.uid, false).update(TransactionTable, { deleted: true, deletedUnixTime: now });
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to delete old related transaction, because ${(err as Error).message}`);
                    throw err;
                }

                if (deletedRows < 1) {
                    log.errorf(c, '[transactions.ModifyTransaction] failed to delete old related transaction');
                    throw errs.ErrDatabaseOperationFailed;
                }
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && oldTransaction.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                const relatedTransaction = this.getRelatedTransferTransaction(transaction)!;
                const minTransactionTime = getMinTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
                const maxTransactionTime = getMaxTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
                let sameSecondLatestTransaction: Transaction | null;

                try {
                    sameSecondLatestTransaction = await sess.where('uid=? AND transaction_time>=? AND transaction_time<=?', transaction.uid, minTransactionTime, maxTransactionTime).orderBy('transaction_time desc').limit(1).get(TransactionTable);
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to get trasaction time, because ${(err as Error).message}`);
                    throw err;
                }

                if (!sameSecondLatestTransaction) {
                    log.errorf(c, `[transactions.ModifyTransaction] it should have transactions in ${minTransactionTime} - ${maxTransactionTime}, but result is empty`);
                    throw errs.ErrDatabaseOperationFailed;
                } else if (sameSecondLatestTransaction.transactionTime === maxTransactionTime - 1) {
                    throw errs.ErrTooMuchTransactionInOneSecond;
                }

                relatedTransaction.transactionTime = sameSecondLatestTransaction.transactionTime + 1;
                let createdRows: number;

                try {
                    createdRows = await sess.insert(TransactionTable, relatedTransaction);
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to create related transaction, because ${(err as Error).message}`);
                    throw err;
                }

                if (createdRows < 1) {
                    log.errorf(c, '[transactions.ModifyTransaction] failed to create related transaction');
                    throw errs.ErrDatabaseOperationFailed;
                }
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                const relatedTransaction = this.getRelatedTransferTransaction(transaction)!;

                if (getUnixTimeFromTransactionTime(transaction.transactionTime) !== getUnixTimeFromTransactionTime(relatedTransaction.transactionTime)) {
                    throw errs.ErrTooMuchTransactionInOneSecond;
                }

                const relatedUpdateCols = this.getRelatedUpdateColumns(updateCols);
                let relatedUpdatedRows: number;

                try {
                    relatedUpdatedRows = await sess.id(relatedTransaction.transactionId).cols(...relatedUpdateCols).where('uid=? AND deleted=?', relatedTransaction.uid, false).update(TransactionTable, relatedTransaction);
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to update related transaction, because ${(err as Error).message}`);
                    throw err;
                }

                if (relatedUpdatedRows < 1) {
                    log.errorf(c, '[transactions.ModifyTransaction] failed to update related transaction');
                    throw errs.ErrDatabaseOperationFailed;
                }
            }

            // Update transaction tag index
            if (removeTagIds.length > 0) {
                let deletedRows: number;

                try {
                    deletedRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=? AND transaction_id=?', transaction.uid, false, transaction.transactionId).in('tag_id', removeTagIds).update(TransactionTagIndexTable, { deleted: true, deletedUnixTime: now });
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to remove old transaction tag index, because ${(err as Error).message}`);
                    throw err;
                }

                if (deletedRows < 1) {
                    throw errs.ErrTransactionTagNotFound;
                }
            }

            if (transactionTagIndexes.length > 0) {
                for (const transactionTagIndex of transactionTagIndexes) {
                    transactionTagIndex.transactionTime = transaction.transactionTime;

                    try {
                        await sess.insert(TransactionTagIndexTable, transactionTagIndex);
                    } catch (err) {
                        log.errorf(c, `[transactions.ModifyTransaction] failed to add new transaction tag index, because ${(err as Error).message}`);
                        throw err;
                    }
                }
            } else if (transactionTagIndexes.length === 0 && currentTagIdsCount > 0 && modifyTransactionTime) {
                try {
                    await sess.where('uid=? AND deleted=? AND transaction_id=?', transaction.uid, false, transaction.transactionId).update(TransactionTagIndexTable, { transactionTime: transaction.transactionTime });
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to update transaction tag index, because ${(err as Error).message}`);
                    throw err;
                }
            }

            // Update transaction picture
            if (removePictureIds.length > 0) {
                let deletedRows: number;

                try {
                    deletedRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=? AND transaction_id=?', transaction.uid, false, transaction.transactionId).in('picture_id', removePictureIds).update(TransactionPictureInfoTable, { deleted: true, deletedUnixTime: now });
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to remove old transaction picture info, because ${(err as Error).message}`);
                    throw err;
                }

                if (deletedRows < 1) {
                    throw errs.ErrTransactionPictureNotFound;
                }
            }

            if (addPictureIds.length > 0) {
                try {
                    await sess.cols('transaction_id', 'updated_unix_time').where('uid=? AND deleted=? AND transaction_id=?', transaction.uid, false, TransactionPictureNewPictureTransactionId).in('picture_id', addPictureIds).update(TransactionPictureInfoTable, { transactionId: transaction.transactionId, updatedUnixTime: now });
                } catch (err) {
                    log.errorf(c, `[transactions.ModifyTransaction] failed to update new transaction picture info, because ${(err as Error).message}`);
                    throw err;
                }
            }

            // Update account table
            if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                if (transaction.accountId !== oldTransaction.accountId) {
                    throw errs.ErrBalanceModificationTransactionCannotChangeAccountId;
                }

                if (transaction.amount !== oldTransaction.amount && transaction.relatedAccountAmount !== oldTransaction.relatedAccountAmount) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, transaction.relatedAccountAmount - oldTransaction.relatedAccountAmount, logPrefix);
                }
            } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
                let oldAccountOldAmount = oldTransaction.amount;
                let oldAccountNewAmount = 0;
                let newAccountNewAmount = 0;

                if (oldTransaction.type === TRANSACTION_DB_TYPE_EXPENSE || oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                    oldAccountOldAmount = -oldTransaction.amount;
                }

                if (transaction.accountId === oldTransaction.accountId) {
                    oldAccountNewAmount = transaction.amount;
                } else {
                    newAccountNewAmount = transaction.amount;
                }

                if (oldAccountNewAmount !== oldAccountOldAmount) {
                    oldSourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, oldSourceAccount, oldAccountNewAmount - oldAccountOldAmount, logPrefix);
                }

                if (newAccountNewAmount !== 0) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, newAccountNewAmount, logPrefix);
                }

                if (oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                    oldDestinationAccount!.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, oldDestinationAccount!, -oldTransaction.relatedAccountAmount, logPrefix, true);
                }
            } else if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                let oldAccountOldAmount = oldTransaction.amount;
                let oldAccountNewAmount = 0;
                let newAccountNewAmount = 0;

                if (oldTransaction.type === TRANSACTION_DB_TYPE_INCOME) {
                    oldAccountOldAmount = -oldTransaction.amount;
                }

                if (transaction.accountId === oldTransaction.accountId) {
                    oldAccountNewAmount = transaction.amount;
                } else {
                    newAccountNewAmount = transaction.amount;
                }

                if (oldAccountNewAmount !== oldAccountOldAmount) {
                    oldSourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, oldSourceAccount, oldAccountOldAmount - oldAccountNewAmount, logPrefix);
                }

                if (newAccountNewAmount !== 0) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, -newAccountNewAmount, logPrefix);
                }

                if (oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                    oldDestinationAccount!.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, oldDestinationAccount!, -oldTransaction.relatedAccountAmount, logPrefix, true);
                }
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                let oldSourceAccountOldAmount = oldTransaction.amount;
                let oldSourceAccountNewAmount = 0;
                let newSourceAccountNewAmount = 0;

                if (oldTransaction.type === TRANSACTION_DB_TYPE_INCOME) {
                    oldSourceAccountOldAmount = -oldTransaction.amount;
                }

                if (transaction.accountId === oldTransaction.accountId) {
                    oldSourceAccountNewAmount = transaction.amount;
                } else {
                    newSourceAccountNewAmount = transaction.amount;
                }

                if (oldSourceAccountNewAmount !== oldSourceAccountOldAmount) {
                    oldSourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, oldSourceAccount, oldSourceAccountOldAmount - oldSourceAccountNewAmount, logPrefix);
                }

                if (newSourceAccountNewAmount !== 0) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, -newSourceAccountNewAmount, logPrefix);
                }

                let oldDestinationAccountNewAmount = 0;
                let newDestinationAccountNewAmount = 0;

                if (transaction.relatedAccountId === oldTransaction.relatedAccountId) {
                    oldDestinationAccountNewAmount = transaction.relatedAccountAmount;
                } else {
                    newDestinationAccountNewAmount = transaction.relatedAccountAmount;
                }

                if (oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                    if (oldDestinationAccountNewAmount !== oldTransaction.relatedAccountAmount) {
                        oldDestinationAccount!.updatedUnixTime = nowUnix();
                        await this.updateAccountBalanceOrThrow(c, sess, oldDestinationAccount!, oldDestinationAccountNewAmount - oldTransaction.relatedAccountAmount, logPrefix);
                    }
                }

                if (newDestinationAccountNewAmount !== 0) {
                    destinationAccount!.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceOrThrow(c, sess, destinationAccount!, newDestinationAccountNewAmount, logPrefix);
                }
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                throw errs.ErrTransactionTypeInvalid;
            }
        });
    }

    // batchUpdateTransactionsCategory updates category of given transactions
    public async batchUpdateTransactionsCategory(c: Context, uid: bigint, transactionIds: bigint[], newCategoryId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (transactionIds.length < 1) {
            throw errs.ErrTransactionIdInvalid;
        }

        if (newCategoryId <= 0n) {
            throw errs.ErrTransactionCategoryIdInvalid;
        }

        const uniqueTransactionIds = toUniqueInt64Slice(transactionIds);
        const updateModel: Partial<Transaction> = {
            categoryId: newCategoryId,
            updatedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const updatedRows = await sess.cols('category_id', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).in('transaction_id', uniqueTransactionIds).update(TransactionTable, updateModel);

            if (updatedRows < uniqueTransactionIds.length) {
                throw errs.ErrTransactionNotFound;
            }
        });
    }

    // batchAddTagsToTransactions adds tags to given transactions
    public async batchAddTagsToTransactions(c: Context, uid: bigint, transactions: Transaction[], addTransactionTagIds: Map<bigint, bigint[]>): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (addTransactionTagIds.size < 1) {
            throw errs.ErrTransactionIdInvalid;
        }

        const now = nowUnix();
        const transactionTagIndexes: TransactionTagIndex[] = [];
        const transactionsMap = new Map<bigint, Transaction>();
        const transactionTagIdsMap = new Set<bigint>();

        for (const transaction of transactions) {
            transactionsMap.set(transaction.transactionId, transaction);
        }

        for (const [transactionId, originalTagIds] of addTransactionTagIds) {
            if (transactionId <= 0n) {
                throw errs.ErrTransactionIdInvalid;
            }

            const transaction = transactionsMap.get(transactionId);

            if (!transaction) {
                throw errs.ErrTransactionNotFound;
            }

            const tagIds = toUniqueInt64Slice(originalTagIds);

            for (const tagId of tagIds) {
                if (tagId <= 0n) {
                    throw errs.ErrTransactionTagIdInvalid;
                }

                transactionTagIndexes.push(newTransactionTagIndex({
                    uid: uid,
                    deleted: false,
                    transactionTime: transaction.transactionTime,
                    tagId: tagId,
                    transactionId: transactionId,
                    createdUnixTime: now,
                    updatedUnixTime: now,
                }));

                transactionTagIdsMap.add(tagId);
            }
        }

        const tagIndexUuids = this.generateUuids(UUID_TYPE_TAG_INDEX, transactionTagIndexes.length);

        if (!tagIndexUuids || tagIndexUuids.length < transactionTagIndexes.length) {
            throw errs.ErrCannotAddTagsToTooManyTransactionsOneTime;
        }

        for (let i = 0; i < transactionTagIndexes.length; i++) {
            transactionTagIndexes[i]!.tagIndexId = tagIndexUuids[i]!;
        }

        const tagIds = Array.from(transactionTagIdsMap);

        await this.userDataDB(uid).doTransaction(c, async sess => {
            await this.isTagsValid(sess, uid, transactionTagIndexes, tagIds);

            for (const transactionTagIndex of transactionTagIndexes) {
                await sess.insert(TransactionTagIndexTable, transactionTagIndex);
            }
        });
    }

    // batchRemoveTagsFromTransactions removes tags from given transactions
    public async batchRemoveTagsFromTransactions(c: Context, uid: bigint, transactionIds: bigint[], tagIds: bigint[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (transactionIds.length < 1) {
            throw errs.ErrTransactionIdInvalid;
        }

        const uniqueTransactionIds = toUniqueInt64Slice(transactionIds);
        const uniqueTagIds = toUniqueInt64Slice(tagIds);

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const deletedRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).in('transaction_id', uniqueTransactionIds).in('tag_id', uniqueTagIds).update(TransactionTagIndexTable, { deleted: true, deletedUnixTime: nowUnix() });

            if (deletedRows < 1) {
                throw errs.ErrTransactionTagNotFound;
            }
        });
    }

    // batchClearAllTagsFromTransactions removes all tags from given transactions
    public async batchClearAllTagsFromTransactions(c: Context, uid: bigint, transactionIds: bigint[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (transactionIds.length < 1) {
            throw errs.ErrTransactionIdInvalid;
        }

        const uniqueTransactionIds = toUniqueInt64Slice(transactionIds);

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const deletedRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).in('transaction_id', uniqueTransactionIds).update(TransactionTagIndexTable, { deleted: true, deletedUnixTime: nowUnix() });

            if (deletedRows < 1) {
                throw errs.ErrTransactionTagNotFound;
            }
        });
    }

    // moveAllTransactionsBetweenAccounts moves all transactions from one account to another account
    public async moveAllTransactionsBetweenAccounts(c: Context, uid: bigint, fromAccountId: bigint, toAccountId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (fromAccountId <= 0n || toAccountId <= 0n) {
            throw errs.ErrAccountIdInvalid;
        }

        if (fromAccountId === toAccountId) {
            throw errs.ErrCannotMoveTransactionToSameAccount;
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const fromAccount = await sess.id(fromAccountId).where('uid=? AND deleted=?', uid, false).get(AccountTable);

            if (!fromAccount) {
                throw errs.ErrAccountNotFound;
            }

            const toAccount = await sess.id(toAccountId).where('uid=? AND deleted=?', uid, false).get(AccountTable);

            if (!toAccount) {
                throw errs.ErrAccountNotFound;
            }

            if (fromAccount.hidden || toAccount.hidden) {
                throw errs.ErrCannotMoveTransactionFromOrToHiddenAccount;
            }

            if (fromAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS || toAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
                throw errs.ErrCannotMoveTransactionFromOrToParentAccount;
            }

            if (fromAccount.currency !== toAccount.currency) {
                throw errs.ErrCannotMoveTransactionBetweenAccountsWithDifferentCurrencies;
            }

            const balanceModificationTransactions = await sess.where('uid=? AND deleted=? AND type=? AND (account_id=? OR account_id=?)', uid, false, TRANSACTION_DB_TYPE_MODIFY_BALANCE, fromAccountId, toAccountId).find(TransactionTable);

            if (balanceModificationTransactions.length > 2) {
                log.errorf(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has more than 2 balance modification transactions in account "id:${fromAccountId}" and account "id:${toAccountId}", cannot combine balance modification transaction`);
                throw errs.ErrOperationFailed;
            } else if (balanceModificationTransactions.length === 2 && balanceModificationTransactions[0]!.accountId !== balanceModificationTransactions[1]!.accountId) {
                let earlierTransaction: Transaction;
                let laterTransaction: Transaction;

                if (balanceModificationTransactions[0]!.transactionTime < balanceModificationTransactions[1]!.transactionTime) {
                    earlierTransaction = balanceModificationTransactions[0]!;
                    laterTransaction = balanceModificationTransactions[1]!;
                } else {
                    earlierTransaction = balanceModificationTransactions[1]!;
                    laterTransaction = balanceModificationTransactions[0]!;
                }

                const [mergedAmount, validAmount] = addInt64(earlierTransaction.amount, laterTransaction.amount);
                const [mergedRelatedAccountAmount, validRelatedAmount] = addInt64(earlierTransaction.relatedAccountAmount, laterTransaction.relatedAccountAmount);

                if (!validAmount || !validRelatedAmount ||
                    (mergedAmount <= MinimumTransactionAmount || mergedAmount >= MaximumTransactionAmount) ||
                    (mergedRelatedAccountAmount <= MinimumTransactionAmount || mergedRelatedAccountAmount >= MaximumTransactionAmount)) {
                    log.errorf(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" cannot combine balance modification transactions "id:${earlierTransaction.transactionId}" and "id:${laterTransaction.transactionId}", because the merged amount exceeds the supported range`);
                    throw errs.ErrMergedBalanceModificationTransactionAmountOverflow;
                }

                earlierTransaction.amount = mergedAmount;
                earlierTransaction.relatedAccountAmount = mergedRelatedAccountAmount;
                earlierTransaction.updatedUnixTime = nowUnix();

                const updatedRows = await sess.id(earlierTransaction.transactionId).cols('amount', 'related_account_amount', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTable, earlierTransaction);

                if (updatedRows < 1) {
                    log.errorf(c, '[transactions.MoveAllTransactionsBetweenAccounts] failed to update earlier balance modification transaction');
                    throw errs.ErrDatabaseOperationFailed;
                }

                laterTransaction.deleted = true;
                laterTransaction.deletedUnixTime = nowUnix();

                const deletedRows = await sess.id(laterTransaction.transactionId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTable, laterTransaction);

                if (deletedRows < 1) {
                    log.errorf(c, '[transactions.MoveAllTransactionsBetweenAccounts] failed to delete later balance modification transaction');
                    throw errs.ErrDatabaseOperationFailed;
                }

                log.infof(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has combined two balance modification transactions "id:${earlierTransaction.transactionId}" and "id:${laterTransaction.transactionId}", retained transaction is "id:${earlierTransaction.transactionId}"`);
            } else if (balanceModificationTransactions.length === 1) {
                let anotherAccountId = 0n;

                if (balanceModificationTransactions[0]!.accountId === fromAccountId) {
                    anotherAccountId = toAccountId;
                } else if (balanceModificationTransactions[0]!.accountId === toAccountId) {
                    anotherAccountId = fromAccountId;
                } else {
                    log.errorf(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has a balance modification transaction "id:${balanceModificationTransactions[0]!.transactionId}" which account id is neither "${fromAccountId}" nor "${toAccountId}"`);
                    throw errs.ErrOperationFailed;
                }

                const earliestTransaction = await sess.where('uid=? AND deleted=? AND account_id=?', uid, false, anotherAccountId).orderBy('transaction_time asc').limit(1).get(TransactionTable);

                if (earliestTransaction && balanceModificationTransactions[0]!.transactionTime > earliestTransaction.transactionTime) {
                    const balanceModificationTransaction = balanceModificationTransactions[0]!;
                    const earliestTransactionUnixTime = getUnixTimeFromTransactionTime(earliestTransaction.transactionTime);
                    const newBalanceModificationMinTransactionTime = getMinTransactionTimeFromUnixTime(earliestTransactionUnixTime - 1);
                    const newBalanceModificationMaxTransactionTime = getMaxTransactionTimeFromUnixTime(earliestTransactionUnixTime - 1);

                    balanceModificationTransaction.transactionTime = newBalanceModificationMinTransactionTime;
                    let sameSecondLatestTransaction: Transaction | null;

                    try {
                        sameSecondLatestTransaction = await sess.where('uid=? AND transaction_time>=? AND transaction_time<=?', balanceModificationTransaction.uid, newBalanceModificationMinTransactionTime, newBalanceModificationMaxTransactionTime).orderBy('transaction_time desc').limit(1).get(TransactionTable);
                    } catch (err) {
                        log.errorf(c, `[transactions.MoveAllTransactionsBetweenAccounts] failed to get trasaction time, because ${(err as Error).message}`);
                        throw err;
                    }

                    if (sameSecondLatestTransaction && sameSecondLatestTransaction.transactionTime < newBalanceModificationMaxTransactionTime - 1) {
                        balanceModificationTransaction.transactionTime = sameSecondLatestTransaction.transactionTime + 1;
                    } else if (sameSecondLatestTransaction && sameSecondLatestTransaction.transactionTime === newBalanceModificationMaxTransactionTime - 1) {
                        throw errs.ErrTooMuchTransactionInOneSecond;
                    }

                    balanceModificationTransaction.updatedUnixTime = nowUnix();

                    if (balanceModificationTransaction.transactionTime < 0) {
                        balanceModificationTransaction.transactionTime = 0;
                    }

                    const updatedRows = await sess.id(balanceModificationTransaction.transactionId).cols('transaction_time', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTable, balanceModificationTransaction);

                    if (updatedRows < 1) {
                        log.errorf(c, '[transactions.MoveAllTransactionsBetweenAccounts] failed to update balance modification transaction time');
                        throw errs.ErrDatabaseOperationFailed;
                    }

                    log.infof(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has updated balance modification transaction "id:${balanceModificationTransaction.transactionId}" time to ${balanceModificationTransaction.transactionTime}, because earliest transaction time in account "id:${toAccountId}" is ${earliestTransaction.transactionTime}`);
                }
            }

            const updatedRows = await sess.cols('account_id', 'updated_unix_time').where('uid=? AND deleted=? AND account_id=?', uid, false, fromAccountId).update(TransactionTable, { accountId: toAccountId, updatedUnixTime: nowUnix() });

            if (updatedRows > 0) {
                log.infof(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has moved ${updatedRows} transactions from account "id:${fromAccountId}" to account "id:${toAccountId}"`);
            }

            const relatedUpdatedRows = await sess.cols('related_account_id', 'updated_unix_time').where('uid=? AND deleted=? AND related_account_id=?', uid, false, fromAccountId).update(TransactionTable, { relatedAccountId: toAccountId, updatedUnixTime: nowUnix() });

            if (updatedRows > 0) {
                log.infof(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has moved ${relatedUpdatedRows} related transactions from account "id:${fromAccountId}" to account "id:${toAccountId}"`);
            }

            const deletedRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=? AND (type=? OR type=?) AND account_id=? AND related_account_id=?', uid, false, TRANSACTION_DB_TYPE_TRANSFER_OUT, TRANSACTION_DB_TYPE_TRANSFER_IN, toAccountId, toAccountId).update(TransactionTable, { deleted: true, deletedUnixTime: nowUnix() });

            if (deletedRows > 0) {
                log.infof(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has deleted ${deletedRows} transactions which account id and related account id are both "${toAccountId}"`);
            }

            if (fromAccount.balance !== 0) {
                const [newToAccountBalance, ok] = addInt64(toAccount.balance, fromAccount.balance);

                if (!ok) {
                    throw errs.ErrAccountBalanceOverflow;
                }

                toAccount.updatedUnixTime = nowUnix();
                const toAccountUpdatedRows = await this.updateAccountBalance(sess, toAccount, fromAccount.balance);

                if (toAccountUpdatedRows < 1) {
                    log.errorf(c, '[transactions.MoveAllTransactionsBetweenAccounts] failed to update to account balance');
                    throw errs.ErrDatabaseOperationFailed;
                }

                log.infof(c, `[transactions.MoveAllTransactionsBetweenAccounts] user "uid:${uid}" has updated account "id:${toAccountId}" balance from ${toAccount.balance} to ${newToAccountBalance}`);

                fromAccount.balance = 0;
                fromAccount.updatedUnixTime = nowUnix();

                const fromAccountUpdatedRows = await sess.id(fromAccount.accountId).cols('balance', 'updated_unix_time').where('uid=? AND deleted=?', fromAccount.uid, false).update(AccountTable, fromAccount);

                if (fromAccountUpdatedRows < 1) {
                    log.errorf(c, '[transactions.MoveAllTransactionsBetweenAccounts] failed to update from account balance');
                    throw errs.ErrDatabaseOperationFailed;
                }
            }
        });
    }

    // deleteTransaction deletes an existed transaction from database
    public async deleteTransaction(c: Context, uid: bigint, transactionId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();
        const logPrefix = 'transactions.DeleteTransaction';

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const oldTransaction = await sess.id(transactionId).where('uid=? AND deleted=?', uid, false).get(TransactionTable);

            if (!oldTransaction) {
                throw errs.ErrTransactionNotFound;
            }

            const [sourceAccount, destinationAccount] = await this.getAccountModels(sess, oldTransaction);

            if (sourceAccount.hidden || (destinationAccount && destinationAccount.hidden)) {
                throw errs.ErrCannotDeleteTransactionInHiddenAccount;
            }

            if (sourceAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS || (destinationAccount && destinationAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS)) {
                throw errs.ErrCannotDeleteTransactionInParentAccount;
            }

            let deletedRows = await sess.id(oldTransaction.transactionId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTable, { deleted: true, deletedUnixTime: now });

            if (deletedRows < 1) {
                throw errs.ErrTransactionNotFound;
            }

            if (oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                deletedRows = await sess.id(oldTransaction.relatedId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTable, { deleted: true, deletedUnixTime: now });

                if (deletedRows < 1) {
                    throw errs.ErrTransactionNotFound;
                }
            }

            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=? AND transaction_id=?', uid, false, oldTransaction.transactionId).update(TransactionTagIndexTable, { deleted: true, deletedUnixTime: now });
            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=? AND transaction_id=?', uid, false, oldTransaction.transactionId).update(TransactionPictureInfoTable, { deleted: true, deletedUnixTime: now });

            if (oldTransaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                if (oldTransaction.relatedAccountAmount !== 0) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceNoLogOrThrow(c, sess, sourceAccount, -oldTransaction.relatedAccountAmount, logPrefix);
                }
            } else if (oldTransaction.type === TRANSACTION_DB_TYPE_INCOME) {
                if (oldTransaction.amount !== 0) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceNoLogOrThrow(c, sess, sourceAccount, -oldTransaction.amount, logPrefix);
                }
            } else if (oldTransaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                if (oldTransaction.amount !== 0) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceNoLogOrThrow(c, sess, sourceAccount, oldTransaction.amount, logPrefix);
                }
            } else if (oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                if (oldTransaction.amount !== 0) {
                    sourceAccount.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceNoLogOrThrow(c, sess, sourceAccount, oldTransaction.amount, logPrefix);
                }

                if (oldTransaction.relatedAccountAmount !== 0) {
                    destinationAccount!.updatedUnixTime = nowUnix();
                    await this.updateAccountBalanceNoLogOrThrow(c, sess, destinationAccount!, -oldTransaction.relatedAccountAmount, logPrefix, true);
                }
            } else if (oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                throw errs.ErrTransactionTypeInvalid;
            }
        });
    }

    private async updateAccountBalanceNoLogOrThrow(c: Context, sess: Session, account: Account, delta: number, logPrefix: string, related: boolean = false): Promise<void> {
        const updatedRows = await this.updateAccountBalance(sess, account, delta);

        if (updatedRows < 1) {
            log.errorf(c, `[${logPrefix}] failed to update ${related ? 'related ' : ''}account balance`);
            throw errs.ErrDatabaseOperationFailed;
        }
    }

    // deleteAllTransactions deletes all existed transactions from database
    public async deleteAllTransactions(c: Context, uid: bigint, deleteAccount: boolean): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();

        await this.userDataDB(uid).doTransaction(c, async sess => {
            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTable, { deleted: true, deletedUnixTime: now });
            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagIndexTable, { deleted: true, deletedUnixTime: now });
            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionPictureInfoTable, { deleted: true, deletedUnixTime: now });
            await sess.cols('balance', 'deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(AccountTable, { balance: 0, deleted: deleteAccount, deletedUnixTime: now });
        });
    }

    // deleteAllTransactionsOfAccount deletes all existed transactions of specific account from database
    public async deleteAllTransactionsOfAccount(c: Context, uid: bigint, accountId: bigint, pageCount: number): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (accountId <= 0n) {
            throw errs.ErrAccountIdInvalid;
        }

        const transactions = await this.getAllSpecifiedTransactions(c, uid, 0, 0, withFilter({ accountIds: [accountId] }), pageCount, true);

        for (const transaction of transactions) {
            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                await this.deleteTransaction(c, uid, transaction.relatedId);
            } else {
                await this.deleteTransaction(c, uid, transaction.transactionId);
            }
        }
    }

    // getRelatedTransferTransaction returns the related transaction of transfer transaction
    public getRelatedTransferTransaction(originalTransaction: Transaction): Transaction | null {
        let relatedType: TransactionDbType;
        let relatedTransactionTime: number;

        if (originalTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            relatedType = TRANSACTION_DB_TYPE_TRANSFER_IN;
            relatedTransactionTime = originalTransaction.transactionTime + 1;
        } else if (originalTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            relatedType = TRANSACTION_DB_TYPE_TRANSFER_OUT;
            relatedTransactionTime = originalTransaction.transactionTime - 1;
        } else {
            return null;
        }

        return newTransaction({
            transactionId: originalTransaction.relatedId,
            uid: originalTransaction.uid,
            deleted: originalTransaction.deleted,
            type: relatedType,
            categoryId: originalTransaction.categoryId,
            transactionTime: relatedTransactionTime,
            timezoneUtcOffset: originalTransaction.timezoneUtcOffset,
            accountId: originalTransaction.relatedAccountId,
            amount: originalTransaction.relatedAccountAmount,
            relatedId: originalTransaction.transactionId,
            relatedAccountId: originalTransaction.accountId,
            relatedAccountAmount: originalTransaction.amount,
            comment: originalTransaction.comment,
            geoLongitude: originalTransaction.geoLongitude,
            geoLatitude: originalTransaction.geoLatitude,
            createdIp: originalTransaction.createdIp,
            createdUnixTime: originalTransaction.createdUnixTime,
            updatedUnixTime: originalTransaction.updatedUnixTime,
            deletedUnixTime: originalTransaction.deletedUnixTime,
        });
    }

    // getAccountsTotalIncomeAndExpense returns the every accounts total income and expense amount by specific date range
    public async getAccountsTotalIncomeAndExpense(c: Context, uid: bigint, startUnixTime: number, endUnixTime: number, excludeAccountIds: bigint[] | null, excludeCategoryIds: bigint[] | null, clientTimezone: Timezone, useTransactionTimezone: boolean): Promise<[Map<bigint, bigint>, Map<bigint, bigint>]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const startLocalDateTime = formatUnixTimeToNumericLocalDateTime(startUnixTime, clientTimezone);
        const endLocalDateTime = formatUnixTimeToNumericLocalDateTime(endUnixTime, clientTimezone);
        const allTransactions = await this.getAllTransactionsInSpecifiedDateRange(c, uid, startUnixTime, endUnixTime, excludeAccountIds, excludeCategoryIds, clientTimezone);

        const incomeAmounts = new Map<bigint, bigint>();
        const expenseAmounts = new Map<bigint, bigint>();

        for (const transaction of allTransactions) {
            const timeZone = useTransactionTimezone ? transactionTimezone(transaction) : clientTimezone;
            const localDateTime = formatUnixTimeToNumericLocalDateTime(getUnixTimeFromTransactionTime(transaction.transactionTime), timeZone);

            if (localDateTime < startLocalDateTime || localDateTime > endLocalDateTime) {
                continue;
            }

            let amountsMap: Map<bigint, bigint>;

            if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
                amountsMap = incomeAmounts;
            } else if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                amountsMap = expenseAmounts;
            } else {
                continue;
            }

            amountsMap.set(transaction.accountId, (amountsMap.get(transaction.accountId) ?? 0n) + BigInt(transaction.amount));
        }

        return [incomeAmounts, expenseAmounts];
    }

    // getAccountsDailyIncomeAndExpense returns the every accounts daily income and expense amount by specific date range
    public async getAccountsDailyIncomeAndExpense(c: Context, uid: bigint, startUnixTime: number, endUnixTime: number, excludeAccountIds: bigint[] | null, excludeCategoryIds: bigint[] | null, clientTimezone: Timezone, useTransactionTimezone: boolean): Promise<[Map<number, Map<bigint, bigint>>, Map<number, Map<bigint, bigint>>]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const startLocalDateTime = formatUnixTimeToNumericLocalDateTime(startUnixTime, clientTimezone);
        const endLocalDateTime = formatUnixTimeToNumericLocalDateTime(endUnixTime, clientTimezone);
        const allTransactions = await this.getAllTransactionsInSpecifiedDateRange(c, uid, startUnixTime, endUnixTime, excludeAccountIds, excludeCategoryIds, clientTimezone);

        const incomeAmounts = new Map<number, Map<bigint, bigint>>();
        const expenseAmounts = new Map<number, Map<bigint, bigint>>();

        for (const transaction of allTransactions) {
            const timeZone = useTransactionTimezone ? transactionTimezone(transaction) : clientTimezone;
            const unixTime = getUnixTimeFromTransactionTime(transaction.transactionTime);
            const localDateTime = formatUnixTimeToNumericLocalDateTime(unixTime, timeZone);

            if (localDateTime < startLocalDateTime || localDateTime > endLocalDateTime) {
                continue;
            }

            let allAmounts: Map<number, Map<bigint, bigint>>;

            if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
                allAmounts = incomeAmounts;
            } else if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                allAmounts = expenseAmounts;
            } else {
                continue;
            }

            const yearMonthDay = formatUnixTimeToNumericYearMonthDay(unixTime, timeZone);
            let dailyAmounts = allAmounts.get(yearMonthDay);

            if (!dailyAmounts) {
                dailyAmounts = new Map();
                allAmounts.set(yearMonthDay, dailyAmounts);
            }

            dailyAmounts.set(transaction.accountId, (dailyAmounts.get(transaction.accountId) ?? 0n) + BigInt(transaction.amount));
        }

        return [incomeAmounts, expenseAmounts];
    }

    private async loadTransactionsForStatistics(c: Context, uid: bigint, minTransactionTime: number, maxTransactionTime: number, tagFilters: TransactionTagFilter[] | null, noTags: boolean, keyword: string, matchMode: number): Promise<Transaction[]> {
        const condition = 'uid=? AND deleted=? AND (type=? OR type=? OR type=? OR type=?)';
        const conditionParams: unknown[] = [uid, false, TRANSACTION_DB_TYPE_INCOME, TRANSACTION_DB_TYPE_EXPENSE, TRANSACTION_DB_TYPE_TRANSFER_OUT, TRANSACTION_DB_TYPE_TRANSFER_IN];
        const allTransactions: Transaction[] = [];

        while (maxTransactionTime >= 0) {
            let finalCondition = condition;
            const finalConditionParams: unknown[] = [...conditionParams];

            if (minTransactionTime > 0) {
                finalCondition = finalCondition + ' AND transaction_time>=?';
                finalConditionParams.push(minTransactionTime);
            }

            if (maxTransactionTime > 0) {
                finalCondition = finalCondition + ' AND transaction_time<=?';
                finalConditionParams.push(maxTransactionTime);
            }

            if (keyword !== '') {
                if (matchMode === MATCH_MODE_IGNORE_CASE) {
                    finalCondition = finalCondition + ' AND LOWER(comment) LIKE LOWER(?)';
                } else {
                    finalCondition = finalCondition + ' AND comment LIKE ?';
                }

                finalConditionParams.push('%%' + keyword + '%%');
            }

            let query = this.userDataDB(uid).newSession(c).select('type, category_id, account_id, related_account_id, transaction_time, timezone_utc_offset, amount').where(finalCondition, ...finalConditionParams);
            query = this.appendFilterTagIdsConditionToQuery(query, uid, maxTransactionTime, minTransactionTime, tagFilters, noTags);

            const transactions = await query.limit(pageCountForLoadTransactionAmounts, 0).orderBy('transaction_time desc').find(TransactionTable);
            allTransactions.push(...transactions);

            if (transactions.length < pageCountForLoadTransactionAmounts) {
                break;
            }

            maxTransactionTime = transactions[transactions.length - 1]!.transactionTime - 1;
        }

        return allTransactions;
    }

    // getAccountsAndCategoriesTotalInflowAndOutflow returns the every accounts and categories total inflows and outflows amount by specific date range
    public async getAccountsAndCategoriesTotalInflowAndOutflow(c: Context, uid: bigint, startUnixTime: number, endUnixTime: number, tagFilters: TransactionTagFilter[] | null, noTags: boolean, keyword: string, matchMode: number, clientTimezone: Timezone, useTransactionTimezone: boolean): Promise<TransactionTotalAmount[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        let startLocalDateTime = 0;
        let endLocalDateTime = 0;
        let startTransactionTime = 0;
        let endTransactionTime = 0;

        if (startUnixTime > 0) {
            startLocalDateTime = formatUnixTimeToNumericLocalDateTime(startUnixTime, clientTimezone);
            startUnixTime = getMinUnixTimeWithSameLocalDateTime(startUnixTime, getTimezoneOffsetMinutes(startUnixTime, clientTimezone));
            startTransactionTime = getMinTransactionTimeFromUnixTime(startUnixTime);
        }

        if (endUnixTime > 0) {
            endLocalDateTime = formatUnixTimeToNumericLocalDateTime(endUnixTime, clientTimezone);
            endUnixTime = getMaxUnixTimeWithSameLocalDateTime(endUnixTime, getTimezoneOffsetMinutes(endUnixTime, clientTimezone));
            endTransactionTime = getMaxTransactionTimeFromUnixTime(endUnixTime);
        }

        const allTransactions = await this.loadTransactionsForStatistics(c, uid, startTransactionTime, endTransactionTime, tagFilters, noTags, keyword, matchMode);
        const transactionTotalAmountsMap = new Map<string, TransactionTotalAmount>();

        for (const transaction of allTransactions) {
            const timeZone = useTransactionTimezone ? transactionTimezone(transaction) : clientTimezone;
            const localDateTime = formatUnixTimeToNumericLocalDateTime(getUnixTimeFromTransactionTime(transaction.transactionTime), timeZone);

            if ((startLocalDateTime > 0 && localDateTime < startLocalDateTime) || (endLocalDateTime > 0 && localDateTime > endLocalDateTime)) {
                continue;
            }

            let groupKey = `${transaction.categoryId}_${transaction.accountId}`;

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                groupKey = `${transaction.categoryId}_${transaction.accountId}_${transaction.relatedAccountId}_${transaction.type}`;
            }

            let totalAmounts = transactionTotalAmountsMap.get(groupKey);

            if (!totalAmounts) {
                totalAmounts = {
                    type: transaction.type,
                    categoryId: transaction.categoryId,
                    accountId: transaction.accountId,
                    relatedAccountId: transaction.relatedAccountId,
                    amount: 0n,
                };

                transactionTotalAmountsMap.set(groupKey, totalAmounts);
            }

            totalAmounts.amount += BigInt(transaction.amount);
        }

        return Array.from(transactionTotalAmountsMap.values());
    }

    // getAccountsAndCategoriesMonthlyInflowAndOutflow returns the every accounts monthly inflows and outflows amount by specific date range
    public async getAccountsAndCategoriesMonthlyInflowAndOutflow(c: Context, uid: bigint, startYear: number, startMonth: number, endYear: number, endMonth: number, tagFilters: TransactionTagFilter[] | null, noTags: boolean, keyword: string, matchMode: number, clientTimezone: Timezone, useTransactionTimezone: boolean): Promise<Map<number, TransactionTotalAmount[]>> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        let startTransactionTime = 0;
        let endTransactionTime = 0;

        try {
            if (startYear > 0 && startMonth > 0) {
                startTransactionTime = getTransactionTimeRangeByYearMonth(startYear, startMonth)[0];
            }

            if (endYear > 0 && endMonth > 0) {
                endTransactionTime = getTransactionTimeRangeByYearMonth(endYear, endMonth)[1];
            }
        } catch {
            throw errs.ErrSystemError;
        }

        const allTransactions = await this.loadTransactionsForStatistics(c, uid, startTransactionTime, endTransactionTime, tagFilters, noTags, keyword, matchMode);

        const startYearMonth = startYear * 100 + startMonth;
        const endYearMonth = endYear * 100 + endMonth;
        const transactionsMonthlyAmountsMap = new Map<string, TransactionTotalAmount>();
        const transactionsMonthlyAmounts = new Map<number, TransactionTotalAmount[]>();

        for (const transaction of allTransactions) {
            const timeZone = useTransactionTimezone ? transactionTimezone(transaction) : clientTimezone;
            const yearMonth = formatUnixTimeToNumericYearMonth(getUnixTimeFromTransactionTime(transaction.transactionTime), timeZone);

            if ((startYearMonth > 0 && yearMonth < startYearMonth) || (endYearMonth > 0 && yearMonth > endYearMonth)) {
                continue;
            }

            let groupKey = `${yearMonth}_${transaction.categoryId}_${transaction.accountId}`;

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                groupKey = `${yearMonth}_${transaction.categoryId}_${transaction.accountId}_${transaction.relatedAccountId}_${transaction.type}`;
            }

            let transactionAmounts = transactionsMonthlyAmountsMap.get(groupKey);

            if (!transactionAmounts) {
                transactionAmounts = {
                    type: transaction.type,
                    categoryId: transaction.categoryId,
                    accountId: transaction.accountId,
                    relatedAccountId: transaction.relatedAccountId,
                    amount: 0n,
                };

                transactionsMonthlyAmountsMap.set(groupKey, transactionAmounts);
            }

            transactionAmounts.amount += BigInt(transaction.amount);
        }

        for (const [groupKey, transaction] of transactionsMonthlyAmountsMap) {
            const yearMonth = stringToInt32(groupKey.split('_')[0]!);
            let monthlyAmounts = transactionsMonthlyAmounts.get(yearMonth);

            if (!monthlyAmounts) {
                monthlyAmounts = [];
                transactionsMonthlyAmounts.set(yearMonth, monthlyAmounts);
            }

            monthlyAmounts.push(transaction);
        }

        return transactionsMonthlyAmounts;
    }

    // getTransactionMapByList returns a transaction map by a list
    public getTransactionMapByList(transactions: Transaction[]): Map<bigint, Transaction> {
        const transactionMap = new Map<bigint, Transaction>();

        for (const transaction of transactions) {
            transactionMap.set(transaction.transactionId, transaction);
        }

        return transactionMap;
    }

    // getTransactionIds returns transaction ids list
    public getTransactionIds(transactions: Transaction[]): bigint[] {
        return transactions.map(transaction => transaction.transactionId);
    }

    private async doCreateTransaction(c: Context, database: Database, sess: Session, transaction: Transaction, transactionTagIndexes: TransactionTagIndex[], tagIds: bigint[], pictureIds: bigint[] | null, pictureUpdateModel: Partial<TransactionPictureInfo> | null): Promise<void> {
        const logPrefix = 'transactions.doCreateTransaction';

        // Get and verify source and destination account
        const [sourceAccount, destinationAccount] = await this.getAccountModels(sess, transaction);

        if (sourceAccount.hidden || (destinationAccount && destinationAccount.hidden)) {
            throw errs.ErrCannotAddTransactionToHiddenAccount;
        }

        if (sourceAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS || (destinationAccount && destinationAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS)) {
            throw errs.ErrCannotAddTransactionToParentAccount;
        }

        if ((transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) &&
            sourceAccount.currency === destinationAccount!.currency && transaction.amount !== transaction.relatedAccountAmount) {
            throw errs.ErrTransactionSourceAndDestinationAmountNotEqual;
        }

        if ((transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) &&
            (transaction.amount < 0 || transaction.relatedAccountAmount < 0)) {
            throw errs.ErrTransferTransactionAmountCannotBeLessThanZero;
        }

        // Get and verify category
        await this.isCategoryValid(sess, transaction);

        // Get and verify tags
        await this.isTagsValid(sess, transaction.uid, transactionTagIndexes, tagIds);

        // Get and verify pictures
        await this.isPicturesValid(sess, transaction, pictureIds ?? []);

        // Verify balance modification transaction and calculate real amount
        if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
            let otherTransactionExists: boolean;

            try {
                otherTransactionExists = await sess.cols('uid', 'deleted', 'account_id').where('uid=? AND deleted=? AND account_id=?', transaction.uid, false, sourceAccount.accountId).limit(1).exist(TransactionTable);
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to get whether other transactions exist, because ${(err as Error).message}`);
                throw err;
            }

            if (otherTransactionExists) {
                throw errs.ErrBalanceModificationTransactionCannotAddWhenNotEmpty;
            }

            const [relatedAccountAmount, ok] = subtractInt64(transaction.amount, sourceAccount.balance);

            if (!ok) {
                throw errs.ErrAccountBalanceOverflow;
            }

            transaction.relatedAccountId = transaction.accountId;
            transaction.relatedAccountAmount = relatedAccountAmount;
        } else { // Not allow to add transaction before balance modification transaction
            let otherTransactionExists: boolean;

            try {
                if (destinationAccount && sourceAccount.accountId !== destinationAccount.accountId) {
                    otherTransactionExists = await sess.cols('uid', 'deleted', 'account_id').where('uid=? AND deleted=? AND type=? AND (account_id=? OR account_id=?) AND transaction_time>=?', transaction.uid, false, TRANSACTION_DB_TYPE_MODIFY_BALANCE, sourceAccount.accountId, destinationAccount.accountId, transaction.transactionTime).limit(1).exist(TransactionTable);
                } else {
                    otherTransactionExists = await sess.cols('uid', 'deleted', 'account_id').where('uid=? AND deleted=? AND type=? AND account_id=? AND transaction_time>=?', transaction.uid, false, TRANSACTION_DB_TYPE_MODIFY_BALANCE, sourceAccount.accountId, transaction.transactionTime).limit(1).exist(TransactionTable);
                }
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to get whether other transactions exist, because ${(err as Error).message}`);
                throw err;
            }

            if (otherTransactionExists) {
                throw errs.ErrCannotAddTransactionBeforeBalanceModificationTransaction;
            }
        }

        // Insert transaction row
        let relatedTransaction: Transaction | null = null;

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            relatedTransaction = this.getRelatedTransferTransaction(transaction);
        }

        const insertTransactionSavePointName = 'insert_transaction';

        try {
            await database.setSavePoint(sess, insertTransactionSavePointName);
        } catch (err) {
            log.errorf(c, `[transactions.doCreateTransaction] failed to set save point "${insertTransactionSavePointName}", because ${(err as Error).message}`);
            throw err;
        }

        let createdRows = 0;
        let insertError: unknown = null;

        try {
            createdRows = await sess.insert(TransactionTable, transaction);
        } catch (err) {
            insertError = err;
        }

        if (insertError !== null || createdRows < 1) { // maybe another transaction has same time
            if (insertError !== null) {
                log.warnf(c, `[transactions.doCreateTransaction] cannot create trasaction, because ${(insertError as Error).message}, regenerate transaction time value`);
            } else {
                log.warnf(c, '[transactions.doCreateTransaction] cannot create trasaction, regenerate transaction time value');
            }

            try {
                await database.rollbackToSavePoint(sess, insertTransactionSavePointName);
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to rollback to save point "${insertTransactionSavePointName}", because ${(err as Error).message}`);
                throw err;
            }

            const minTransactionTime = getMinTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
            const maxTransactionTime = getMaxTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
            let sameSecondLatestTransaction: Transaction | null;

            try {
                sameSecondLatestTransaction = await sess.where('uid=? AND transaction_time>=? AND transaction_time<=?', transaction.uid, minTransactionTime, maxTransactionTime).orderBy('transaction_time desc').limit(1).get(TransactionTable);
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to get trasaction time, because ${(err as Error).message}`);
                throw err;
            }

            if (!sameSecondLatestTransaction) {
                log.errorf(c, `[transactions.doCreateTransaction] it should have transactions in ${minTransactionTime} - ${maxTransactionTime}, but result is empty`);
                throw errs.ErrDatabaseOperationFailed;
            } else if (sameSecondLatestTransaction.transactionTime === maxTransactionTime - 1) {
                throw errs.ErrTooMuchTransactionInOneSecond;
            }

            transaction.transactionTime = sameSecondLatestTransaction.transactionTime + 1;

            try {
                createdRows = await sess.insert(TransactionTable, transaction);
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to add transaction again, because ${(err as Error).message}`);
                throw err;
            }

            if (createdRows < 1) {
                log.errorf(c, '[transactions.doCreateTransaction] failed to add transaction again');
                throw errs.ErrDatabaseOperationFailed;
            }
        }

        if (relatedTransaction) {
            relatedTransaction.transactionTime = transaction.transactionTime + 1;

            if (getUnixTimeFromTransactionTime(transaction.transactionTime) !== getUnixTimeFromTransactionTime(relatedTransaction.transactionTime)) {
                throw errs.ErrTooMuchTransactionInOneSecond;
            }

            let relatedCreatedRows: number;

            try {
                relatedCreatedRows = await sess.insert(TransactionTable, relatedTransaction);
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to add related transaction, because ${(err as Error).message}`);
                throw err;
            }

            if (relatedCreatedRows < 1) {
                log.errorf(c, '[transactions.doCreateTransaction] failed to add related transaction');
                throw errs.ErrDatabaseOperationFailed;
            }
        }

        // Insert transaction tag index
        for (const transactionTagIndex of transactionTagIndexes) {
            transactionTagIndex.transactionTime = transaction.transactionTime;

            try {
                await sess.insert(TransactionTagIndexTable, transactionTagIndex);
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to add transaction tag index, because ${(err as Error).message}`);
                throw err;
            }
        }

        // Update transaction picture
        if (pictureIds && pictureIds.length > 0) {
            try {
                await sess.cols('transaction_id', 'updated_unix_time').where('uid=? AND deleted=? AND transaction_id=?', transaction.uid, false, TransactionPictureNewPictureTransactionId).in('picture_id', pictureIds).update(TransactionPictureInfoTable, pictureUpdateModel ?? {});
            } catch (err) {
                log.errorf(c, `[transactions.doCreateTransaction] failed to update transaction picture info, because ${(err as Error).message}`);
                throw err;
            }
        }

        // Update account table
        if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
            if (transaction.relatedAccountAmount !== 0) {
                sourceAccount.updatedUnixTime = nowUnix();
                await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, transaction.relatedAccountAmount, logPrefix);
            }
        } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
            if (transaction.amount !== 0) {
                sourceAccount.updatedUnixTime = nowUnix();
                await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, transaction.amount, logPrefix);
            }
        } else if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
            if (transaction.amount !== 0) {
                sourceAccount.updatedUnixTime = nowUnix();
                await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, -transaction.amount, logPrefix);
            }
        } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            if (transaction.amount !== 0) {
                sourceAccount.updatedUnixTime = nowUnix();
                await this.updateAccountBalanceOrThrow(c, sess, sourceAccount, -transaction.amount, logPrefix);
            }

            if (transaction.relatedAccountAmount !== 0) {
                destinationAccount!.updatedUnixTime = nowUnix();
                await this.updateAccountBalanceOrThrow(c, sess, destinationAccount!, transaction.relatedAccountAmount, logPrefix);
            }
        } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            throw errs.ErrTransactionTypeInvalid;
        }
    }

    private async updateAccountBalance(sess: Session, account: Account, delta: number): Promise<number> {
        if (delta === 0) {
            return 1;
        }

        const bigDelta = BigInt(delta);
        let query = sess.id(account.accountId).cols('updated_unix_time').where('uid=? AND deleted=?', account.uid, false);

        if (bigDelta > 0n) {
            query = query.where('balance<=?', int64Max - bigDelta);
        } else if (bigDelta === int64Min) {
            query = query.where('balance>=?', 0);
        } else {
            query = query.where('balance>=?', int64Min - bigDelta);
        }

        const updatedRows = await query.setExpr('balance', `balance+(${bigDelta})`).update(AccountTable, account);

        if (updatedRows < 1) {
            throw errs.ErrAccountBalanceOverflow;
        }

        return updatedRows;
    }

    private async getAllTransactionsInSpecifiedDateRange(c: Context, uid: bigint, startUnixTime: number, endUnixTime: number, excludeAccountIds: bigint[] | null, excludeCategoryIds: bigint[] | null, clientTimezone: Timezone): Promise<Transaction[]> {
        startUnixTime = getMinUnixTimeWithSameLocalDateTime(startUnixTime, getTimezoneOffsetMinutes(startUnixTime, clientTimezone));
        endUnixTime = getMaxUnixTimeWithSameLocalDateTime(endUnixTime, getTimezoneOffsetMinutes(endUnixTime, clientTimezone));

        const startTransactionTime = getMinTransactionTimeFromUnixTime(startUnixTime);
        const endTransactionTime = getMaxTransactionTimeFromUnixTime(endUnixTime);

        let condition = 'uid=? AND deleted=? AND (type=? OR type=?)';
        const conditionParams: unknown[] = [uid, false, TRANSACTION_DB_TYPE_INCOME, TRANSACTION_DB_TYPE_EXPENSE];

        if (excludeAccountIds && excludeAccountIds.length > 0) {
            condition = condition + ' AND account_id NOT IN (' + excludeAccountIds.map(() => '?').join(',') + ')';
            conditionParams.push(...excludeAccountIds);
        }

        if (excludeCategoryIds && excludeCategoryIds.length > 0) {
            condition = condition + ' AND category_id NOT IN (' + excludeCategoryIds.map(() => '?').join(',') + ')';
            conditionParams.push(...excludeCategoryIds);
        }

        condition = condition + ' AND transaction_time>=? AND transaction_time<=?';

        const minTransactionTime = startTransactionTime;
        let maxTransactionTime = endTransactionTime;
        const allTransactions: Transaction[] = [];

        while (maxTransactionTime > 0) {
            const finalConditionParams = [...conditionParams, minTransactionTime, maxTransactionTime];
            const transactions = await this.userDataDB(uid).newSession(c).select('type, account_id, transaction_time, timezone_utc_offset, amount').where(condition, ...finalConditionParams).limit(pageCountForLoadTransactionAmounts, 0).orderBy('transaction_time desc').find(TransactionTable);

            allTransactions.push(...transactions);

            if (transactions.length < pageCountForLoadTransactionAmounts) {
                break;
            }

            maxTransactionTime = transactions[transactions.length - 1]!.transactionTime - 1;
        }

        return allTransactions;
    }

    private buildTransactionQueryCondition(uid: bigint, maxTransactionTime: number, minTransactionTime: number, transactionDbType: TransactionDbType, categoryIds: bigint[] | null, accountIds: bigint[] | null, _tagFilters: TransactionTagFilter[] | null, amountFilter: string, keyword: string, matchMode: number, noDuplicated: boolean): [string, unknown[]] {
        let condition = 'uid=? AND deleted=?';
        const conditionParams: unknown[] = [uid, false];
        const accountIdList = accountIds ?? [];
        const categoryIdList = categoryIds ?? [];

        if (maxTransactionTime > 0) {
            condition = condition + ' AND transaction_time<=?';
            conditionParams.push(maxTransactionTime);
        }

        if (minTransactionTime > 0) {
            condition = condition + ' AND transaction_time>=?';
            conditionParams.push(minTransactionTime);
        }

        const accountIdsCondition = accountIdList.map(() => '?').join(',');

        if (TRANSACTION_DB_TYPE_MODIFY_BALANCE <= transactionDbType && transactionDbType <= TRANSACTION_DB_TYPE_EXPENSE) {
            condition = condition + ' AND type=?';
            conditionParams.push(transactionDbType);
        } else if (transactionDbType === TRANSACTION_DB_TYPE_TRANSFER_OUT || transactionDbType === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            if (accountIdList.length === 0) {
                condition = condition + ' AND type=?';
                conditionParams.push(TRANSACTION_DB_TYPE_TRANSFER_OUT);
            } else if (accountIdList.length === 1) {
                condition = condition + ' AND (type=? OR type=?)';
                conditionParams.push(TRANSACTION_DB_TYPE_TRANSFER_OUT, TRANSACTION_DB_TYPE_TRANSFER_IN);
            } else { // accountIds.length > 1
                condition = condition + ' AND (type=? OR (type=? AND related_account_id NOT IN (' + accountIdsCondition + ')))';
                conditionParams.push(TRANSACTION_DB_TYPE_TRANSFER_OUT, TRANSACTION_DB_TYPE_TRANSFER_IN, ...accountIdList);
            }
        } else {
            if (noDuplicated) {
                if (accountIdList.length === 0) {
                    condition = condition + ' AND (type=? OR type=? OR type=? OR type=?)';
                    conditionParams.push(TRANSACTION_DB_TYPE_MODIFY_BALANCE, TRANSACTION_DB_TYPE_INCOME, TRANSACTION_DB_TYPE_EXPENSE, TRANSACTION_DB_TYPE_TRANSFER_OUT);
                } else if (accountIdList.length === 1) {
                    // Do nothing
                } else { // accountIds.length > 1
                    condition = condition + ' AND (type=? OR type=? OR type=? OR type=? OR (type=? AND related_account_id NOT IN (' + accountIdsCondition + ')))';
                    conditionParams.push(TRANSACTION_DB_TYPE_MODIFY_BALANCE, TRANSACTION_DB_TYPE_INCOME, TRANSACTION_DB_TYPE_EXPENSE, TRANSACTION_DB_TYPE_TRANSFER_OUT, TRANSACTION_DB_TYPE_TRANSFER_IN, ...accountIdList);
                }
            }
        }

        if (categoryIdList.length > 0) {
            const conditions = categoryIdList.map(() => '?').join(',');
            conditionParams.push(...categoryIdList);

            if (conditions.length > 1) {
                condition = condition + ' AND category_id IN (' + conditions + ')';
            } else {
                condition = condition + ' AND category_id = ' + conditions;
            }
        }

        if (accountIdList.length > 0) {
            if (accountIdsCondition.length > 1) {
                condition = condition + ' AND account_id IN (' + accountIdsCondition + ')';
            } else {
                condition = condition + ' AND account_id = ' + accountIdsCondition;
            }

            conditionParams.push(...accountIdList);
        }

        if (amountFilter !== '') {
            const amountFilterItems = amountFilter.split(':');
            const parse = (text: string): bigint | null => {
                try {
                    return stringToInt64(text);
                } catch {
                    return null;
                }
            };

            if (amountFilterItems.length === 2 && amountFilterItems[0] === 'gt') {
                const value = parse(amountFilterItems[1]!);

                if (value !== null) {
                    condition = condition + ' AND amount > ?';
                    conditionParams.push(value);
                }
            } else if (amountFilterItems.length === 2 && amountFilterItems[0] === 'lt') {
                const value = parse(amountFilterItems[1]!);

                if (value !== null) {
                    condition = condition + ' AND amount < ?';
                    conditionParams.push(value);
                }
            } else if (amountFilterItems.length === 2 && amountFilterItems[0] === 'eq') {
                const value = parse(amountFilterItems[1]!);

                if (value !== null) {
                    condition = condition + ' AND amount = ?';
                    conditionParams.push(value);
                }
            } else if (amountFilterItems.length === 2 && amountFilterItems[0] === 'ne') {
                const value = parse(amountFilterItems[1]!);

                if (value !== null) {
                    condition = condition + ' AND amount <> ?';
                    conditionParams.push(value);
                }
            } else if (amountFilterItems.length === 3 && amountFilterItems[0] === 'bt') {
                const value1 = parse(amountFilterItems[1]!);
                const value2 = parse(amountFilterItems[2]!);

                if (value2 !== null) {
                    condition = condition + ' AND amount >= ? AND amount <= ?';
                    conditionParams.push(value1 ?? 0n, value2);
                }
            } else if (amountFilterItems.length === 3 && amountFilterItems[0] === 'nb') {
                const value1 = parse(amountFilterItems[1]!);
                const value2 = parse(amountFilterItems[2]!);

                if (value2 !== null) {
                    condition = condition + ' AND (amount < ? OR amount > ?)';
                    conditionParams.push(value1 ?? 0n, value2);
                }
            }
        }

        if (keyword !== '') {
            if (matchMode === MATCH_MODE_IGNORE_CASE) {
                condition = condition + ' AND LOWER(comment) LIKE LOWER(?)';
            } else {
                condition = condition + ' AND comment LIKE ?';
            }

            conditionParams.push('%%' + keyword + '%%');
        }

        return [condition, conditionParams];
    }

    private buildTagIndexSubQueryCondition(uid: bigint, maxTransactionTime: number, minTransactionTime: number): SqlCond {
        let subQueryCondition = SqlCond.and(SqlCond.eq('uid', uid), SqlCond.eq('deleted', false));

        if (maxTransactionTime > 0) {
            subQueryCondition = subQueryCondition.and(new SqlCond('transaction_time<=?', [maxTransactionTime]));
        }

        if (minTransactionTime > 0) {
            subQueryCondition = subQueryCondition.and(new SqlCond('transaction_time>=?', [minTransactionTime]));
        }

        return subQueryCondition;
    }

    private appendFilterTagIdsConditionToQuery(query: Query, uid: bigint, maxTransactionTime: number, minTransactionTime: number, tagFilters: TransactionTagFilter[] | null, noTags: boolean): Query {
        if (noTags) {
            const subQueryCondition = this.buildTagIndexSubQueryCondition(uid, maxTransactionTime, minTransactionTime);
            const subQuery = `SELECT transaction_id FROM transaction_tag_index WHERE ${subQueryCondition.sql}`;

            query.where(new SqlCond(`transaction_id NOT IN (${subQuery})`, subQueryCondition.params));
            query.where(new SqlCond(`related_id NOT IN (${subQuery})`, subQueryCondition.params));
            return query;
        }

        if (!tagFilters || tagFilters.length < 1) {
            return query;
        }

        for (const tagFilter of tagFilters) {
            const subQueryCondition = this.buildTagIndexSubQueryCondition(uid, maxTransactionTime, minTransactionTime).and(SqlCond.in('tag_id', tagFilter.tagIds));
            let subQuery = `SELECT transaction_id FROM transaction_tag_index WHERE ${subQueryCondition.sql}`;

            if (tagFilter.type === TRANSACTION_TAG_FILTER_HAS_ALL || tagFilter.type === TRANSACTION_TAG_FILTER_NOT_HAS_ALL) {
                subQuery = `${subQuery} GROUP BY transaction_id HAVING COUNT(DISTINCT tag_id) >= ${tagFilter.tagIds.length}`;
            }

            if (tagFilter.type === TRANSACTION_TAG_FILTER_HAS_ANY || tagFilter.type === TRANSACTION_TAG_FILTER_HAS_ALL) {
                query.and(new SqlCond(`transaction_id IN (${subQuery}) OR related_id IN (${subQuery})`, [...subQueryCondition.params, ...subQueryCondition.params]));
            } else if (tagFilter.type === TRANSACTION_TAG_FILTER_NOT_HAS_ANY || tagFilter.type === TRANSACTION_TAG_FILTER_NOT_HAS_ALL) {
                query.where(new SqlCond(`transaction_id NOT IN (${subQuery})`, subQueryCondition.params));
                query.where(new SqlCond(`related_id NOT IN (${subQuery})`, subQueryCondition.params));
            }
        }

        return query;
    }

    private appendFilterPicturesConditionToQuery(query: Query, uid: bigint, mustHavePictures: boolean): Query {
        if (!mustHavePictures) {
            return query;
        }

        const subQueryCondition = SqlCond.and(SqlCond.eq('uid', uid), SqlCond.eq('deleted', false), new SqlCond('transaction_id<>?', [TransactionPictureNewPictureTransactionId]));
        const subQuery = `SELECT transaction_id FROM transaction_picture_info WHERE ${subQueryCondition.sql}`;

        query.and(new SqlCond(`transaction_id IN (${subQuery}) OR related_id IN (${subQuery})`, [...subQueryCondition.params, ...subQueryCondition.params]));
        return query;
    }

    private isAccountIdValid(transaction: Transaction): void {
        if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
            if (transaction.relatedAccountId !== 0n && transaction.relatedAccountId !== transaction.accountId) {
                throw errs.ErrTransactionDestinationAccountCannotBeSet;
            }
        } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME || transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
            if (transaction.relatedAccountId !== 0n) {
                throw errs.ErrTransactionDestinationAccountCannotBeSet;
            } else if (transaction.relatedAccountAmount !== 0) {
                throw errs.ErrTransactionDestinationAmountCannotBeSet;
            }
        } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            if (transaction.accountId === transaction.relatedAccountId) {
                throw errs.ErrTransactionSourceAndDestinationIdCannotBeEqual;
            }
        } else {
            throw errs.ErrTransactionTypeInvalid;
        }
    }

    private async getAccountModels(sess: Session, transaction: Transaction): Promise<[Account, Account | null]> {
        const sourceAccount = await sess.id(transaction.accountId).where('uid=? AND deleted=?', transaction.uid, false).get(AccountTable);

        if (!sourceAccount) {
            throw errs.ErrSourceAccountNotFound;
        }

        let destinationAccount: Account | null = null;

        if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
            if (transaction.relatedAccountId !== 0n && transaction.relatedAccountId !== transaction.accountId) {
                throw errs.ErrAccountIdInvalid;
            }

            destinationAccount = sourceAccount;
        } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME || transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
            if (transaction.relatedAccountId !== 0n) {
                throw errs.ErrAccountIdInvalid;
            }

            destinationAccount = null;
        } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            if (transaction.relatedAccountId <= 0n) {
                throw errs.ErrAccountIdInvalid;
            }

            destinationAccount = await sess.id(transaction.relatedAccountId).where('uid=? AND deleted=?', transaction.uid, false).get(AccountTable);

            if (!destinationAccount) {
                throw errs.ErrDestinationAccountNotFound;
            }
        } else {
            // go: destination account is an empty account model
            destinationAccount = { ...sourceAccount, accountId: 0n, parentAccountId: 0n, hidden: false, type: 0, currency: '' };
        }

        // check whether the parent accounts are valid
        if (sourceAccount.parentAccountId > 0n && destinationAccount && sourceAccount.parentAccountId !== destinationAccount.parentAccountId && destinationAccount.parentAccountId > 0n) {
            const accounts = await sess.where('uid=? AND deleted=? and (account_id=? or account_id=?)', transaction.uid, false, sourceAccount.parentAccountId, destinationAccount.parentAccountId).find(AccountTable);

            if (accounts.length < 2) {
                throw errs.ErrAccountNotFound;
            }

            for (const account of accounts) {
                if (account.hidden) {
                    throw errs.ErrCannotUseHiddenAccount;
                }
            }
        } else if (sourceAccount.parentAccountId > 0n && (!destinationAccount || sourceAccount.parentAccountId === destinationAccount.parentAccountId || destinationAccount.parentAccountId === 0n)) {
            const sourceParentAccount = await sess.id(sourceAccount.parentAccountId).where('uid=? AND deleted=?', transaction.uid, false).get(AccountTable);

            if (!sourceParentAccount) {
                throw errs.ErrSourceAccountNotFound;
            }

            if (sourceParentAccount.hidden) {
                throw errs.ErrCannotUseHiddenAccount;
            }
        } else if (sourceAccount.parentAccountId === 0n && destinationAccount && destinationAccount.parentAccountId > 0n) {
            const destinationParentAccount = await sess.id(destinationAccount.parentAccountId).where('uid=? AND deleted=?', transaction.uid, false).get(AccountTable);

            if (!destinationParentAccount) {
                throw errs.ErrDestinationAccountNotFound;
            }

            if (destinationParentAccount.hidden) {
                throw errs.ErrCannotUseHiddenAccount;
            }
        }

        return [sourceAccount, destinationAccount];
    }

    private async getOldAccountModels(sess: Session, transaction: Transaction, oldTransaction: Transaction, sourceAccount: Account, destinationAccount: Account | null): Promise<[Account, Account | null]> {
        let oldSourceAccount: Account;
        let oldDestinationAccount: Account | null = null;

        if (transaction.accountId === oldTransaction.accountId) {
            oldSourceAccount = sourceAccount;
        } else {
            const account = await sess.id(oldTransaction.accountId).where('uid=? AND deleted=?', transaction.uid, false).get(AccountTable);

            if (!account) {
                throw errs.ErrSourceAccountNotFound;
            }

            oldSourceAccount = account;
        }

        if (transaction.relatedAccountId === oldTransaction.relatedAccountId) {
            oldDestinationAccount = destinationAccount;
        } else if (oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || oldTransaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            const account = await sess.id(oldTransaction.relatedAccountId).where('uid=? AND deleted=?', transaction.uid, false).get(AccountTable);

            if (!account) {
                throw errs.ErrDestinationAccountNotFound;
            }

            oldDestinationAccount = account;
        }

        return [oldSourceAccount, oldDestinationAccount];
    }

    private getRelatedUpdateColumns(updateCols: string[]): string[] {
        return updateCols.map(col => {
            if (col === 'account_id') {
                return 'related_account_id';
            } else if (col === 'related_account_id') {
                return 'account_id';
            } else if (col === 'amount') {
                return 'related_account_amount';
            } else if (col === 'related_account_amount') {
                return 'amount';
            }

            return col;
        });
    }

    private async isCategoryValid(sess: Session, transaction: Transaction): Promise<void> {
        if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
            if (transaction.categoryId !== 0n) {
                throw errs.ErrBalanceModificationTransactionCannotSetCategory;
            }

            return;
        }

        const category = await sess.id(transaction.categoryId).where('uid=? AND deleted=?', transaction.uid, false).get(TransactionCategoryTable);

        if (!category) {
            throw errs.ErrTransactionCategoryNotFound;
        }

        if (category.hidden) {
            throw errs.ErrCannotUseHiddenTransactionCategory;
        }

        if (category.parentCategoryId === LevelOneTransactionCategoryParentId) {
            throw errs.ErrCannotUsePrimaryCategoryForTransaction;
        }

        if ((transaction.type === TRANSACTION_DB_TYPE_INCOME && category.type !== CATEGORY_TYPE_INCOME) ||
            (transaction.type === TRANSACTION_DB_TYPE_EXPENSE && category.type !== CATEGORY_TYPE_EXPENSE) ||
            ((transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) && category.type !== CATEGORY_TYPE_TRANSFER)) {
            throw errs.ErrTransactionCategoryTypeInvalid;
        }

        const parentCategory = await sess.id(category.parentCategoryId).where('uid=? AND deleted=?', transaction.uid, false).get(TransactionCategoryTable);

        if (!parentCategory) {
            throw errs.ErrTransactionCategoryNotFound;
        }

        if (parentCategory.hidden) {
            throw errs.ErrCannotUseHiddenTransactionCategory;
        }
    }

    private async isTagsValid(sess: Session, uid: bigint, transactionTagIndexes: TransactionTagIndex[], tagIds: bigint[]): Promise<void> {
        if (transactionTagIndexes.length < 1) {
            return;
        }

        const tags = await sess.where('uid=? AND deleted=?', uid, false).in('tag_id', tagIds).find(TransactionTagTable);
        const tagMap = new Set<bigint>();

        for (const tag of tags) {
            if (tag.hidden) {
                throw errs.ErrCannotUseHiddenTransactionTag;
            }

            tagMap.add(tag.tagId);
        }

        for (const transactionTagIndex of transactionTagIndexes) {
            if (!tagMap.has(transactionTagIndex.tagId)) {
                throw errs.ErrTransactionTagNotFound;
            }
        }
    }

    private async isPicturesValid(sess: Session, transaction: Transaction, pictureIds: bigint[]): Promise<void> {
        if (pictureIds.length < 1) {
            return;
        }

        const pictureInfos = await sess.where('uid=? AND deleted=?', transaction.uid, false).in('picture_id', pictureIds).find(TransactionPictureInfoTable);
        const pictureInfoMap = new Set<bigint>();

        for (const pictureInfo of pictureInfos) {
            if (pictureInfo.transactionId !== TransactionPictureNewPictureTransactionId && pictureInfo.transactionId !== transaction.transactionId) {
                throw errs.ErrTransactionPictureIdInvalid;
            }

            pictureInfoMap.add(pictureInfo.pictureId);
        }

        for (const pictureId of pictureIds) {
            if (!pictureInfoMap.has(pictureId)) {
                throw errs.ErrTransactionPictureNotFound;
            }
        }
    }
}

export const Transactions = new TransactionService();
