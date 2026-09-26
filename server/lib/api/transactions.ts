import { MATCH_MODE_DEFAULT } from '../core/types';
import { DUPLICATE_CHECKER_TYPE_NEW_TRANSACTION } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    type Account,
    buildTransactionInfoResponse,
    ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS,
    ACCOUNT_TYPE_SINGLE_ACCOUNT,
    canEditTransactionByTransactionTime,
    CATEGORY_TYPE_EXPENSE,
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    getNumericYearMonthRange,
    getTransactionAmountsRequestItems,
    isTransactionEditable,
    LevelOneTransactionCategoryParentId,
    newTransaction,
    sortTransactionAmountsResponseItemAmountInfos,
    sortTransactionInfoResponses,
    sortTransactionStatisticAssetTrendsResponseItems,
    sortTransactionStatisticTrendsResponseItems,
    toAccountInfoResponse,
    toTransactionCategoryInfoResponse,
    toTransactionInfoResponse,
    toTransactionTagInfoResponse,
    type Transaction,
    type TransactionAllListRequest,
    type TransactionAmountsAndCurrency,
    type TransactionAmountsRequest,
    type TransactionAmountsResponseItem,
    type TransactionAmountsResponseItemAmountInfo,
    type TransactionBatchAddTagsRequest,
    type TransactionBatchClearTagsRequest,
    type TransactionBatchDeleteRequest,
    type TransactionBatchUpdateAccountRequest,
    type TransactionBatchUpdateCategoryRequest,
    type TransactionCategory,
    type TransactionCountRequest,
    type TransactionCreateRequest,
    type TransactionDailyAmountsRequest,
    type TransactionDbType,
    type TransactionGetRequest,
    type TransactionInfoResponse,
    type TransactionListByMaxTimeRequest,
    type TransactionListInMonthByPageRequest,
    type TransactionModifyRequest,
    type TransactionMoveBetweenAccountsRequest,
    type TransactionPictureInfo,
    type TransactionQueryFilterRequest,
    type TransactionReconciliationStatementRequest,
    type TransactionStatisticAssetTrendsRequest,
    type TransactionStatisticAssetTrendsResponseItem,
    type TransactionStatisticRequest,
    type TransactionStatisticResponseItem,
    type TransactionStatisticTrendsRequest,
    type TransactionStatisticTrendsResponseItem,
    type TransactionTag,
    type TransactionTagFilter,
    type TransactionTagInfoResponse,
    type TransactionTotalAmount,
    type TransactionWithAccountBalance,
    transactionDbTypeToRelatedAccountType,
    transactionTypeToTransactionDbType,
    parseTransactionTagFilter,
    TransactionNoTagFilterValue,
    TRANSACTION_DB_TYPE_EXPENSE,
    TRANSACTION_DB_TYPE_INCOME,
    TRANSACTION_DB_TYPE_MODIFY_BALANCE,
    TRANSACTION_DB_TYPE_TRANSFER_IN,
    TRANSACTION_DB_TYPE_TRANSFER_OUT,
    TRANSACTION_TYPE_MODIFY_BALANCE,
    TRANSACTION_TYPE_TRANSFER,
    MaximumPicturesCountOfTransaction,
    MaximumTagsCountOfTransaction,
    type User,
} from '../models/index';
import { Accounts } from '../services/accounts';
import { TransactionCategories } from '../services/transaction_categories';
import { TransactionPictures } from '../services/transaction_pictures';
import { TransactionTags } from '../services/transaction_tags';
import { type TransactionQueryFilter, Transactions } from '../services/transactions';
import { Users } from '../services/users';
import { stringArrayToInt64Array, stringToInt64 } from '../utils/converter';
import { formatNumericYearMonthDayToLongDate, getMaxTransactionTimeFromUnixTime, getMinTransactionTimeFromUnixTime, getUnixTimeFromTransactionTime, type Timezone } from '../utils/datetimes';
import { int64SliceEquals, int64SliceMinus, toUniqueInt64Slice } from '../utils/slices';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery, currentConfig, errMsg, getClientTimezoneOrThrow, getSubmissionRemark, getTransactionPictureInfoResponseList, setSubmissionRemarkIfEnable } from './base';
import { callOrFail } from './common';
import {
    IdDeleteRequestSchema,
    TransactionAllListRequestSchema,
    TransactionAmountsRequestSchema,
    TransactionBatchClearTagsRequestSchema,
    TransactionBatchDeleteRequestSchema,
    TransactionBatchTagsRequestSchema,
    TransactionBatchUpdateAccountRequestSchema,
    TransactionBatchUpdateCategoryRequestSchema,
    TransactionCountRequestSchema,
    TransactionCreateRequestSchema,
    TransactionDailyAmountsRequestSchema,
    TransactionGetRequestSchema,
    TransactionListByMaxTimeRequestSchema,
    TransactionListInMonthByPageRequestSchema,
    TransactionModifyRequestSchema,
    TransactionMoveBetweenAccountsRequestSchema,
    TransactionReconciliationStatementRequestSchema,
    TransactionStatisticAssetTrendsRequestSchema,
    TransactionStatisticRequestSchema,
    TransactionStatisticTrendsRequestSchema,
} from './schemas';

const P = 'transactions';
const pageCountForAccountStatement = 1000;
const pageCountForMovingAccountTransactions = 1000;
export const pageCountForDataExport = 1000;

const MAX_INT64_TRANSACTION_TIME = Number.MAX_SAFE_INTEGER;

type AccountMap = Map<bigint, Account>;

export interface TransactionEssentialData {
    accountMap: AccountMap;
    categoryMap: Map<bigint, TransactionCategory> | null;
    tagMap: Map<bigint, TransactionTag> | null;
    allTransactionTagIds: Map<bigint, bigint[]>;
    pictureInfoMap: Map<bigint, TransactionPictureInfo[]> | null;
}

export async function getUserOrNotFound(c: WebContext, handler: string): Promise<User> {
    try {
        return await Users.getUserById(c, c.getCurrentUid());
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${P}.${handler}] failed to get user, because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }
}

function parseInt64Array(strs: string[] | null | undefined, c: WebContext, handler: string, name: string, err: errs.AppError): bigint[] {
    try {
        return stringArrayToInt64Array(strs ?? []);
    } catch (e) {
        log.warnf(c, `[${P}.${handler}] parse ${name} ids failed, because ${errMsg(e)}`);
        throw err;
    }
}

// buildQueryFilter parses the common filter parameters of transaction query request
async function buildQueryFilter(c: WebContext, uid: bigint, req: TransactionQueryFilterRequest & { mustHavePictures: boolean }, handler: string): Promise<TransactionQueryFilter> {
    let allAccountIds: bigint[] | null;
    let allCategoryIds: bigint[] | null;

    try {
        allAccountIds = await Accounts.getAccountOrSubAccountIds(c, req.accountIds, uid);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] get account error, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    try {
        allCategoryIds = await TransactionCategories.getCategoryOrSubCategoryIds(c, req.categoryIds, uid);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] get transaction category error, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const [tagFilters, noTags] = parseTagFilters(c, req.tagFilter, handler);

    return {
        transactionType: req.type,
        categoryIds: allCategoryIds,
        accountIds: allAccountIds,
        tagFilters: tagFilters,
        noTags: noTags,
        amountFilter: req.amountFilter,
        keyword: req.keyword,
        matchMode: req.matchMode,
        mustHavePictures: req.mustHavePictures,
    };
}

