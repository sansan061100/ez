import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_CLEAR_ALL_DATA, USER_FEATURE_RESTRICTION_TYPE_EXPORT_TRANSACTION } from '../core/feature_restriction';
import { getTransactionDataExporter } from '../converters/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS, type ClearAccountTransactionsRequest, type ClearDataRequest, type ExportTransactionDataRequest, type User } from '../models/index';
import { Accounts } from '../services/accounts';
import { nowUnix } from '../services/base';
import { InsightsExplorers } from '../services/explorer';
import { TransactionCategories } from '../services/transaction_categories';
import { TransactionPictures } from '../services/transaction_pictures';
import { TransactionTagGroups } from '../services/transaction_tag_groups';
import { TransactionTags } from '../services/transaction_tags';
import { TransactionTemplates } from '../services/transaction_templates';
import { type TransactionQueryFilter, Transactions } from '../services/transactions';
import { UserCustomExchangeRates } from '../services/user_custom_exchange_rates';
import { UserCustomIcons } from '../services/user_custom_icons';
import { Users } from '../services/users';
import { formatUnixTimeToLongDateTimeWithoutSecond, getMaxTransactionTimeFromUnixTime, getMinTransactionTimeFromUnixTime, loadLocation, parseTransactionTagFilterSafe, type Timezone } from './data_managements_helpers';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery, currentConfig, errMsg } from './base';
import { callOrFail, getCurrentUserWarnWithUid, requireNormalToken } from './common';
import { ClearAccountTransactionsRequestSchema, ClearDataRequestSchema, ExportTransactionDataRequestSchema } from './schemas';

const P = 'data_managements';
const pageCountForClearTransactions = 1000;
const pageCountForDataExport = 1000;

// exportDataToEzbookkeepingCSVHandler returns exported data in csv format
export async function exportDataToEzbookkeepingCSVHandler(c: WebContext): Promise<[Buffer, string]> {
    return getExportedFileContent(c, 'csv');
}

// exportDataToEzbookkeepingTSVHandler returns exported data in tsv format
export async function exportDataToEzbookkeepingTSVHandler(c: WebContext): Promise<[Buffer, string]> {
    return getExportedFileContent(c, 'tsv');
}

