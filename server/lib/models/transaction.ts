import type { DateTime } from 'luxon';

import { defineTable } from '../datastore/schema';
import * as errs from '../errs/index';
import { stringToInt, stringToInt64, stringToInt64Number } from '../utils/converter';
import { getUnixTimeFromTransactionTime, parseNumericYearMonth, type Timezone } from '../utils/datetimes';
import type { Account, AccountInfoResponse } from './account';
import type { TransactionCategoryInfoResponse } from './transaction_category';
import type { TransactionPictureInfoBasicResponse } from './transaction_picture_info';
import type { TransactionTagInfoResponse } from './transaction_tag';
import { canEditTransactionByTransactionTime, type User } from './user';

export const MinimumTransactionAmount = -999999999999999;
export const MaximumTransactionAmount = 999999999999999;

export const MaximumTagsCountOfTransaction = 10;
export const MaximumPicturesCountOfTransaction = 10;

export type TransactionType = number;

export const TRANSACTION_TYPE_MODIFY_BALANCE = 1;
export const TRANSACTION_TYPE_INCOME = 2;
export const TRANSACTION_TYPE_EXPENSE = 3;
export const TRANSACTION_TYPE_TRANSFER = 4;

export type TransactionRelatedAccountType = number;

export const TRANSACTION_RELATED_ACCOUNT_TYPE_TRANSFER_FROM = 1;
export const TRANSACTION_RELATED_ACCOUNT_TYPE_TRANSFER_TO = 2;

export type TransactionDbType = number;

export const TRANSACTION_DB_TYPE_MODIFY_BALANCE = 1;
export const TRANSACTION_DB_TYPE_INCOME = 2;
export const TRANSACTION_DB_TYPE_EXPENSE = 3;
export const TRANSACTION_DB_TYPE_TRANSFER_OUT = 4;
export const TRANSACTION_DB_TYPE_TRANSFER_IN = 5;

export function transactionTypeToTransactionDbType(t: TransactionType): TransactionDbType {
    if (t === TRANSACTION_TYPE_MODIFY_BALANCE) {
        return TRANSACTION_DB_TYPE_MODIFY_BALANCE;
    } else if (t === TRANSACTION_TYPE_EXPENSE) {
        return TRANSACTION_DB_TYPE_EXPENSE;
    } else if (t === TRANSACTION_TYPE_INCOME) {
        return TRANSACTION_DB_TYPE_INCOME;
    } else if (t === TRANSACTION_TYPE_TRANSFER) {
        return TRANSACTION_DB_TYPE_TRANSFER_OUT;
    }

    throw errs.ErrTransactionTypeInvalid;
}

export function transactionDbTypeName(t: TransactionDbType): string {
    switch (t) {
        case TRANSACTION_DB_TYPE_MODIFY_BALANCE:
            return 'Modify Balance';
        case TRANSACTION_DB_TYPE_INCOME:
            return 'Income';
        case TRANSACTION_DB_TYPE_EXPENSE:
            return 'Expense';
        case TRANSACTION_DB_TYPE_TRANSFER_OUT:
            return 'Transfer Out';
        case TRANSACTION_DB_TYPE_TRANSFER_IN:
            return 'Transfer In';
        default:
            return `Invalid(${t})`;
    }
}

export function transactionDbTypeToTransactionType(t: TransactionDbType): TransactionType {
    if (t === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
        return TRANSACTION_TYPE_MODIFY_BALANCE;
    } else if (t === TRANSACTION_DB_TYPE_EXPENSE) {
        return TRANSACTION_TYPE_EXPENSE;
    } else if (t === TRANSACTION_DB_TYPE_INCOME) {
        return TRANSACTION_TYPE_INCOME;
    } else if (t === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        return TRANSACTION_TYPE_TRANSFER;
    } else if (t === TRANSACTION_DB_TYPE_TRANSFER_IN) {
        return TRANSACTION_TYPE_TRANSFER;
    }

    throw errs.ErrTransactionTypeInvalid;
}