function parseTagFilters(c: WebContext, tagFilter: string, handler: string): [TransactionTagFilter[] | null, boolean] {
    const noTags = tagFilter === TransactionNoTagFilterValue;

    if (noTags) {
        return [null, true];
    }

    try {
        return [parseTransactionTagFilter(tagFilter), false];
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] parse transaction tag filters error, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// transactionCountHandler returns transaction total count of current user
export async function transactionCountHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionCountHandler';
    const req = bindQuery<TransactionCountRequest>(c, TransactionCountRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const filter = await buildQueryFilter(c, uid, req, handler);
    const totalCount = await callOrFail(c, () => Transactions.getTransactionCount(c, uid, req.maxTime, req.minTime, filter), () => `[${P}.${handler}] failed to get transaction count for user "uid:${uid}"`);

    return { totalCount: totalCount };
}

// transactionListHandler returns transaction list of current user
export async function transactionListHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionListHandler';
    const req = bindQuery<TransactionListByMaxTimeRequest>(c, TransactionListByMaxTimeRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const filter = await buildQueryFilter(c, uid, req, handler);

    let totalCount = 0;

    if (req.withCount) {
        totalCount = await callOrFail(c, () => Transactions.getTransactionCount(c, uid, req.maxTime, req.minTime, filter), () => `[${P}.${handler}] failed to get transaction count for user "uid:${uid}"`);
    }

    let transactions = await callOrFail(c, () => Transactions.getTransactionsByMaxTime(c, uid, req.maxTime, req.minTime, filter, req.page, req.count, true, true), () => `[${P}.${handler}] failed to get transactions earlier than "${req.maxTime}" for user "uid:${uid}"`);

    let hasMore = false;
    let nextTimeSequenceId: bigint | null = null;

    if (transactions.length > req.count) {
        hasMore = true;
        nextTimeSequenceId = BigInt((transactions[req.count] as Transaction).transactionTime);
        transactions = transactions.slice(0, req.count);
    }

    const essentialData = await callOrFail(c, () => getTransactionEssentialDataByTransactionIds(c, user, transactions, req.withPictures, req.trimCategory, req.trimTag), () => `[${P}.${handler}] failed to get essential data for assembling transaction result for user "uid:${uid}"`);
    transactions = filterTransactions(c, uid, transactions, essentialData.accountMap);
    const transactionResult = getTransactionResponseListResult(user, transactions, essentialData, clientTimezone, req.withPictures, req.trimAccount, req.trimCategory, req.trimTag);

    const resp: Record<string, unknown> = {
        items: transactionResult,
        nextTimeSequenceId: hasMore ? nextTimeSequenceId : null,
    };

    if (req.withCount) {
        resp['totalCount'] = totalCount;
    }

    return resp;
}

// transactionMonthListHandler returns all transaction list of current user by month
export async function transactionMonthListHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionMonthListHandler';
    const req = bindQuery<TransactionListInMonthByPageRequest>(c, TransactionListInMonthByPageRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const filter = await buildQueryFilter(c, uid, req, handler);

    let transactions = await callOrFail(c, () => Transactions.getTransactionsInMonthByPage(c, uid, req.year, req.month, filter), () => `[${P}.${handler}] failed to get transactions in month "${req.year}-${req.month}" for user "uid:${uid}"`);
    const essentialData = await callOrFail(c, () => getTransactionEssentialDataByTransactionIds(c, user, transactions, req.withPictures, req.trimCategory, req.trimTag), () => `[${P}.${handler}] failed to get essential data for assembling transaction result for user "uid:${uid}"`);
    transactions = filterTransactions(c, uid, transactions, essentialData.accountMap);
    const transactionResult = getTransactionResponseListResult(user, transactions, essentialData, clientTimezone, req.withPictures, req.trimAccount, req.trimCategory, req.trimTag);

    return {
        items: transactionResult,
        totalCount: transactionResult.length,
    };
}

// transactionListAllHandler returns all transaction list of current user
export async function transactionListAllHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionListAllHandler';
    const req = bindQuery<TransactionAllListRequest>(c, TransactionAllListRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const filter = await buildQueryFilter(c, uid, req, handler);

    let maxTransactionTime = MAX_INT64_TRANSACTION_TIME;
    let minTransactionTime = 0;

    if (req.endTime > 0) {
        maxTransactionTime = getMaxTransactionTimeFromUnixTime(req.endTime);
    }

    if (req.startTime > 0) {
        minTransactionTime = getMinTransactionTimeFromUnixTime(req.startTime);
    }

    let allTransactions = await callOrFail(c, () => Transactions.getAllSpecifiedTransactions(c, uid, maxTransactionTime, minTransactionTime, filter, pageCountForDataExport, true), () => `[${P}.${handler}] failed to get all transactions for user "uid:${uid}"`);

    let essentialData: TransactionEssentialData;

    if (minTransactionTime === 0 && maxTransactionTime === MAX_INT64_TRANSACTION_TIME && (filter.categoryIds?.length ?? 0) < 1 && (filter.accountIds?.length ?? 0) < 1 && (filter.tagFilters?.length ?? 0) < 1 && req.amountFilter === '' && req.keyword === '') {
        essentialData = await callOrFail(c, () => getTransactionAllEssentialData(c, user, req.withPictures, req.trimCategory, req.trimTag), () => `[${P}.${handler}] failed to get essential data for assembling transaction result for user "uid:${uid}"`);
    } else {
        essentialData = await callOrFail(c, () => getTransactionEssentialDataByTransactionIds(c, user, allTransactions, req.withPictures, req.trimCategory, req.trimTag), () => `[${P}.${handler}] failed to get essential data for assembling transaction result for user "uid:${uid}"`);
    }

    allTransactions = filterTransactions(c, uid, allTransactions, essentialData.accountMap);
    return getTransactionResponseListResult(user, allTransactions, essentialData, clientTimezone, req.withPictures, req.trimAccount, req.trimCategory, req.trimTag);
}

// transactionReconciliationStatementHandler returns transaction reconciliation statement list of current user
export async function transactionReconciliationStatementHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionReconciliationStatementHandler';
    const req = bindQuery<TransactionReconciliationStatementRequest>(c, TransactionReconciliationStatementRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const account = await callOrFail(c, () => Accounts.getAccountByAccountId(c, uid, req.accountId), () => `[${P}.${handler}] failed to get account "id:${req.accountId}" for user "uid:${uid}"`);

    if (account.type !== ACCOUNT_TYPE_SINGLE_ACCOUNT) {
        log.errorf(c, `[${P}.${handler}] account "id:${req.accountId}" for user "uid:${uid}" is not a single account`);
        throw errs.ErrAccountTypeInvalid;
    }

    const maxTransactionTime = req.endTime > 0 ? getMaxTransactionTimeFromUnixTime(req.endTime) : 0;
    const minTransactionTime = req.startTime > 0 ? getMinTransactionTimeFromUnixTime(req.startTime) : 0;

    const [transactionsWithAccountBalance, totalInflows, totalOutflows, openingBalance, closingBalance] = await callOrFail(c,
        () => Transactions.getAllTransactionsInOneAccountWithAccountBalanceByMaxTime(c, uid, pageCountForAccountStatement, maxTransactionTime, minTransactionTime, req.accountId, account.category),
        () => `[${P}.${handler}] failed to get transactions from "${req.startTime}" to "${req.endTime}" for user "uid:${uid}"`);

    const transactions: Transaction[] = [];
    const transactionAccountBalanceMap = new Map<bigint, TransactionWithAccountBalance>();

    for (const transactionWithBalance of transactionsWithAccountBalance) {
        transactions.push(transactionWithBalance.transaction);
        transactionAccountBalanceMap.set(transactionWithBalance.transaction.transactionId, transactionWithBalance);
        transactionAccountBalanceMap.set(transactionWithBalance.transaction.relatedId, transactionWithBalance);
    }

    const allAccountIds: bigint[] = [];

    for (const transaction of transactions) {
        allAccountIds.push(transaction.accountId);

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            allAccountIds.push(transaction.relatedAccountId);
        }
    }

    const allAccounts = await callOrFail(c, () => Accounts.getAccountsByAccountIds(c, uid, toUniqueInt64Slice(allAccountIds)), () => `[${P}.${handler}] failed to get essential data for assembling transaction result for user "uid:${uid}"`);
    const transactionResult = getTransactionResponseListResult(user, transactions, {
        accountMap: allAccounts,
        categoryMap: null,
        tagMap: null,
        allTransactionTagIds: new Map(),
        pictureInfoMap: null,
    }, clientTimezone, false, true, true, true);

    const responseItems = transactionResult.map(result => {
        let accountOpeningBalance = 0n;
        let accountClosingBalance = 0n;
        const transactionWithBalance = transactionAccountBalanceMap.get(result.id);

        if (transactionWithBalance) {
            accountOpeningBalance = transactionWithBalance.accountOpeningBalance;
            accountClosingBalance = transactionWithBalance.accountClosingBalance;
        } else {
            log.warnf(c, `[${P}.${handler}] missing account balance for transaction "id:${result.id}" of user "uid:${uid}"`);
        }

        return {
            ...result,
            accountOpeningBalance: accountOpeningBalance.toString(),
            accountClosingBalance: accountClosingBalance.toString(),
        };
    });

    return {
        transactions: responseItems,
        totalInflows: totalInflows.toString(),
        totalOutflows: totalOutflows.toString(),
        openingBalance: openingBalance.toString(),
        closingBalance: closingBalance.toString(),
    };
}

function toStatisticResponseItems(totalAmounts: TransactionTotalAmount[]): TransactionStatisticResponseItem[] {
    return totalAmounts.map(totalAmountItem => {
        const item: Record<string, unknown> = {
            categoryId: totalAmountItem.categoryId,
            accountId: totalAmountItem.accountId,
        };

        if (totalAmountItem.type === TRANSACTION_DB_TYPE_TRANSFER_OUT || totalAmountItem.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            if (totalAmountItem.relatedAccountId !== 0n) {
                item['relatedAccountId'] = totalAmountItem.relatedAccountId;
            }

            let relatedAccountType = 0;

            try {
                relatedAccountType = transactionDbTypeToRelatedAccountType(totalAmountItem.type);
            } catch {
                relatedAccountType = 0;
            }

            if (relatedAccountType !== 0) {
                item['relatedAccountType'] = relatedAccountType;
            }
        }

        item['amount'] = totalAmountItem.amount.toString();
        return item as unknown as TransactionStatisticResponseItem;
    });
}

// transactionStatisticsHandler returns transaction statistics of current user
export async function transactionStatisticsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionStatisticsHandler';
    const req = bindQuery<TransactionStatisticRequest>(c, TransactionStatisticRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const [tagFilters, noTags] = parseTagFilters(c, req.tagFilter, handler);
    const uid = c.getCurrentUid();

    const totalAmounts = await callOrFail(c, () => Transactions.getAccountsAndCategoriesTotalInflowAndOutflow(c, uid, req.startTime, req.endTime, tagFilters, noTags, req.keyword, req.matchMode, clientTimezone, req.useTransactionTimezone), () => `[${P}.${handler}] failed to get accounts and categories total income and expense for user "uid:${uid}"`);

    return {
        startTime: req.startTime,
        endTime: req.endTime,
        items: toStatisticResponseItems(totalAmounts),
    };
}