async function countOrFail(c: WebContext, fn: () => Promise<number>, name: string, uid: bigint): Promise<string> {
    try {
        return (await fn()).toString();
    } catch (err) {
        log.errorf(c, `[${P}.DataStatisticsHandler] failed to get total ${name} count for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.ErrOperationFailed;
    }
}

// dataStatisticsHandler returns user data statistics
export async function dataStatisticsHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();

    return {
        totalAccountCount: await countOrFail(c, () => Accounts.getTotalAccountCountByUid(c, uid), 'account', uid),
        totalTransactionCategoryCount: await countOrFail(c, () => TransactionCategories.getTotalCategoryCountByUid(c, uid), 'transaction category', uid),
        totalTransactionTagCount: await countOrFail(c, () => TransactionTags.getTotalTagCountByUid(c, uid), 'transaction tag', uid),
        totalTransactionCount: await countOrFail(c, () => Transactions.getTotalTransactionCountByUid(c, uid), 'transaction', uid),
        totalTransactionPictureCount: await countOrFail(c, () => TransactionPictures.getTotalTransactionPicturesCountByUid(c, uid), 'transaction picture', uid),
        totalExplorationCount: await countOrFail(c, () => InsightsExplorers.getTotalExplorationsCountByUid(c, uid), 'exploration', uid),
        totalTransactionTemplateCount: await countOrFail(c, () => TransactionTemplates.getTotalNormalTemplateCountByUid(c, uid), 'transaction template', uid),
        totalScheduledTransactionCount: await countOrFail(c, () => TransactionTemplates.getTotalScheduledTemplateCountByUid(c, uid), 'scheduled transaction', uid),
        totalCustomIconCount: await countOrFail(c, () => UserCustomIcons.getTotalCustomIconsCountByUid(c, uid), 'custom icon', uid),
    };
}

async function checkClearDataPermission(c: WebContext, handler: string, action: string, password: string): Promise<User> {
    requireNormalToken(c, `${P}.${handler}`, action);
    const user = await getCurrentUserWarnWithUid(c, `${P}.${handler}`);

    if (!Users.isPasswordEqualsUserPassword(password, user)) {
        throw errs.ErrUserPasswordWrong;
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_CLEAR_ALL_DATA)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    return user;
}

// clearAllDataHandler deletes all user data
export async function clearAllDataHandler(c: WebContext): Promise<unknown> {
    const handler = 'ClearAllDataHandler';
    const req = await bindJson<ClearDataRequest>(c, ClearDataRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    await checkClearDataPermission(c, handler, 'clear all user data', req.password);

    await callOrFail(c, () => TransactionTemplates.deleteAllTemplates(c, uid), () => `[${P}.${handler}] failed to delete all transaction templates`);
    await callOrFail(c, () => Transactions.deleteAllTransactions(c, uid, true), () => `[${P}.${handler}] failed to delete all transactions`);
    await callOrFail(c, () => TransactionCategories.deleteAllCategories(c, uid), () => `[${P}.${handler}] failed to delete all transaction categories`);
    await callOrFail(c, () => TransactionTags.deleteAllTags(c, uid), () => `[${P}.${handler}] failed to delete all transaction tags`);
    await callOrFail(c, () => TransactionTagGroups.deleteAllTagGroups(c, uid), () => `[${P}.${handler}] failed to delete all transaction tag groups`);
    await callOrFail(c, () => UserCustomIcons.deleteAllCustomIcons(c, uid), () => `[${P}.${handler}] failed to delete all user custom icons`);
    await callOrFail(c, () => UserCustomExchangeRates.deleteAllCustomExchangeRates(c, uid), () => `[${P}.${handler}] failed to delete all user custom exchange rates`);
    await callOrFail(c, () => InsightsExplorers.deleteAllExplorations(c, uid), () => `[${P}.${handler}] failed to delete all explorations`);

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has cleared all data`);
    return true;
}

// clearAllTransactionsHandler deletes all user transactions
export async function clearAllTransactionsHandler(c: WebContext): Promise<unknown> {
    const handler = 'ClearAllTransactionsHandler';
    const req = await bindJson<ClearDataRequest>(c, ClearDataRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    await checkClearDataPermission(c, handler, 'clear all transactions', req.password);

    await callOrFail(c, () => Transactions.deleteAllTransactions(c, uid, false), () => `[${P}.${handler}] failed to delete all transactions`);

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has cleared all transactions`);
    return true;
}

// clearAllTransactionsByAccountHandler deletes all transactions of specified account
export async function clearAllTransactionsByAccountHandler(c: WebContext): Promise<unknown> {
    const handler = 'ClearAllTransactionsByAccountHandler';
    const req = await bindJson<ClearAccountTransactionsRequest>(c, ClearAccountTransactionsRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    await checkClearDataPermission(c, handler, 'clear all transactions of account', req.password);

    const account = await callOrFail(c, () => Accounts.getAccountByAccountId(c, uid, req.accountId), () => `[${P}.${handler}] failed to get account "id:${uid}" for user "uid:${req.accountId}"`);

    if (account.hidden) {
        throw errs.ErrCannotDeleteTransactionInHiddenAccount;
    }

    if (account.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
        throw errs.ErrCannotDeleteTransactionInParentAccount;
    }

    await callOrFail(c, () => Transactions.deleteAllTransactionsOfAccount(c, uid, account.accountId, pageCountForClearTransactions), () => `[${P}.${handler}] failed to delete all transactions in account "id:${account.accountId}"`);

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has cleared all transactions in account "id:${account.accountId}"`);
    return true;
}

async function getExportedFileContent(c: WebContext, fileType: string): Promise<[Buffer, string]> {
    const prefix = `${P}.getExportedFileContent`;

    if (!currentConfig().enableDataExport) {
        throw errs.ErrDataExportNotAllowed;
    }

    const req = bindQuery<ExportTransactionDataRequest>(c, ExportTransactionDataRequestSchema, prefix);
    let clientTimezone: Timezone;

    try {
        clientTimezone = c.getClientTimezone();
    } catch (err) {
        log.warnf(c, `[${prefix}] cannot get client timezone, because ${errMsg(err)}`);
        clientTimezone = loadLocation('Local') as Timezone;
    }

    const uid = c.getCurrentUid();
    const user = await getCurrentUserWarnWithUid(c, prefix);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_EXPORT_TRANSACTION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    const loadOrFail = async <T>(fn: () => Promise<T>, message: string): Promise<T> => {
        try {
            return await fn();
        } catch (err) {
            log.errorf(c, `[${prefix}] ${message} for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.ErrOperationFailed;
        }
    };

    const accounts = await loadOrFail(() => Accounts.getAllAccountsByUid(c, uid), 'failed to get all accounts');
    const categories = await loadOrFail(() => TransactionCategories.getAllCategoriesByUid(c, uid, 0, -1n), 'failed to get categories');
    const tags = await loadOrFail(() => TransactionTags.getAllTagsByUid(c, uid), 'failed to get tags');
    const tagIndexes = await loadOrFail(() => TransactionTags.getAllTagIdsMapOfAllTransactions(c, uid), 'failed to get tag index');

    const accountMap = Accounts.getAccountMapByList(accounts);
    const categoryMap = TransactionCategories.getCategoryMapByList(categories);
    const tagMap = TransactionTags.getTagMapByList(tags);

    let allAccountIds: bigint[] | null;
    let allCategoryIds: bigint[] | null;

    try {
        allAccountIds = await Accounts.getAccountOrSubAccountIds(c, req.accountIds, uid);
    } catch (err) {
        log.warnf(c, `[${prefix}] get account error, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    try {
        allCategoryIds = await TransactionCategories.getCategoryOrSubCategoryIds(c, req.categoryIds, uid);
    } catch (err) {
        log.warnf(c, `[${prefix}] get transaction category error, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const [tagFilters, noTags] = parseTransactionTagFilterSafe(c, req.tagFilter, prefix);

    let maxTransactionTime = Number.MAX_SAFE_INTEGER;
    let minTransactionTime = 0;

    if (req.maxTime > 0) {
        maxTransactionTime = getMaxTransactionTimeFromUnixTime(req.maxTime);
    }

    if (req.minTime > 0) {
        minTransactionTime = getMinTransactionTimeFromUnixTime(req.minTime);
    }

    const filter: TransactionQueryFilter = {
        transactionType: req.type,
        categoryIds: allCategoryIds,
        accountIds: allAccountIds,
        tagFilters: tagFilters,
        noTags: noTags,
        amountFilter: req.amountFilter,
        keyword: req.keyword,
        matchMode: req.matchMode,
        mustHavePictures: false,
    };

    let allTransactions;

    try {
        allTransactions = await Transactions.getAllSpecifiedTransactions(c, uid, maxTransactionTime, minTransactionTime, filter, pageCountForDataExport, true);
    } catch (err) {
        log.errorf(c, `[${prefix}] failed to all transactions user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.ErrOperationFailed;
    }

    const dataExporter = getTransactionDataExporter(fileType);

    if (!dataExporter) {
        throw errs.ErrNotImplemented;
    }

    let result: Buffer;

    try {
        result = await dataExporter.toExportedContent(c, uid, allTransactions, accountMap, categoryMap, tagMap, tagIndexes);
    } catch (err) {
        log.errorf(c, `[${prefix}] failed to get exported data for "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return [result, getFileName(user, clientTimezone, fileType)];
}

function getFileName(user: User, clientTimezone: Timezone, fileExtension: string): string {
    const currentTime = formatUnixTimeToLongDateTimeWithoutSecond(nowUnix(), clientTimezone).replace(/[- :]/g, '_');
    return `${user.username}_${currentTime}.${fileExtension}`;
}
