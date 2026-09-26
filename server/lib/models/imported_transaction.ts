import { stringToInt64 } from '../utils/converter';
import { getUnixTimeFromTransactionTime } from '../utils/datetimes';
import {
    type Transaction,
    TRANSACTION_DB_TYPE_MODIFY_BALANCE,
    transactionDbTypeToTransactionType,
    type TransactionGeoLocationResponse,
    type TransactionType,
} from './transaction';

// ImportTransaction represents the imported transaction data
export interface ImportTransaction {
    transaction: Transaction;
    tagIds: string[];
    originalCategoryName: string;
    originalSourceAccountName: string;
    originalSourceAccountCurrency: string;
    originalDestinationAccountName: string;
    originalDestinationAccountCurrency: string;
    originalTagNames: string[];
}

export interface ImportTransactionRequestItem {
    time: string;
    utcOffset: string;
    type: string;
    categoryName: string;
    sourceAccountName: string;
    destinationAccountName: string;
    sourceAmount: string;
    destinationAmount: string;
    geoLocation: string;
    tagNames: string;
    comment: string;
}

export interface ImportTransactionRequest {
    transactions: ImportTransactionRequestItem[];
}

export interface ImportTransactionResponse {
    type: TransactionType;
    categoryId: bigint;
    originalCategoryName: string;
    time: number;
    utcOffset: number;
    sourceAccountId: bigint;
    originalSourceAccountName: string;
    originalSourceAccountCurrency: string;
    destinationAccountId?: bigint;
    originalDestinationAccountName?: string;
    originalDestinationAccountCurrency?: string;
    sourceAmount: number;
    destinationAmount?: number;
    tagIds: string[] | null;
    originalTagNames: string[] | null;
    comment: string;
    geoLocation?: TransactionGeoLocationResponse;
}

export interface ImportTransactionResponsePageWrapper {
    items: ImportTransactionResponse[];
    totalCount: number;
}

export function toImportTransactionResponse(t: ImportTransaction): ImportTransactionResponse | null {
    let transactionType: TransactionType;

    try {
        transactionType = transactionDbTypeToTransactionType(t.transaction.type);
    } catch {
        return null;
    }

    const ret: Record<string, unknown> = {
        type: transactionType,
        categoryId: t.transaction.categoryId,
        originalCategoryName: t.originalCategoryName,
        time: getUnixTimeFromTransactionTime(t.transaction.transactionTime),
        utcOffset: t.transaction.timezoneUtcOffset,
        sourceAccountId: t.transaction.accountId,
        originalSourceAccountName: t.originalSourceAccountName,
        originalSourceAccountCurrency: t.originalSourceAccountCurrency,
    };

    if (t.transaction.relatedAccountId !== 0n) {
        ret['destinationAccountId'] = t.transaction.relatedAccountId;
    }

    if (t.originalDestinationAccountName !== '') {
        ret['originalDestinationAccountName'] = t.originalDestinationAccountName;
    }

    if (t.originalDestinationAccountCurrency !== '') {
        ret['originalDestinationAccountCurrency'] = t.originalDestinationAccountCurrency;
    }

    ret['sourceAmount'] = t.transaction.amount;

    if (t.transaction.relatedAccountAmount !== 0) {
        ret['destinationAmount'] = t.transaction.relatedAccountAmount;
    }

    ret['tagIds'] = t.tagIds ?? null;
    ret['originalTagNames'] = t.originalTagNames ?? null;
    ret['comment'] = t.transaction.comment;

    if (t.transaction.geoLongitude !== 0 || t.transaction.geoLatitude !== 0) {
        ret['geoLocation'] = {
            latitude: t.transaction.geoLatitude,
            longitude: t.transaction.geoLongitude,
        };
    }

    return ret as unknown as ImportTransactionResponse;
}

function compareString(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// sortImportedTransactions sorts imported transactions (balance modification first, then by time, type, category, account, amount and comment)
export function sortImportedTransactions(s: ImportTransaction[]): ImportTransaction[] {
    return s.sort((a, b) => {
        const x = a.transaction;
        const y = b.transaction;

        if (x.type !== y.type && (x.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE || y.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE)) {
            if (x.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                return -1;
            } else if (y.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                return 1;
            }
        }

        if (x.transactionTime !== y.transactionTime) {
            return x.transactionTime - y.transactionTime;
        }

        if (x.type !== y.type) {
            return x.type - y.type;
        }

        if (a.originalCategoryName !== b.originalCategoryName) {
            return compareString(a.originalCategoryName, b.originalCategoryName);
        }

        if (a.originalSourceAccountName !== b.originalSourceAccountName) {
            return compareString(a.originalSourceAccountName, b.originalSourceAccountName);
        }

        if (x.amount !== y.amount) {
            return x.amount - y.amount;
        }

        if (x.comment !== y.comment) {
            return compareString(x.comment, y.comment);
        }

        return 0;
    });
}

export function importedTransactionsToTransactionsList(s: ImportTransaction[]): Transaction[] {
    return s.map(t => t.transaction);
}

export function importedTransactionsToTransactionTagIdsMap(s: ImportTransaction[]): Map<number, bigint[]> {
    const transactionTagIdsMap = new Map<number, bigint[]>();

    for (let i = 0; i < s.length; i++) {
        transactionTagIdsMap.set(i, (s[i]!.tagIds ?? []).map(id => stringToInt64(id)));
    }

    return transactionTagIdsMap;
}

export function importedTransactionsToResponseList(s: ImportTransaction[]): ImportTransactionResponse[] {
    const transactionResps: ImportTransactionResponse[] = [];

    for (const importedTransaction of s) {
        const resp = toImportTransactionResponse(importedTransaction);

        if (resp) {
            transactionResps.push(resp);
        }
    }

    return transactionResps;
}