// transactionStatisticsTrendsHandler returns transaction statistics trends of current user
export async function transactionStatisticsTrendsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionStatisticsTrendsHandler';
    const req = bindQuery<TransactionStatisticTrendsRequest>(c, TransactionStatisticTrendsRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    let startYear: number, startMonth: number, endYear: number, endMonth: number;

    try {
        [startYear, startMonth, endYear, endMonth] = getNumericYearMonthRange(req);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] cannot parse year month, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const [tagFilters, noTags] = parseTagFilters(c, req.tagFilter, handler);
    const uid = c.getCurrentUid();

    const allMonthlyTotalAmounts = await callOrFail(c, () => Transactions.getAccountsAndCategoriesMonthlyInflowAndOutflow(c, uid, startYear, startMonth, endYear, endMonth, tagFilters, noTags, req.keyword, req.matchMode, clientTimezone, req.useTransactionTimezone), () => `[${P}.${handler}] failed to get accounts and categories total income and expense for user "uid:${uid}"`);
    const statisticTrendsResp: TransactionStatisticTrendsResponseItem[] = [];

    for (const [yearMonth, monthlyTotalAmounts] of allMonthlyTotalAmounts) {
        statisticTrendsResp.push({
            year: Math.trunc(yearMonth / 100),
            month: yearMonth % 100,
            items: toStatisticResponseItems(monthlyTotalAmounts),
        });
    }

    return sortTransactionStatisticTrendsResponseItems(statisticTrendsResp);
}

// transactionStatisticsAssetTrendsHandler returns transaction statistics asset trends of current user
export async function transactionStatisticsAssetTrendsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionStatisticsAssetTrendsHandler';
    const req = bindQuery<TransactionStatisticAssetTrendsRequest>(c, TransactionStatisticAssetTrendsRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const maxTransactionTime = req.endTime > 0 ? getMaxTransactionTimeFromUnixTime(req.endTime) : 0;
    const minTransactionTime = req.startTime > 0 ? getMinTransactionTimeFromUnixTime(req.startTime) : 0;

    const accountDailyBalances = await callOrFail(c, () => Transactions.getAllAccountsDailyOpeningAndClosingBalance(c, uid, maxTransactionTime, minTransactionTime, clientTimezone), () => `[${P}.${handler}] failed to get transactions from "${req.startTime}" to "${req.endTime}" for user "uid:${uid}"`);
    const statisticAssetTrendsResp: TransactionStatisticAssetTrendsResponseItem[] = [];

    for (const [yearMonthDay, dailyAccountBalances] of accountDailyBalances) {
        statisticAssetTrendsResp.push({
            year: Math.trunc(yearMonthDay / 10000),
            month: Math.trunc((yearMonthDay % 10000) / 100),
            day: yearMonthDay % 100,
            items: dailyAccountBalances.map(accountBalance => ({
                accountId: accountBalance.transaction.accountId,
                accountOpeningBalance: accountBalance.accountOpeningBalance.toString(),
                accountClosingBalance: accountBalance.accountClosingBalance.toString(),
            })),
        });
    }

    return sortTransactionStatisticAssetTrendsResponseItems(statisticAssetTrendsResp);
}

function parseExcludeIds(ids: string, err: errs.AppError): bigint[] {
    if (ids === '') {
        return [];
    }

    try {
        return stringArrayToInt64Array(ids.split(','));
    } catch {
        throw err;
    }
}

function addAmountsByCurrency(c: WebContext, uid: bigint, handler: string, accountMap: AccountMap, amountsMap: Map<string, TransactionAmountsAndCurrency>, amounts: Map<bigint, bigint> | undefined, isIncome: boolean): void {
    if (!amounts) {
        return;
    }

    for (const [accountId, amount] of amounts) {
        const account = accountMap.get(accountId);

        if (!account) {
            log.warnf(c, `[${P}.${handler}] cannot find account for account "id:${accountId}" of user "uid:${uid}"`);
            continue;
        }

        let totalAmounts = amountsMap.get(account.currency);

        if (!totalAmounts) {
            totalAmounts = { currency: account.currency, incomeAmount: 0n, expenseAmount: 0n };
        }

        if (isIncome) {
            totalAmounts.incomeAmount += amount;
        } else {
            totalAmounts.expenseAmount += amount;
        }

        amountsMap.set(account.currency, totalAmounts);
    }
}

function toAmountInfos(amountsMap: Map<string, TransactionAmountsAndCurrency>): TransactionAmountsResponseItemAmountInfo[] {
    const allTotalAmounts: TransactionAmountsResponseItemAmountInfo[] = [];

    for (const totalAmounts of amountsMap.values()) {
        allTotalAmounts.push({
            currency: totalAmounts.currency,
            incomeAmount: totalAmounts.incomeAmount.toString(),
            expenseAmount: totalAmounts.expenseAmount.toString(),
        });
    }

    return sortTransactionAmountsResponseItemAmountInfos(allTotalAmounts);
}