export function transactionDbTypeToRelatedAccountType(t: TransactionDbType): TransactionRelatedAccountType {
    if (t === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        return TRANSACTION_RELATED_ACCOUNT_TYPE_TRANSFER_TO;
    } else if (t === TRANSACTION_DB_TYPE_TRANSFER_IN) {
        return TRANSACTION_RELATED_ACCOUNT_TYPE_TRANSFER_FROM;
    }

    throw errs.ErrTransactionTypeInvalid;
}

export const TransactionNoTagFilterValue = 'none';

export type TransactionTagFilterType = number;

export const TRANSACTION_TAG_FILTER_HAS_ANY = 0;
export const TRANSACTION_TAG_FILTER_HAS_ALL = 1;
export const TRANSACTION_TAG_FILTER_NOT_HAS_ANY = 2;
export const TRANSACTION_TAG_FILTER_NOT_HAS_ALL = 3;

// Transaction represents transaction data stored in database
export interface Transaction {
    transactionId: bigint;
    uid: bigint;
    deleted: boolean;
    type: TransactionDbType;
    categoryId: bigint;
    accountId: bigint;
    transactionTime: number;
    timezoneUtcOffset: number;
    amount: number;
    relatedId: bigint;
    relatedAccountId: bigint;
    relatedAccountAmount: number;
    hideAmount: boolean;
    comment: string;
    geoLongitude: number;
    geoLatitude: number;
    createdIp: string;
    scheduledCreated: boolean;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const uqeUidTime = 'UQE_transaction_uid_time';
const idxUidDeletedTime = 'IDX_transaction_uid_deleted_time';
const idxUidDeletedTypeTime = 'IDX_transaction_uid_deleted_type_time';
const idxUidDeletedTypeAccountIdTime = 'IDX_transaction_uid_deleted_type_account_id_time';
const idxUidDeletedCategoryIdTime = 'IDX_transaction_uid_deleted_category_id_time';
const idxUidDeletedAccountIdTime = 'IDX_transaction_uid_deleted_account_id_time';
const idxUidDeletedTimeLongitudeLatitude = 'IDX_transaction_uid_deleted_time_longitude_latitude';

export const TransactionTable = defineTable<Transaction>('transaction', [
    ['transaction_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, unique: [uqeUidTime], index: [idxUidDeletedTime, idxUidDeletedTypeTime, idxUidDeletedTypeAccountIdTime, idxUidDeletedCategoryIdTime, idxUidDeletedAccountIdTime, idxUidDeletedTimeLongitudeLatitude] }],
    ['deleted', 'bool', { notNull: true, index: [idxUidDeletedTime, idxUidDeletedTypeTime, idxUidDeletedTypeAccountIdTime, idxUidDeletedCategoryIdTime, idxUidDeletedAccountIdTime, idxUidDeletedTimeLongitudeLatitude] }],
    ['type', 'u8', { notNull: true, index: [idxUidDeletedTypeTime, idxUidDeletedTypeAccountIdTime] }],
    ['category_id', 'id', { notNull: true, index: [idxUidDeletedCategoryIdTime] }],
    ['account_id', 'id', { notNull: true, index: [idxUidDeletedAccountIdTime, idxUidDeletedTypeAccountIdTime] }],
    ['transaction_time', 'i64', { notNull: true, unique: [uqeUidTime], index: [idxUidDeletedTime, idxUidDeletedTypeTime, idxUidDeletedTypeAccountIdTime, idxUidDeletedCategoryIdTime, idxUidDeletedAccountIdTime] }],
    ['timezone_utc_offset', 'i16', { notNull: true }],
    ['amount', 'i64', { notNull: true }],
    ['related_id', 'id', { notNull: true }],
    ['related_account_id', 'id', { notNull: true }],
    ['related_account_amount', 'i64', { notNull: true }],
    ['hide_amount', 'bool', { notNull: true }],
    ['comment', 'str', { length: 255, notNull: true }],
    ['geo_longitude', 'f64', { index: [idxUidDeletedTimeLongitudeLatitude] }],
    ['geo_latitude', 'f64', { index: [idxUidDeletedTimeLongitudeLatitude] }],
    ['created_ip', 'str', { length: 39 }],
    ['scheduled_created', 'bool'],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newTransaction(values: Partial<Transaction> = {}): Transaction {
    return {
        transactionId: 0n,
        uid: 0n,
        deleted: false,
        type: 0,
        categoryId: 0n,
        accountId: 0n,
        transactionTime: 0,
        timezoneUtcOffset: 0,
        amount: 0,
        relatedId: 0n,
        relatedAccountId: 0n,
        relatedAccountAmount: 0,
        hideAmount: false,
        comment: '',
        geoLongitude: 0,
        geoLatitude: 0,
        createdIp: '',
        scheduledCreated: false,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}

// TransactionWithAccountBalance represents a transaction with account opening and closing balance
export interface TransactionWithAccountBalance {
    transaction: Transaction;
    accountOpeningBalance: bigint;
    accountClosingBalance: bigint;
}

export interface TransactionGeoLocationRequest {
    latitude: number;
    longitude: number;
}

export interface TransactionCreateRequest {
    type: TransactionType;
    categoryId: bigint;
    time: number;
    utcOffset: number;
    sourceAccountId: bigint;
    destinationAccountId: bigint;
    sourceAmount: number;
    destinationAmount: number;
    hideAmount: boolean;
    tagIds: string[] | null;
    pictureIds: string[] | null;
    comment: string;
    geoLocation: TransactionGeoLocationRequest | null;
    clientSessionId: string;
}

export interface TransactionModifyRequest {
    id: bigint;
    type: TransactionType;
    categoryId: bigint;
    time: number;
    utcOffset: number;
    sourceAccountId: bigint;
    destinationAccountId: bigint;
    sourceAmount: number;
    destinationAmount: number;
    hideAmount: boolean;
    tagIds: string[] | null;
    pictureIds: string[] | null;
    comment: string;
    geoLocation: TransactionGeoLocationRequest | null;
}

export interface TransactionImportRequest {
    transactions: TransactionCreateRequest[] | null;
    clientSessionId: string;
}

export interface TransactionImportProcessRequest {
    clientSessionId: string;
}

export interface TransactionTagFilter {
    tagIds: bigint[];
    type: TransactionTagFilterType;
}

export interface TransactionQueryFilterRequest {
    type: TransactionType;
    categoryIds: string;
    accountIds: string;
    tagFilter: string;
    amountFilter: string;
    keyword: string;
    matchMode: number;
}

export interface TransactionCountRequest extends TransactionQueryFilterRequest {
    mustHavePictures: boolean;
    maxTime: number;
    minTime: number;
}

export interface TransactionListByMaxTimeRequest extends TransactionQueryFilterRequest {
    mustHavePictures: boolean;
    maxTime: number;
    minTime: number;
    page: number;
    count: number;
    withCount: boolean;
    withPictures: boolean;
    trimAccount: boolean;
    trimCategory: boolean;
    trimTag: boolean;
}

export interface TransactionListInMonthByPageRequest extends TransactionQueryFilterRequest {
    year: number;
    month: number;
    mustHavePictures: boolean;
    withPictures: boolean;
    trimAccount: boolean;
    trimCategory: boolean;
    trimTag: boolean;
}

export interface TransactionAllListRequest extends TransactionQueryFilterRequest {
    mustHavePictures: boolean;
    startTime: number;
    endTime: number;
    withPictures: boolean;
    trimAccount: boolean;
    trimCategory: boolean;
    trimTag: boolean;
}

export interface TransactionReconciliationStatementRequest {
    accountId: bigint;
    startTime: number;
    endTime: number;
}

export interface TransactionStatisticRequest {
    startTime: number;
    endTime: number;
    tagFilter: string;
    keyword: string;
    matchMode: number;
    useTransactionTimezone: boolean;
}

export interface YearMonthRangeRequest {
    startYearMonth: string;
    endYearMonth: string;
}

export interface TransactionStatisticTrendsRequest extends YearMonthRangeRequest {
    tagFilter: string;
    keyword: string;
    matchMode: number;
    useTransactionTimezone: boolean;
}

export interface TransactionStatisticAssetTrendsRequest {
    startTime: number;
    endTime: number;
}

export interface TransactionAmountsRequest {
    query: string;
    excludeAccountIds: string;
    excludeCategoryIds: string;
    useTransactionTimezone: boolean;
}

export interface TransactionDailyAmountsRequest {
    startTime: number;
    endTime: number;
    excludeAccountIds: string;
    excludeCategoryIds: string;
    useTransactionTimezone: boolean;
}

export interface TransactionAmountsRequestItem {
    name: string;
    startTime: number;
    endTime: number;
}

export interface TransactionGetRequest {
    id: bigint;
    withPictures: boolean;
    trimAccount: boolean;
    trimCategory: boolean;
    trimTag: boolean;
}

export interface TransactionBatchUpdateCategoryRequest {
    transactionIds: string[];
    categoryId: bigint;
}

export interface TransactionBatchUpdateAccountRequest {
    transactionIds: string[];
    accountId: bigint;
    isDestinationAccount: boolean;
}

export interface TransactionBatchAddTagsRequest {
    transactionIds: string[];
    tagIds: string[];
}

export interface TransactionBatchRemoveTagsRequest {
    transactionIds: string[];
    tagIds: string[];
}

export interface TransactionBatchClearTagsRequest {
    transactionIds: string[];
}

export interface TransactionMoveBetweenAccountsRequest {
    fromAccountId: bigint;
    toAccountId: bigint;
}

export interface TransactionDeleteRequest {
    id: bigint;
}

export interface TransactionBatchDeleteRequest {
    ids: string[];
    password: string;
}

export interface TransactionGeoLocationResponse {
    latitude: number;
    longitude: number;
}

// TransactionInfoResponse represents a view-object of transaction
export interface TransactionInfoResponse {
    id: bigint;
    timeSequenceId: bigint;
    type: TransactionType;
    categoryId: bigint;
    category?: TransactionCategoryInfoResponse;
    time: number;
    utcOffset: number;
    sourceAccountId: bigint;
    sourceAccount?: AccountInfoResponse;
    destinationAccountId?: bigint;
    destinationAccount?: AccountInfoResponse;
    sourceAmount: number;
    destinationAmount?: number;
    hideAmount: boolean;
    tagIds: string[];
    tags?: TransactionTagInfoResponse[];
    pictures?: TransactionPictureInfoBasicResponse[];
    comment: string;
    geoLocation?: TransactionGeoLocationResponse;
    editable: boolean;
}

export interface TransactionCountResponse {
    totalCount: number;
}

export interface TransactionInfoPageWrapperResponse {
    items: TransactionInfoResponse[];
    nextTimeSequenceId: bigint | null;
    totalCount?: number;
}

export interface TransactionInfoPageWrapperResponse2 {
    items: TransactionInfoResponse[];
    totalCount: number;
}

export type TransactionReconciliationStatementResponseItem = TransactionInfoResponse & {
    accountOpeningBalance: string;
    accountClosingBalance: string;
};

export interface TransactionReconciliationStatementResponse {
    transactions: TransactionReconciliationStatementResponseItem[];
    totalInflows: string;
    totalOutflows: string;
    openingBalance: string;
    closingBalance: string;
}

export interface TransactionStatisticResponseItem {
    categoryId: bigint;
    accountId: bigint;
    relatedAccountId?: bigint;
    relatedAccountType?: TransactionRelatedAccountType;
    amount: string;
}

export interface TransactionStatisticResponse {
    startTime: number;
    endTime: number;
    items: TransactionStatisticResponseItem[];
}

export interface TransactionStatisticTrendsResponseItem {
    year: number;
    month: number;
    items: TransactionStatisticResponseItem[];
}

export interface TransactionStatisticAssetTrendsResponseDataItem {
    accountId: bigint;
    accountOpeningBalance: string;
    accountClosingBalance: string;
}

export interface TransactionStatisticAssetTrendsResponseItem {
    year: number;
    month: number;
    day: number;
    items: TransactionStatisticAssetTrendsResponseDataItem[];
}

export interface TransactionAmountsResponseItemAmountInfo {
    currency: string;
    incomeAmount: string;
    expenseAmount: string;
}

export interface TransactionAmountsResponseItem {
    startTime: number;
    endTime: number;
    amounts: TransactionAmountsResponseItemAmountInfo[];
}

export interface TransactionDailyAmountsResponseItem {
    date: string;
    amounts: TransactionAmountsResponseItemAmountInfo[];
}

export interface TransactionMonthAmountsResponseItem {
    year: number;
    month: number;
    amounts: TransactionAmountsResponseItemAmountInfo[];
}

// TransactionTotalAmount represents total amount for specific transaction type, category and account
export interface TransactionTotalAmount {
    type: TransactionDbType;
    categoryId: bigint;
    accountId: bigint;
    relatedAccountId: bigint;
    amount: bigint;
}

export interface TransactionAmountsAndCurrency {
    currency: string;
    incomeAmount: bigint;
    expenseAmount: bigint;
}

// parseTransactionTagFilter parses tag filter text (e.g. "0:1,2;1:3")
export function parseTransactionTagFilter(tagFilterStr: string): TransactionTagFilter[] {
    if (tagFilterStr === '' || tagFilterStr === TransactionNoTagFilterValue) {
        return [];
    }

    const filters = tagFilterStr.split(';');
    const transactionTagFilters: TransactionTagFilter[] = [];

    for (const filter of filters) {
        const tagFilterItem = filter.split(':');

        if (tagFilterItem.length !== 2) {
            throw errs.ErrFormatInvalid;
        }

        let tagFilterType: number;

        try {
            tagFilterType = stringToInt(tagFilterItem[0]!);
        } catch {
            throw errs.ErrFormatInvalid;
        }

        if (tagFilterType < TRANSACTION_TAG_FILTER_HAS_ANY || tagFilterType > TRANSACTION_TAG_FILTER_NOT_HAS_ALL) {
            throw errs.ErrFormatInvalid;
        }

        const tagIds: bigint[] = [];

        for (const tagIdStr of tagFilterItem[1]!.split(',')) {
            try {
                tagIds.push(stringToInt64(tagIdStr));
            } catch {
                throw errs.ErrTransactionTagIdInvalid;
            }
        }

        transactionTagFilters.push({ tagIds: tagIds, type: tagFilterType });
    }

    return transactionTagFilters;
}

export function isTransactionEditable(t: Transaction, currentUser: User | null, clientTimezone: Timezone, account: Account | null, relatedAccount: Account | null): boolean {
    if (!account || account.hidden) {
        return false;
    }

    if (t.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        if (!relatedAccount || relatedAccount.hidden) {
            return false;
        }
    }

    if (!currentUser || !canEditTransactionByTransactionTime(currentUser, t.transactionTime, clientTimezone, account, relatedAccount)) {
        return false;
    }

    return true;
}

// toTransactionInfoResponse returns a view-object according to database model
export function toTransactionInfoResponse(t: Transaction, tagIds: bigint[], editable: boolean): TransactionInfoResponse | null {
    let transactionType: TransactionType;

    try {
        transactionType = transactionDbTypeToTransactionType(t.type);
    } catch {
        return null;
    }

    let sourceAccountId = t.accountId;
    let sourceAmount = t.amount;
    let destinationAccountId = 0n;
    let destinationAmount: number | undefined;

    if (t.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        destinationAccountId = t.relatedAccountId;
        destinationAmount = t.relatedAccountAmount;
    } else if (t.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
        sourceAccountId = t.relatedAccountId;
        sourceAmount = t.relatedAccountAmount;
        destinationAccountId = t.accountId;
        destinationAmount = t.amount;
    }

    let geoLocation: TransactionGeoLocationResponse | undefined;

    if (t.geoLongitude !== 0 || t.geoLatitude !== 0) {
        geoLocation = {
            latitude: t.geoLatitude,
            longitude: t.geoLongitude,
        };
    }

    return buildTransactionInfoResponse({
        id: t.transactionId,
        timeSequenceId: BigInt(t.transactionTime),
        type: transactionType,
        categoryId: t.categoryId,
        time: getUnixTimeFromTransactionTime(t.transactionTime),
        utcOffset: t.timezoneUtcOffset,
        sourceAccountId: sourceAccountId,
        destinationAccountId: destinationAccountId,
        sourceAmount: sourceAmount,
        destinationAmount: destinationAmount,
        hideAmount: t.hideAmount,
        tagIds: tagIds.map(id => id.toString()),
        comment: t.comment,
        geoLocation: geoLocation,
        editable: editable,
    });
}

// buildTransactionInfoResponse returns the response object which has the same field order as the go struct and omits empty fields
export function buildTransactionInfoResponse(r: TransactionInfoResponse): TransactionInfoResponse {
    const ret: Record<string, unknown> = {
        id: r.id,
        timeSequenceId: r.timeSequenceId,
        type: r.type,
        categoryId: r.categoryId,
    };

    if (r.category) {
        ret['category'] = r.category;
    }

    ret['time'] = r.time;
    ret['utcOffset'] = r.utcOffset;
    ret['sourceAccountId'] = r.sourceAccountId;

    if (r.sourceAccount) {
        ret['sourceAccount'] = r.sourceAccount;
    }

    if (r.destinationAccountId !== undefined && r.destinationAccountId !== 0n) {
        ret['destinationAccountId'] = r.destinationAccountId;
    }

    if (r.destinationAccount) {
        ret['destinationAccount'] = r.destinationAccount;
    }

    ret['sourceAmount'] = r.sourceAmount;

    if (r.destinationAmount !== undefined && r.destinationAmount !== null) {
        ret['destinationAmount'] = r.destinationAmount;
    }

    ret['hideAmount'] = r.hideAmount;
    ret['tagIds'] = r.tagIds;

    if (r.tags && r.tags.length > 0) {
        ret['tags'] = r.tags;
    }

    if (r.pictures && r.pictures.length > 0) {
        ret['pictures'] = r.pictures;
    }

    ret['comment'] = r.comment;

    if (r.geoLocation) {
        ret['geoLocation'] = r.geoLocation;
    }

    ret['editable'] = r.editable;

    return ret as unknown as TransactionInfoResponse;
}

export function getTransactionAmountsRequestItems(t: TransactionAmountsRequest): TransactionAmountsRequestItem[] {
    const items = t.query.split('|');
    const requestItems: TransactionAmountsRequestItem[] = [];

    for (const item of items) {
        const itemValues = item.split('_');

        if (itemValues.length !== 3) {
            throw errs.ErrQueryItemsInvalid;
        }

        requestItems.push({
            name: itemValues[0]!,
            startTime: stringToInt64Number(itemValues[1]!),
            endTime: stringToInt64Number(itemValues[2]!),
        });
    }

    return requestItems;
}

export function getNumericYearMonthRange(t: YearMonthRangeRequest): [number, number, number, number] {
    let startYear = 0;
    let startMonth = 0;
    let endYear = 0;
    let endMonth = 0;

    if (t.startYearMonth !== '') {
        [startYear, startMonth] = parseNumericYearMonth(t.startYearMonth);
    }

    if (t.endYearMonth !== '') {
        [endYear, endMonth] = parseNumericYearMonth(t.endYearMonth);
    }

    return [startYear, startMonth, endYear, endMonth];
}

export function sortTransactionInfoResponses(s: TransactionInfoResponse[]): TransactionInfoResponse[] {
    return s.sort((a, b) => {
        if (a.time !== b.time) {
            return b.time - a.time;
        }

        return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
    });
}

export function sortTransactionStatisticTrendsResponseItems(s: TransactionStatisticTrendsResponseItem[]): TransactionStatisticTrendsResponseItem[] {
    return s.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
}

export function sortTransactionStatisticAssetTrendsResponseItems(s: TransactionStatisticAssetTrendsResponseItem[]): TransactionStatisticAssetTrendsResponseItem[] {
    return s.sort((a, b) => {
        if (a.year !== b.year) {
            return a.year - b.year;
        }

        if (a.month !== b.month) {
            return a.month - b.month;
        }

        return a.day - b.day;
    });
}

export function sortTransactionAmountsResponseItemAmountInfos(s: TransactionAmountsResponseItemAmountInfo[]): TransactionAmountsResponseItemAmountInfo[] {
    return s.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

export type { DateTime };