// transactionAmountsHandler returns transaction amounts of current user
export async function transactionAmountsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionAmountsHandler';
    const req = bindQuery<TransactionAmountsRequest>(c, TransactionAmountsRequestSchema, `${P}.${handler}`);
    let requestItems;

    try {
        requestItems = getTransactionAmountsRequestItems(req);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] get request item failed, because ${errMsg(err)}`);
        throw errs.ErrQueryItemsInvalid;
    }

    if (requestItems.length < 1) {
        log.warnf(c, `[${P}.${handler}] parse request failed, because there are no valid items`);
        throw errs.ErrQueryItemsEmpty;
    }

    if (requestItems.length > 20) {
        log.warnf(c, `[${P}.${handler}] parse request failed, because there are too many items`);
        throw errs.ErrQueryItemsTooMuch;
    }

    const excludeAccountIds = parseExcludeIds(req.excludeAccountIds, errs.ErrAccountIdInvalid);
    const excludeCategoryIds = parseExcludeIds(req.excludeCategoryIds, errs.ErrTransactionCategoryIdInvalid);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const accounts = await callOrFail(c, () => Accounts.getAllAccountsByUid(c, uid), () => `[${P}.${handler}] failed to get all accounts for user "uid:${uid}"`);
    const accountMap = Accounts.getAccountMapByList(accounts);
    const amountsResp = new Map<string, TransactionAmountsResponseItem>();

    for (const requestItem of requestItems) {
        const [incomeAmounts, expenseAmounts] = await callOrFail(c, () => Transactions.getAccountsTotalIncomeAndExpense(c, uid, requestItem.startTime, requestItem.endTime, excludeAccountIds, excludeCategoryIds, clientTimezone, req.useTransactionTimezone), () => `[${P}.${handler}] failed to get transaction amounts item for user "uid:${uid}"`);
        const amountsMap = new Map<string, TransactionAmountsAndCurrency>();

        addAmountsByCurrency(c, uid, handler, accountMap, amountsMap, incomeAmounts, true);
        addAmountsByCurrency(c, uid, handler, accountMap, amountsMap, expenseAmounts, false);

        amountsResp.set(requestItem.name, {
            startTime: requestItem.startTime,
            endTime: requestItem.endTime,
            amounts: toAmountInfos(amountsMap),
        });
    }

    return amountsResp;
}

// transactionDailyAmountsHandler returns daily transaction amounts of current user
export async function transactionDailyAmountsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionDailyAmountsHandler';
    const req = bindQuery<TransactionDailyAmountsRequest>(c, TransactionDailyAmountsRequestSchema, `${P}.${handler}`);

    if (req.endTime < req.startTime) {
        throw errs.ErrDateRangeInvalid;
    }

    const excludeAccountIds = parseExcludeIds(req.excludeAccountIds, errs.ErrAccountIdInvalid);
    const excludeCategoryIds = parseExcludeIds(req.excludeCategoryIds, errs.ErrTransactionCategoryIdInvalid);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const accounts = await callOrFail(c, () => Accounts.getAllAccountsByUid(c, uid), () => `[${P}.${handler}] failed to get all accounts for user "uid:${uid}"`);
    const accountMap = Accounts.getAccountMapByList(accounts);

    const [incomeAmounts, expenseAmounts] = await callOrFail(c, () => Transactions.getAccountsDailyIncomeAndExpense(c, uid, req.startTime, req.endTime, excludeAccountIds, excludeCategoryIds, clientTimezone, req.useTransactionTimezone), () => `[${P}.${handler}] failed to get daily amounts for user "uid:${uid}"`);

    const dates = Array.from(new Set<number>([...incomeAmounts.keys(), ...expenseAmounts.keys()])).sort((a, b) => a - b);

    return dates.map(date => {
        const amountsByCurrency = new Map<string, TransactionAmountsAndCurrency>();
        addAmountsByCurrency(c, uid, handler, accountMap, amountsByCurrency, incomeAmounts.get(date), true);
        addAmountsByCurrency(c, uid, handler, accountMap, amountsByCurrency, expenseAmounts.get(date), false);

        return {
            date: formatNumericYearMonthDayToLongDate(date),
            amounts: toAmountInfos(amountsByCurrency),
        };
    });
}

// transactionGetHandler returns one specific transaction of current user
export async function transactionGetHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionGetHandler';
    const req = bindQuery<TransactionGetRequest>(c, TransactionGetRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    let transaction = await callOrFail(c, () => Transactions.getTransactionByTransactionId(c, uid, req.id), () => `[${P}.${handler}] failed to get transaction "id:${req.id}" for user "uid:${uid}"`);

    if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
        transaction = Transactions.getRelatedTransferTransaction(transaction) as Transaction;
    }

    let accountIds: bigint[] = [transaction.accountId];

    if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        accountIds.push(transaction.relatedAccountId);
        accountIds = toUniqueInt64Slice(accountIds);
    }

    let accountMap: AccountMap;

    try {
        accountMap = await Accounts.getAccountsByAccountIds(c, uid, accountIds);
    } catch {
        accountMap = new Map();
    }

    if (!accountMap.has(transaction.accountId)) {
        log.warnf(c, `[${P}.${handler}] account of transaction "id:${transaction.transactionId}" does not exist for user "uid:${uid}"`);
        throw errs.ErrTransactionNotFound;
    }

    if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && !accountMap.has(transaction.relatedAccountId)) {
        log.warnf(c, `[${P}.${handler}] related account of transaction "id:${transaction.transactionId}" does not exist for user "uid:${uid}"`);
        throw errs.ErrTransactionNotFound;
    }

    const currentTransaction = transaction;
    const allTransactionTagIds = await callOrFail(c, () => TransactionTags.getAllTagIdsOfTransactions(c, uid, [currentTransaction.transactionId]), () => `[${P}.${handler}] failed to get transactions tag ids for user "uid:${uid}"`);

    let category: TransactionCategory | null = null;
    let tagMap: Map<bigint, TransactionTag> | null = null;
    let pictureInfos: TransactionPictureInfo[] = [];

    if (!req.trimCategory) {
        category = await callOrFail(c, () => TransactionCategories.getCategoryByCategoryId(c, uid, currentTransaction.categoryId), () => `[${P}.${handler}] failed to get transactions category for user "uid:${uid}"`);
    }

    if (!req.trimTag) {
        tagMap = await callOrFail(c, () => TransactionTags.getTagsByTagIds(c, uid, toUniqueInt64Slice(TransactionTags.getTransactionTagIds(allTransactionTagIds))), () => `[${P}.${handler}] failed to get transactions tags for user "uid:${uid}"`);
    }

    if (req.withPictures && currentConfig().enableTransactionPictures) {
        pictureInfos = await callOrFail(c, () => TransactionPictures.getPictureInfosByTransactionId(c, uid, currentTransaction.transactionId), () => `[${P}.${handler}] failed to get transactions pictures for user "uid:${uid}"`);
    }

    const transactionEditable = isTransactionEditable(transaction, user, clientTimezone, accountMap.get(transaction.accountId) ?? null, accountMap.get(transaction.relatedAccountId) ?? null);
    const transactionTagIds = allTransactionTagIds.get(transaction.transactionId) ?? [];
    const transactionResp = toTransactionInfoResponseOrFail(transaction, transactionTagIds, transactionEditable);

    if (!req.trimAccount) {
        const sourceAccount = accountMap.get(transaction.accountId);
        const destinationAccount = accountMap.get(transaction.relatedAccountId);

        if (sourceAccount) {
            transactionResp.sourceAccount = toAccountInfoResponse(sourceAccount);
        }

        if (destinationAccount) {
            transactionResp.destinationAccount = toAccountInfoResponse(destinationAccount);
        }
    }

    if (!req.trimCategory && category) {
        transactionResp.category = toTransactionCategoryInfoResponse(category);
    }

    if (!req.trimTag) {
        transactionResp.tags = getTransactionTagInfoResponses(transactionTagIds, tagMap ?? new Map());
    }

    if (req.withPictures && currentConfig().enableTransactionPictures) {
        transactionResp.pictures = getTransactionPictureInfoResponseList(pictureInfos);
    }

    return rebuild(transactionResp);
}

// transactionCreateHandler saves a new transaction by request parameters for current user
export async function transactionCreateHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionCreateHandler';
    const req = await bindJson<TransactionCreateRequest>(c, TransactionCreateRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);

    const tagIds = parseInt64Array(req.tagIds, c, handler, 'tag', errs.ErrTransactionTagIdInvalid);

    if (tagIds.length > MaximumTagsCountOfTransaction) {
        throw errs.ErrTransactionHasTooManyTags;
    }

    const pictureIds = parseInt64Array(req.pictureIds, c, handler, 'picture', errs.ErrTransactionPictureIdInvalid);

    if (pictureIds.length > MaximumPicturesCountOfTransaction) {
        throw errs.ErrTransactionHasTooManyPictures;
    }

    if (req.type < TRANSACTION_TYPE_MODIFY_BALANCE || req.type > TRANSACTION_TYPE_TRANSFER) {
        log.warnf(c, `[${P}.${handler}] transaction type is invalid`);
        throw errs.ErrTransactionTypeInvalid;
    }

    if (req.type === TRANSACTION_TYPE_MODIFY_BALANCE && req.categoryId !== 0n) {
        log.warnf(c, `[${P}.${handler}] balance modification transaction cannot set category id`);
        throw errs.ErrBalanceModificationTransactionCannotSetCategory;
    }

    if (req.type !== TRANSACTION_TYPE_TRANSFER && req.destinationAccountId !== 0n) {
        log.warnf(c, `[${P}.${handler}] non-transfer transaction destination account cannot be set`);
        throw errs.ErrTransactionDestinationAccountCannotBeSet;
    } else if (req.type === TRANSACTION_TYPE_TRANSFER && req.sourceAccountId === req.destinationAccountId) {
        log.warnf(c, `[${P}.${handler}] transfer transaction source account must not be destination account`);
        throw errs.ErrTransactionSourceAndDestinationIdCannotBeEqual;
    }

    if (req.type !== TRANSACTION_TYPE_TRANSFER && req.destinationAmount !== 0) {
        log.warnf(c, `[${P}.${handler}] non-transfer transaction destination amount cannot be set`);
        throw errs.ErrTransactionDestinationAmountCannotBeSet;
    }

    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    let transaction = createNewTransactionModel(uid, req, c.clientIP());
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, [transaction], handler);

    const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, allUsedAccounts.get(transaction.accountId) ?? null, allUsedAccounts.get(transaction.relatedAccountId) ?? null);

    if (!transactionEditable) {
        throw errs.ErrCannotCreateTransactionWithThisTransactionTime;
    }

    let pictureInfos: TransactionPictureInfo[] = [];

    if (pictureIds.length > 0) {
        pictureInfos = await callOrFail(c, () => TransactionPictures.getNewPictureInfosByPictureIds(c, uid, pictureIds), () => `[${P}.${handler}] failed to get transactions pictures for user "uid:${uid}"`);
        const notExistsPictureIds = int64SliceMinus(pictureIds, TransactionPictures.getTransactionPictureIds(pictureInfos)) ?? [];

        if (notExistsPictureIds.length > 0) {
            log.errorf(c, `[${P}.${handler}] some pictures "ids:${notExistsPictureIds.join(',')}" does not exists for user "uid:${uid}"`);
            throw errs.ErrTransactionPictureNotFound;
        }
    }

    if (currentConfig().enableDuplicateSubmissionsCheck && req.clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_NEW_TRANSACTION, uid, req.clientSessionId);

        if (found) {
            log.infof(c, `[${P}.${handler}] another transaction "id:${remark}" has been created for user "uid:${uid}"`);
            let transactionId: bigint | null = null;

            try {
                transactionId = stringToInt64(remark);
            } catch {
                transactionId = null;
            }

            if (transactionId !== null) {
                const id = transactionId;
                transaction = await callOrFail(c, () => Transactions.getTransactionByTransactionId(c, uid, id), () => `[${P}.${handler}] failed to get existed transaction "id:${id}" for user "uid:${uid}"`);
                const existedResp = toTransactionInfoResponseOrFail(transaction, tagIds, transactionEditable);
                existedResp.pictures = getTransactionPictureInfoResponseList(pictureInfos);
                return rebuild(existedResp);
            }
        }
    }

    const newTransactionModel = transaction;
    await callOrFail(c, () => Transactions.createTransaction(c, newTransactionModel, tagIds, pictureIds), () => `[${P}.${handler}] failed to create transaction "id:${newTransactionModel.transactionId}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has created a new transaction "id:${transaction.transactionId}" successfully`);

    setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_NEW_TRANSACTION, uid, req.clientSessionId, transaction.transactionId.toString());

    const transactionResp = toTransactionInfoResponseOrFail(transaction, tagIds, transactionEditable);
    transactionResp.pictures = getTransactionPictureInfoResponseList(pictureInfos);
    return rebuild(transactionResp);
}

// transactionModifyHandler saves an existed transaction by request parameters for current user
export async function transactionModifyHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionModifyHandler';
    const req = await bindJson<TransactionModifyRequest>(c, TransactionModifyRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);

    const tagIds = parseInt64Array(req.tagIds, c, handler, 'tag', errs.ErrTransactionTagIdInvalid);

    if (tagIds.length > MaximumTagsCountOfTransaction) {
        throw errs.ErrTransactionHasTooManyTags;
    }

    const pictureIds = parseInt64Array(req.pictureIds, c, handler, 'picture', errs.ErrTransactionPictureIdInvalid);

    if (pictureIds.length > MaximumPicturesCountOfTransaction) {
        throw errs.ErrTransactionHasTooManyPictures;
    }

    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const transaction = await callOrFail(c, () => Transactions.getTransactionByTransactionId(c, uid, req.id), () => `[${P}.${handler}] failed to get transaction "id:${req.id}" for user "uid:${uid}"`);

    if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
        log.warnf(c, `[${P}.${handler}] cannot modify transaction "id:${req.id}" for user "uid:${uid}", because transaction type is transfer in`);
        throw errs.ErrTransactionTypeInvalid;
    }

    let newTransactionType: TransactionDbType;

    try {
        newTransactionType = transactionTypeToTransactionDbType(req.type);
    } catch {
        throw errs.ErrTransactionTypeInvalid;
    }

    if ((transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE && newTransactionType !== TRANSACTION_DB_TYPE_MODIFY_BALANCE) ||
        (transaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE && newTransactionType === TRANSACTION_DB_TYPE_MODIFY_BALANCE)) {
        log.warnf(c, `[${P}.${handler}] cannot modify transaction type from "${transaction.type}" to "${newTransactionType}"`);
        throw errs.ErrTransactionTypeInvalid;
    }

    const changeToTransfer = newTransactionType === TRANSACTION_DB_TYPE_TRANSFER_OUT && transaction.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT;

    if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE && req.categoryId !== 0n) {
        log.warnf(c, `[${P}.${handler}] balance modification transaction cannot set category id`);
        throw errs.ErrBalanceModificationTransactionCannotSetCategory;
    } else if (transaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE && req.categoryId === 0n) {
        log.warnf(c, `[${P}.${handler}] non-balance modification transaction must set category id`);
        throw errs.ErrIncompleteOrIncorrectSubmission;
    }

    const allTransactionTagIds = await callOrFail(c, () => TransactionTags.getAllTagIdsOfTransactions(c, uid, [transaction.transactionId]), () => `[${P}.${handler}] failed to get transactions tag ids for user "uid:${uid}"`);
    const transactionTagIds = allTransactionTagIds.get(transaction.transactionId) ?? [];
    const transactionPictureInfos = await callOrFail(c, () => TransactionPictures.getPictureInfosByTransactionId(c, uid, transaction.transactionId), () => `[${P}.${handler}] failed to get transaction picture infos for user "uid:${uid}"`);
    const transactionPictureIds = TransactionPictures.getTransactionPictureIds(transactionPictureInfos);

    const newTransactionModel = newTransaction({
        transactionId: transaction.transactionId,
        uid: uid,
        type: newTransactionType,
        categoryId: req.categoryId,
        transactionTime: getMinTransactionTimeFromUnixTime(req.time),
        timezoneUtcOffset: req.utcOffset,
        accountId: req.sourceAccountId,
        amount: req.sourceAmount,
        hideAmount: req.hideAmount,
        comment: req.comment,
    });

    if (newTransactionModel.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        newTransactionModel.relatedAccountId = req.destinationAccountId;
        newTransactionModel.relatedAccountAmount = req.destinationAmount;
    }

    if (req.geoLocation) {
        newTransactionModel.geoLongitude = req.geoLocation.longitude;
        newTransactionModel.geoLatitude = req.geoLocation.latitude;
    }

    if (newTransactionModel.type === transaction.type &&
        newTransactionModel.categoryId === transaction.categoryId &&
        getUnixTimeFromTransactionTime(newTransactionModel.transactionTime) === getUnixTimeFromTransactionTime(transaction.transactionTime) &&
        newTransactionModel.timezoneUtcOffset === transaction.timezoneUtcOffset &&
        newTransactionModel.accountId === transaction.accountId &&
        newTransactionModel.amount === transaction.amount &&
        (newTransactionModel.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT || newTransactionModel.relatedAccountId === transaction.relatedAccountId) &&
        (newTransactionModel.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT || newTransactionModel.relatedAccountAmount === transaction.relatedAccountAmount) &&
        newTransactionModel.hideAmount === transaction.hideAmount &&
        newTransactionModel.comment === transaction.comment &&
        newTransactionModel.geoLongitude === transaction.geoLongitude &&
        newTransactionModel.geoLatitude === transaction.geoLatitude &&
        int64SliceEquals(tagIds, transactionTagIds) &&
        int64SliceEquals(pictureIds, transactionPictureIds)) {
        throw errs.ErrNothingWillBeUpdated;
    }

    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, [transaction, newTransactionModel], handler);
    const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, allUsedAccounts.get(transaction.accountId) ?? null, allUsedAccounts.get(transaction.relatedAccountId) ?? null);
    const newTransactionEditable = canEditTransactionByTransactionTime(user, newTransactionModel.transactionTime, clientTimezone, allUsedAccounts.get(newTransactionModel.accountId) ?? null, allUsedAccounts.get(newTransactionModel.relatedAccountId) ?? null);

    if (!transactionEditable || !newTransactionEditable) {
        throw errs.ErrCannotModifyTransactionWithThisTransactionTime;
    }

    let addTransactionTagIds: bigint[] = [];
    let removeTransactionTagIds: bigint[] = [];

    if (!int64SliceEquals(tagIds, transactionTagIds)) {
        removeTransactionTagIds = transactionTagIds;
        addTransactionTagIds = tagIds;
    }

    const addTransactionPictureIds = int64SliceMinus(pictureIds, transactionPictureIds) ?? [];
    const removeTransactionPictureIds = int64SliceMinus(transactionPictureIds, pictureIds) ?? [];
    const newPictureInfos: TransactionPictureInfo[] = [];

    if (!int64SliceEquals(pictureIds, transactionPictureIds)) {
        const oldAndNewPictureIds = [...transactionPictureIds];
        const oldAndNewPictureInfoMap = TransactionPictures.getPictureInfoMapByList(transactionPictureInfos);

        if (addTransactionPictureIds.length > 0) {
            const addPictureInfos = await callOrFail(c, () => TransactionPictures.getNewPictureInfosByPictureIds(c, uid, addTransactionPictureIds), () => `[${P}.${handler}] failed to get transactions pictures for user "uid:${uid}"`);
            oldAndNewPictureIds.push(...TransactionPictures.getTransactionPictureIds(addPictureInfos));
            const notExistsPictureIds = int64SliceMinus(pictureIds, oldAndNewPictureIds) ?? [];

            if (notExistsPictureIds.length > 0) {
                log.errorf(c, `[${P}.${handler}] some pictures "ids:${notExistsPictureIds.join(',')}" does not exists for user "uid:${uid}"`);
                throw errs.ErrTransactionPictureNotFound;
            }

            for (const pictureInfo of addPictureInfos) {
                oldAndNewPictureInfoMap.set(pictureInfo.pictureId, pictureInfo);
            }
        }

        for (const pictureId of pictureIds) {
            const pictureInfo = oldAndNewPictureInfoMap.get(pictureId);

            if (pictureInfo) {
                newPictureInfos.push(pictureInfo);
            }
        }
    }

    await callOrFail(c, () => Transactions.modifyTransaction(c, newTransactionModel, changeToTransfer, transactionTagIds.length, addTransactionTagIds, removeTransactionTagIds, addTransactionPictureIds, removeTransactionPictureIds), () => `[${P}.${handler}] failed to update transaction "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has updated transaction "id:${req.id}" successfully`);

    const newTransactionResp = toTransactionInfoResponseOrFail(newTransactionModel, tagIds, transactionEditable);
    newTransactionResp.pictures = getTransactionPictureInfoResponseList(newPictureInfos);
    return rebuild(newTransactionResp);
}

// transactionBatchUpdateCategoriesHandler batch updates categories of transactions by request parameters for current user
export async function transactionBatchUpdateCategoriesHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionBatchUpdateCategoriesHandler';
    const req = await bindJson<TransactionBatchUpdateCategoryRequest>(c, TransactionBatchUpdateCategoryRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const transactionIds = parseInt64Array(req.transactionIds, c, handler, 'transaction', errs.ErrTransactionIdInvalid);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const category = await callOrFail(c, () => TransactionCategories.getCategoryByCategoryId(c, uid, req.categoryId), () => `[${P}.${handler}] failed to get category "id:${req.categoryId}" for user "uid:${uid}"`);

    if (category.parentCategoryId === LevelOneTransactionCategoryParentId) {
        log.warnf(c, `[${P}.${handler}] transaction category "id:${category.categoryId}" is not a sub category`);
        throw errs.ErrCannotUsePrimaryCategoryForTransaction;
    }

    let expectedTransactionType: TransactionDbType = 0;

    if (category.type === CATEGORY_TYPE_EXPENSE) {
        expectedTransactionType = TRANSACTION_DB_TYPE_EXPENSE;
    } else if (category.type === CATEGORY_TYPE_INCOME) {
        expectedTransactionType = TRANSACTION_DB_TYPE_INCOME;
    } else if (category.type === CATEGORY_TYPE_TRANSFER) {
        expectedTransactionType = TRANSACTION_DB_TYPE_TRANSFER_OUT;
    }

    const transactions = await callOrFail(c, () => Transactions.getTransactionsByTransactionIds(c, uid, transactionIds), () => `[${P}.${handler}] failed to get transactions for user "uid:${uid}"`);
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, transactions, handler);
    const allTransactionIds: bigint[] = [];

    for (const transaction of transactions) {
        if (transaction.type !== expectedTransactionType) {
            log.warnf(c, `[${P}.${handler}] transaction "id:${transaction.transactionId}" type is not expected type "${expectedTransactionType}" for user "uid:${uid}"`);
            throw errs.ErrTransactionTypeInvalid;
        }

        checkTransactionEditable(c, user, transaction, clientTimezone, allUsedAccounts, handler, errs.ErrCannotModifyTransactionWithThisTransactionTime);
        allTransactionIds.push(transaction.transactionId);

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            allTransactionIds.push(transaction.relatedId);
        }
    }

    await callOrFail(c, () => Transactions.batchUpdateTransactionsCategory(c, uid, allTransactionIds, category.categoryId), () => `[${P}.${handler}] failed to batch update transactions category for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has batch updated category of ${req.transactionIds.length} transactions successfully`);
    return true;
}

// transactionBatchUpdateAccountsHandler batch updates accounts of transactions by request parameters for current user
export async function transactionBatchUpdateAccountsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionBatchUpdateAccountsHandler';
    const req = await bindJson<TransactionBatchUpdateAccountRequest>(c, TransactionBatchUpdateAccountRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const transactionIds = parseInt64Array(req.transactionIds, c, handler, 'transaction', errs.ErrTransactionIdInvalid);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const allAccounts = await callOrFail(c, () => Accounts.getAllAccountsByUid(c, uid), () => `[${P}.${handler}] failed to get all accounts for user "uid:${uid}"`);
    const accountMap = Accounts.getAccountMapByList(allAccounts);
    const account = accountMap.get(req.accountId);

    if (!account) {
        log.warnf(c, `[${P}.${handler}] account "id:${req.accountId}" does not exist for user "uid:${uid}"`);
        throw errs.ErrAccountNotFound;
    }

    if (account.hidden) {
        log.warnf(c, `[${P}.${handler}] account "id:${account.accountId}" is hidden for user "uid:${uid}"`);
        throw errs.ErrCannotMoveTransactionFromOrToHiddenAccount;
    }

    if (account.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
        log.warnf(c, `[${P}.${handler}] account "id:${account.accountId}" is a parent account, cannot be used for transaction of user "uid:${uid}"`);
        throw errs.ErrCannotModifyTransactionInParentAccount;
    }

    const transactions = await callOrFail(c, () => Transactions.getTransactionsByTransactionIds(c, uid, transactionIds), () => `[${P}.${handler}] failed to get transactions for user "uid:${uid}"`);

    for (const transaction of transactions) {
        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            log.warnf(c, `[${P}.${handler}] cannot modify transaction "id:${transaction.transactionId}" for user "uid:${uid}", because transaction type is transfer in`);
            throw errs.ErrTransactionTypeInvalid;
        }

        if (req.isDestinationAccount && transaction.type !== TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            log.warnf(c, `[${P}.${handler}] cannot update destination account of non-transfer transaction "id:${transaction.transactionId}" for user "uid:${uid}"`);
            throw errs.ErrTransactionDestinationAccountCannotBeSet;
        }

        if (!req.isDestinationAccount && account.accountId === transaction.relatedAccountId) {
            log.warnf(c, `[${P}.${handler}] cannot update account to same destination account of transaction "id:${transaction.transactionId}" for user "uid:${uid}"`);
            throw errs.ErrTransactionSourceAndDestinationIdCannotBeEqual;
        } else if (req.isDestinationAccount && account.accountId === transaction.accountId) {
            log.warnf(c, `[${P}.${handler}] cannot update destination account to same source account of transaction "id:${transaction.transactionId}" for user "uid:${uid}"`);
            throw errs.ErrTransactionSourceAndDestinationIdCannotBeEqual;
        }

        const oldAccount = !req.isDestinationAccount ? accountMap.get(transaction.accountId) : accountMap.get(transaction.relatedAccountId);

        if (!oldAccount) {
            log.warnf(c, `[${P}.${handler}] the original account of transaction "id:${transaction.transactionId}" does not exist for user "uid:${uid}"`);
            throw errs.ErrAccountNotFound;
        }

        if (oldAccount.hidden) {
            log.warnf(c, `[${P}.${handler}] the original account of transaction "id:${transaction.transactionId}" is hidden for user "uid:${uid}"`);
            throw errs.ErrCannotMoveTransactionFromOrToHiddenAccount;
        }

        if (oldAccount.currency !== account.currency) {
            log.warnf(c, `[${P}.${handler}] cannot update account of transaction "id:${transaction.transactionId}", because the original account currency "${oldAccount.currency}" is different from updated account currency "${account.currency}" for user "uid:${uid}"`);
            throw errs.ErrCannotMoveTransactionBetweenAccountsWithDifferentCurrencies;
        }

        let newSourceAccount = accountMap.get(transaction.accountId) ?? null;
        let newDestinationAccount = accountMap.get(transaction.relatedAccountId) ?? null;

        if (!req.isDestinationAccount && transaction.accountId !== account.accountId) {
            newSourceAccount = account;
        } else if (req.isDestinationAccount && transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && transaction.relatedAccountId !== account.accountId) {
            newDestinationAccount = account;
        }

        const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, accountMap.get(transaction.accountId) ?? null, accountMap.get(transaction.relatedAccountId) ?? null);
        const newTransactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, newSourceAccount, newDestinationAccount);

        if (!transactionEditable || !newTransactionEditable) {
            log.warnf(c, `[${P}.${handler}] transaction "id:${transaction.transactionId}" is not editable for user "uid:${uid}"`);
            throw errs.ErrCannotModifyTransactionWithThisTransactionTime;
        }
    }

    let updatedCount = 0;

    for (const transaction of transactions) {
        if (!req.isDestinationAccount && transaction.accountId !== account.accountId) {
            transaction.accountId = account.accountId;
        } else if (req.isDestinationAccount && transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && transaction.relatedAccountId !== account.accountId) {
            transaction.relatedAccountId = account.accountId;
        } else {
            log.warnf(c, `[${P}.${handler}] skip updating transaction "id:${transaction.transactionId}", because the original account is same as updated account for user "uid:${uid}"`);
            continue;
        }

        await callOrFail(c, () => Transactions.modifyTransaction(c, transaction, false, 0, [], [], [], []), () => `[${P}.${handler}] failed to update transaction "id:${transaction.transactionId}" for user "uid:${uid}"`);
        updatedCount++;
    }

    if (updatedCount < 1) {
        throw errs.ErrNothingWillBeUpdated;
    }

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has batch updated account of ${updatedCount} transactions successfully`);
    return true;
}

async function checkTagsExist(c: WebContext, uid: bigint, tagIds: bigint[], handler: string): Promise<void> {
    const tags = await callOrFail(c, () => TransactionTags.getTagsByTagIds(c, uid, tagIds), () => `[${P}.${handler}] failed to get tags for user "uid:${uid}"`);

    if (tags.size !== tagIds.length) {
        log.warnf(c, `[${P}.${handler}] some tags do not exist for user "uid:${uid}"`);
        throw errs.ErrTransactionTagNotFound;
    }
}

function checkNotTransferIn(c: WebContext, uid: bigint, transaction: Transaction, handler: string): void {
    if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
        log.warnf(c, `[${P}.${handler}] cannot modify transaction "id:${transaction.transactionId}" for user "uid:${uid}", because transaction type is transfer in`);
        throw errs.ErrTransactionTypeInvalid;
    }
}

function checkTransactionEditable(c: WebContext, user: User, transaction: Transaction, clientTimezone: Timezone, allUsedAccounts: AccountMap, handler: string, err: errs.AppError): void {
    const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, allUsedAccounts.get(transaction.accountId) ?? null, allUsedAccounts.get(transaction.relatedAccountId) ?? null);

    if (!transactionEditable) {
        log.warnf(c, `[${P}.${handler}] transaction "id:${transaction.transactionId}" is not editable for user "uid:${user.uid}"`);
        throw err;
    }
}

// transactionBatchAddTagsHandler batch adds tags to transactions by request parameters for current user
export async function transactionBatchAddTagsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionBatchAddTagsHandler';
    const req = await bindJson<TransactionBatchAddTagsRequest>(c, TransactionBatchTagsRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const transactionIds = parseInt64Array(req.transactionIds, c, handler, 'transaction', errs.ErrTransactionIdInvalid);
    const tagIds = toUniqueInt64Slice(parseInt64Array(req.tagIds, c, handler, 'tag', errs.ErrTransactionTagIdInvalid));
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    await checkTagsExist(c, uid, tagIds, handler);

    const transactions = await callOrFail(c, () => Transactions.getTransactionsByTransactionIds(c, uid, transactionIds), () => `[${P}.${handler}] failed to get transactions for user "uid:${uid}"`);
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, transactions, handler);
    const transactionTagIndexes = await callOrFail(c, () => TransactionTags.getAllTagIdsOfTransactions(c, uid, transactionIds), () => `[${P}.${handler}] failed to get transactions tag indexes for user "uid:${uid}"`);
    const allNewTransactionTagIndexes = new Map<bigint, bigint[]>();

    for (const transaction of transactions) {
        checkNotTransferIn(c, uid, transaction, handler);
        checkTransactionEditable(c, user, transaction, clientTimezone, allUsedAccounts, handler, errs.ErrCannotModifyTransactionWithThisTransactionTime);

        const existedTagIds = new Set<bigint>(transactionTagIndexes.get(transaction.transactionId) ?? []);
        allNewTransactionTagIndexes.set(transaction.transactionId, tagIds.filter(tagId => !existedTagIds.has(tagId)));
    }

    await callOrFail(c, () => Transactions.batchAddTagsToTransactions(c, uid, transactions, allNewTransactionTagIndexes), () => `[${P}.${handler}] failed to batch update transactions tags for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has batch updated tag of ${allNewTransactionTagIndexes.size} transactions successfully`);
    return true;
}

// transactionBatchRemoveTagsHandler batch removes tags from transactions by request parameters for current user
export async function transactionBatchRemoveTagsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionBatchRemoveTagsHandler';
    const req = await bindJson<TransactionBatchAddTagsRequest>(c, TransactionBatchTagsRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const transactionIds = parseInt64Array(req.transactionIds, c, handler, 'transaction', errs.ErrTransactionIdInvalid);
    const tagIds = toUniqueInt64Slice(parseInt64Array(req.tagIds, c, handler, 'tag', errs.ErrTransactionTagIdInvalid));
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    await checkTagsExist(c, uid, tagIds, handler);

    const transactions = await callOrFail(c, () => Transactions.getTransactionsByTransactionIds(c, uid, transactionIds), () => `[${P}.${handler}] failed to get transactions for user "uid:${uid}"`);
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, transactions, handler);
    const allTransactionIds: bigint[] = [];

    for (const transaction of transactions) {
        checkNotTransferIn(c, uid, transaction, handler);
        checkTransactionEditable(c, user, transaction, clientTimezone, allUsedAccounts, handler, errs.ErrCannotModifyTransactionWithThisTransactionTime);
        allTransactionIds.push(transaction.transactionId);
    }

    await callOrFail(c, () => Transactions.batchRemoveTagsFromTransactions(c, uid, allTransactionIds, tagIds), () => `[${P}.${handler}] failed to batch update transactions tags for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has batch updated tag of ${allTransactionIds.length} transactions successfully`);
    return true;
}

// transactionBatchClearTagsHandler batch clears all tags from transactions by request parameters for current user
export async function transactionBatchClearTagsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionBatchClearTagsHandler';
    const req = await bindJson<TransactionBatchClearTagsRequest>(c, TransactionBatchClearTagsRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const transactionIds = parseInt64Array(req.transactionIds, c, handler, 'transaction', errs.ErrTransactionIdInvalid);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const transactions = await callOrFail(c, () => Transactions.getTransactionsByTransactionIds(c, uid, transactionIds), () => `[${P}.${handler}] failed to get transactions for user "uid:${uid}"`);
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, transactions, handler);
    const allTransactionIds: bigint[] = [];

    for (const transaction of transactions) {
        checkNotTransferIn(c, uid, transaction, handler);
        checkTransactionEditable(c, user, transaction, clientTimezone, allUsedAccounts, handler, errs.ErrCannotModifyTransactionWithThisTransactionTime);
        allTransactionIds.push(transaction.transactionId);
    }

    await callOrFail(c, () => Transactions.batchClearAllTagsFromTransactions(c, uid, allTransactionIds), () => `[${P}.${handler}] failed to batch update transactions tags for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has batch updated tag of ${allTransactionIds.length} transactions successfully`);
    return true;
}

// transactionMoveAllBetweenAccountsHandler moves all transactions from one account to another account for current user
export async function transactionMoveAllBetweenAccountsHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionMoveAllBetweenAccountsHandler';
    const req = await bindJson<TransactionMoveBetweenAccountsRequest>(c, TransactionMoveBetweenAccountsRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);

    if (req.fromAccountId === req.toAccountId) {
        throw errs.ErrCannotMoveTransactionToSameAccount;
    }

    const accountMap = await callOrFail(c, () => Accounts.getAccountsByAccountIds(c, uid, [req.fromAccountId, req.toAccountId]), () => `[${P}.${handler}] failed to get accounts for user "uid:${uid}"`);
    const fromAccount = accountMap.get(req.fromAccountId);

    if (!fromAccount) {
        throw errs.ErrSourceAccountNotFound;
    }

    const toAccount = accountMap.get(req.toAccountId);

    if (!toAccount) {
        throw errs.ErrDestinationAccountNotFound;
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

    const filter: TransactionQueryFilter = {
        transactionType: 0,
        categoryIds: null,
        accountIds: [fromAccount.accountId],
        tagFilters: null,
        noTags: false,
        amountFilter: '',
        keyword: '',
        matchMode: MATCH_MODE_DEFAULT,
        mustHavePictures: false,
    };

    const transactions = await callOrFail(c, () => Transactions.getAllSpecifiedTransactions(c, uid, 0, 0, filter, pageCountForMovingAccountTransactions, true), () => `[${P}.${handler}] failed to get all transactions of account "id:${fromAccount.accountId}" for user "uid:${uid}"`);
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, transactions, handler);

    for (const transaction of transactions) {
        const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, allUsedAccounts.get(transaction.accountId) ?? null, allUsedAccounts.get(transaction.relatedAccountId) ?? null);
        let newTransactionEditable = transactionEditable;

        if (transaction.accountId === fromAccount.accountId) {
            newTransactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, toAccount, allUsedAccounts.get(transaction.relatedAccountId) ?? null);
        } else if (transaction.relatedAccountId === fromAccount.accountId) {
            newTransactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, allUsedAccounts.get(transaction.accountId) ?? null, toAccount);
        }

        if (!transactionEditable || !newTransactionEditable) {
            log.warnf(c, `[${P}.${handler}] transaction "id:${transaction.transactionId}" is not editable for user "uid:${uid}"`);
            throw errs.ErrCannotModifyTransactionWithThisTransactionTime;
        }
    }

    await callOrFail(c, () => Transactions.moveAllTransactionsBetweenAccounts(c, uid, fromAccount.accountId, toAccount.accountId), () => `[${P}.${handler}] failed to move all transactions from account "id:${req.fromAccountId}" to account "id:${req.toAccountId}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has moved all transactions from account "id:${req.fromAccountId}" to account "id:${req.toAccountId}" successfully`);
    return true;
}

// transactionDeleteHandler deletes an existed transaction by request parameters for current user
export async function transactionDeleteHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionDeleteHandler';
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);
    const transaction = await callOrFail(c, () => Transactions.getTransactionByTransactionId(c, uid, req.id), () => `[${P}.${handler}] failed to get transaction "id:${req.id}" for user "uid:${uid}"`);

    if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
        log.warnf(c, `[${P}.${handler}] cannot delete transaction "id:${req.id}" for user "uid:${uid}", because transaction type is transfer in`);
        throw errs.ErrTransactionTypeInvalid;
    }

    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, [transaction], handler);
    const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, allUsedAccounts.get(transaction.accountId) ?? null, allUsedAccounts.get(transaction.relatedAccountId) ?? null);

    if (!transactionEditable) {
        throw errs.ErrCannotDeleteTransactionWithThisTransactionTime;
    }

    await callOrFail(c, () => Transactions.deleteTransaction(c, uid, req.id), () => `[${P}.${handler}] failed to delete transaction "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has deleted transaction "id:${req.id}"`);
    return true;
}

// transactionBatchDeleteHandler deletes existed transactions by request parameters for current user
export async function transactionBatchDeleteHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionBatchDeleteHandler';
    const req = await bindJson<TransactionBatchDeleteRequest>(c, TransactionBatchDeleteRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const transactionIds = parseInt64Array(req.ids, c, handler, 'transaction', errs.ErrTransactionIdInvalid);
    const uid = c.getCurrentUid();
    const user = await getUserOrNotFound(c, handler);

    if (!Users.isPasswordEqualsUserPassword(req.password, user)) {
        throw errs.ErrUserPasswordWrong;
    }

    const transactions = await callOrFail(c, () => Transactions.getTransactionsByTransactionIds(c, uid, transactionIds), () => `[${P}.${handler}] failed to get transactions for user "uid:${uid}"`);
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, transactions, handler);

    for (const transaction of transactions) {
        checkTransactionEditable(c, user, transaction, clientTimezone, allUsedAccounts, handler, errs.ErrCannotDeleteTransactionWithThisTransactionTime);
    }

    let deletedCount = 0;

    for (const transaction of transactions) {
        await callOrFail(c, () => Transactions.deleteTransaction(c, uid, transaction.transactionId), () => `[${P}.${handler}] failed to delete transaction "id:${transaction.transactionId}" for user "uid:${uid}"`);
        deletedCount++;
    }

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has deleted ${deletedCount} transactions`);
    return true;
}

// filterTransactions removes the transactions whose account does not exist
export function filterTransactions(c: WebContext, uid: bigint, transactions: Transaction[], accountMap: AccountMap): Transaction[] {
    const finalTransactions: Transaction[] = [];

    for (const transaction of transactions) {
        if (!accountMap.has(transaction.accountId)) {
            log.warnf(c, `[${P}.filterTransactions] account of transaction "id:${transaction.transactionId}" does not exist for user "uid:${uid}"`);
            continue;
        }

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            if (!accountMap.has(transaction.relatedAccountId)) {
                log.warnf(c, `[${P}.filterTransactions] related account of transaction "id:${transaction.transactionId}" does not exist for user "uid:${uid}"`);
                continue;
            }
        }

        finalTransactions.push(transaction);
    }

    return finalTransactions;
}

function getTransactionTagInfoResponses(tagIds: bigint[], allTransactionTags: Map<bigint, TransactionTag>): TransactionTagInfoResponse[] {
    const allTags: TransactionTagInfoResponse[] = [];

    for (const tagId of tagIds) {
        const tag = allTransactionTags.get(tagId);

        if (tag) {
            allTags.push(toTransactionTagInfoResponse(tag));
        }
    }

    return allTags;
}

// getTransactionAllEssentialData returns all accounts, categories, tags and pictures of current user
export async function getTransactionAllEssentialData(c: WebContext, user: User, withPictures: boolean, trimCategory: boolean, trimTag: boolean): Promise<TransactionEssentialData> {
    const uid = user.uid;
    const prefix = `[${P}.getTransactionAllEssentialData]`;

    const allAccounts = await logOnError(c, () => Accounts.getAllAccountsByUid(c, uid), () => `${prefix} failed to get all accounts for user "uid:${uid}"`);
    const accountMap = Accounts.getAccountMapByList(allAccounts);
    const allTagIndexes = await logOnError(c, () => TransactionTags.getAllTagIdsOfAllTransactions(c, uid), () => `${prefix} failed to get all transactions tag ids for user "uid:${uid}"`);
    const allTransactionTagIds = TransactionTags.getGroupedTransactionTagIds(allTagIndexes);
    let categoryMap: Map<bigint, TransactionCategory> | null = null;
    let tagMap: Map<bigint, TransactionTag> | null = null;
    let pictureInfoMap: Map<bigint, TransactionPictureInfo[]> | null = null;

    if (!trimCategory) {
        const allCategories = await logOnError(c, () => TransactionCategories.getAllCategoriesByUid(c, uid, 0, -1n), () => `${prefix} failed to get all transactions categories for user "uid:${uid}"`);
        categoryMap = TransactionCategories.getCategoryMapByList(allCategories);
    }

    if (!trimTag) {
        const allTags = await logOnError(c, () => TransactionTags.getAllTagsByUid(c, uid), () => `${prefix} failed to get all transactions tags for user "uid:${uid}"`);
        tagMap = TransactionTags.getTagMapByList(allTags);
    }

    if (withPictures && currentConfig().enableTransactionPictures) {
        pictureInfoMap = await logOnError(c, () => TransactionPictures.getAllPictureInfosOfAllTransactions(c, uid), () => `${prefix} failed to get all transactions pictures for user "uid:${uid}"`);
    }

    return { accountMap, categoryMap, tagMap, allTransactionTagIds, pictureInfoMap };
}

// getTransactionEssentialDataByTransactionIds returns the accounts, categories, tags and pictures of specified transactions
export async function getTransactionEssentialDataByTransactionIds(c: WebContext, user: User, transactions: Transaction[], withPictures: boolean, trimCategory: boolean, trimTag: boolean): Promise<TransactionEssentialData> {
    const uid = user.uid;
    const prefix = `[${P}.getTransactionEssentialDataByTransactionIds]`;
    const transactionIds: bigint[] = [];
    const accountIds: bigint[] = [];
    const categoryIds: bigint[] = [];

    for (const transaction of transactions) {
        transactionIds.push(transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN ? transaction.relatedId : transaction.transactionId);
        accountIds.push(transaction.accountId);

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            accountIds.push(transaction.relatedAccountId);
        }

        categoryIds.push(transaction.categoryId);
    }

    const accountMap = await logOnError(c, () => Accounts.getAccountsByAccountIds(c, uid, toUniqueInt64Slice(accountIds)), () => `${prefix} failed to get accounts for user "uid:${uid}"`);
    const allTransactionTagIds = await logOnError(c, () => TransactionTags.getAllTagIdsOfTransactions(c, uid, transactionIds), () => `${prefix} failed to get transactions tag ids for user "uid:${uid}"`);
    let categoryMap: Map<bigint, TransactionCategory> | null = null;
    let tagMap: Map<bigint, TransactionTag> | null = null;
    let pictureInfoMap: Map<bigint, TransactionPictureInfo[]> | null = null;

    if (!trimCategory) {
        categoryMap = await logOnError(c, () => TransactionCategories.getCategoriesByCategoryIds(c, uid, toUniqueInt64Slice(categoryIds)), () => `${prefix} failed to get transactions categories for user "uid:${uid}"`);
    }

    if (!trimTag) {
        tagMap = await logOnError(c, () => TransactionTags.getTagsByTagIds(c, uid, toUniqueInt64Slice(TransactionTags.getTransactionTagIds(allTransactionTagIds))), () => `${prefix} failed to get transactions tags for user "uid:${uid}"`);
    }

    if (withPictures && currentConfig().enableTransactionPictures) {
        pictureInfoMap = await logOnError(c, () => TransactionPictures.getPictureInfosByTransactionIds(c, uid, toUniqueInt64Slice(Transactions.getTransactionIds(transactions))), () => `${prefix} failed to get transactions pictures for user "uid:${uid}"`);
    }

    return { accountMap, categoryMap, tagMap, allTransactionTagIds, pictureInfoMap };
}

async function logOnError<T>(c: WebContext, fn: () => Promise<T>, logMessage: () => string): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        log.errorf(c, `${logMessage()}, because ${errMsg(err)}`);
        throw err;
    }
}

async function getTransactionUsedAccounts(c: WebContext, uid: bigint, transactions: Transaction[]): Promise<AccountMap> {
    const accountIds: bigint[] = [];

    for (const transaction of transactions) {
        accountIds.push(transaction.accountId);

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            accountIds.push(transaction.relatedAccountId);
        }
    }

    let accountMap: AccountMap;

    try {
        accountMap = await Accounts.getAccountsByAccountIds(c, uid, toUniqueInt64Slice(accountIds));
    } catch (err) {
        log.errorf(c, `[${P}.getTransactionUsedAccounts] failed to get accounts for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    for (const transaction of transactions) {
        if (!accountMap.has(transaction.accountId)) {
            log.warnf(c, `[${P}.getTransactionUsedAccounts] account of transaction "id:${transaction.transactionId}" does not exist for user "uid:${uid}"`);
            throw errs.ErrSourceAccountNotFound;
        }

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            if (!accountMap.has(transaction.relatedAccountId)) {
                log.warnf(c, `[${P}.getTransactionUsedAccounts] related account of transaction "id:${transaction.transactionId}" does not exist for user "uid:${uid}"`);
                throw errs.ErrDestinationAccountNotFound;
            }
        }
    }

    return accountMap;
}

export async function getTransactionUsedAccountsOrFail(c: WebContext, uid: bigint, transactions: Transaction[], handler: string): Promise<AccountMap> {
    return callOrFail(c, () => getTransactionUsedAccounts(c, uid, transactions), () => `[${P}.${handler}] failed to get transaction used accounts for user "uid:${uid}"`);
}

function toTransactionInfoResponseOrFail(transaction: Transaction, tagIds: bigint[], editable: boolean): TransactionInfoResponse {
    const resp = toTransactionInfoResponse(transaction, tagIds, editable);

    if (!resp) {
        throw errs.ErrOperationFailed;
    }

    return resp;
}

// rebuild reorders the response fields to the same order as the go struct
function rebuild(resp: TransactionInfoResponse): TransactionInfoResponse {
    return buildTransactionInfoResponse(resp);
}

// getTransactionResponseListResult returns the sorted transaction response list
export function getTransactionResponseListResult(user: User, transactions: Transaction[], data: TransactionEssentialData, clientTimezone: Timezone, withPictures: boolean, trimAccount: boolean, trimCategory: boolean, trimTag: boolean): TransactionInfoResponse[] {
    const result: TransactionInfoResponse[] = [];

    for (let transaction of transactions) {
        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
            transaction = Transactions.getRelatedTransferTransaction(transaction) as Transaction;
        }

        const sourceAccount = data.accountMap.get(transaction.accountId) ?? null;
        const destinationAccount = data.accountMap.get(transaction.relatedAccountId) ?? null;
        const transactionEditable = isTransactionEditable(transaction, user, clientTimezone, sourceAccount, destinationAccount);
        const transactionTagIds = data.allTransactionTagIds.get(transaction.transactionId);
        const resp = toTransactionInfoResponseOrFail(transaction, transactionTagIds ?? [], transactionEditable);

        if (!trimAccount) {
            if (sourceAccount) {
                resp.sourceAccount = toAccountInfoResponse(sourceAccount);
            }

            if (destinationAccount) {
                resp.destinationAccount = toAccountInfoResponse(destinationAccount);
            }
        }

        if (!trimCategory && data.categoryMap) {
            const category = data.categoryMap.get(transaction.categoryId);

            if (category) {
                resp.category = toTransactionCategoryInfoResponse(category);
            }
        }

        if (!trimTag && data.tagMap && transactionTagIds) {
            resp.tags = getTransactionTagInfoResponses(transactionTagIds, data.tagMap);
        }

        if (withPictures && currentConfig().enableTransactionPictures && data.pictureInfoMap) {
            const pictureInfos = data.pictureInfoMap.get(transaction.transactionId);

            if (pictureInfos) {
                resp.pictures = getTransactionPictureInfoResponseList(pictureInfos);
            }
        }

        result.push(rebuild(resp));
    }

    return sortTransactionInfoResponses(result);
}

// createNewTransactionModel creates a new transaction model by request
export function createNewTransactionModel(uid: bigint, req: TransactionCreateRequest, clientIp: string): Transaction {
    let transactionDbType: TransactionDbType = 0;

    try {
        transactionDbType = transactionTypeToTransactionDbType(req.type);
    } catch {
        transactionDbType = 0;
    }

    const transaction = newTransaction({
        uid: uid,
        type: transactionDbType,
        categoryId: req.categoryId,
        transactionTime: getMinTransactionTimeFromUnixTime(req.time),
        timezoneUtcOffset: req.utcOffset,
        accountId: req.sourceAccountId,
        amount: req.sourceAmount,
        hideAmount: req.hideAmount,
        comment: req.comment,
        createdIp: clientIp,
    });

    if (transactionDbType === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        transaction.relatedAccountId = req.destinationAccountId;
        transaction.relatedAccountAmount = req.destinationAmount;
    }

    if (req.geoLocation) {
        transaction.geoLongitude = req.geoLocation.longitude;
        transaction.geoLatitude = req.geoLocation.latitude;
    }

    return transaction;
}
