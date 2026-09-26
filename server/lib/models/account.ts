import { defineTable, type JsonCodec } from '../datastore/schema';

export const LevelOneAccountParentId = 0n;

export type AccountCategory = number;

export const ACCOUNT_CATEGORY_CASH = 1;
export const ACCOUNT_CATEGORY_CHECKING_ACCOUNT = 2;
export const ACCOUNT_CATEGORY_CREDIT_CARD = 3;
export const ACCOUNT_CATEGORY_VIRTUAL = 4;
export const ACCOUNT_CATEGORY_DEBT = 5;
export const ACCOUNT_CATEGORY_RECEIVABLES = 6;
export const ACCOUNT_CATEGORY_INVESTMENT = 7;
export const ACCOUNT_CATEGORY_SAVINGS_ACCOUNT = 8;
export const ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT = 9;

const assetAccountCategory: Record<number, boolean> = {
    [ACCOUNT_CATEGORY_CASH]: true,
    [ACCOUNT_CATEGORY_CHECKING_ACCOUNT]: true,
    [ACCOUNT_CATEGORY_CREDIT_CARD]: false,
    [ACCOUNT_CATEGORY_VIRTUAL]: true,
    [ACCOUNT_CATEGORY_DEBT]: false,
    [ACCOUNT_CATEGORY_RECEIVABLES]: true,
    [ACCOUNT_CATEGORY_INVESTMENT]: true,
    [ACCOUNT_CATEGORY_SAVINGS_ACCOUNT]: true,
    [ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT]: true,
};

const liabilityAccountCategory: Record<number, boolean> = {
    [ACCOUNT_CATEGORY_CASH]: false,
    [ACCOUNT_CATEGORY_CHECKING_ACCOUNT]: false,
    [ACCOUNT_CATEGORY_CREDIT_CARD]: true,
    [ACCOUNT_CATEGORY_VIRTUAL]: false,
    [ACCOUNT_CATEGORY_DEBT]: true,
    [ACCOUNT_CATEGORY_RECEIVABLES]: false,
    [ACCOUNT_CATEGORY_INVESTMENT]: false,
    [ACCOUNT_CATEGORY_SAVINGS_ACCOUNT]: false,
    [ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT]: false,
};

export function isAssetAccountCategory(c: AccountCategory): boolean {
    return assetAccountCategory[c] ?? false;
}

export function isLiabilityAccountCategory(c: AccountCategory): boolean {
    return liabilityAccountCategory[c] ?? false;
}

export type AccountType = number;

export const ACCOUNT_TYPE_SINGLE_ACCOUNT = 1;
export const ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS = 2;

const defaultCreditCardAccountStatementDate = 0;
const defaultCreditCardAccountLimit = '0';

// AccountExtend represents account extend data stored in database
export interface AccountExtend {
    lastReconciledTime?: number | null;
    creditCardStatementDate?: number | null;
    creditCardLimit?: bigint | null;
}

export const AccountExtendCodec: JsonCodec = {
    encode(value: unknown): string {
        const extend = value as AccountExtend;
        const data: Record<string, unknown> = {};

        if (extend.lastReconciledTime !== undefined && extend.lastReconciledTime !== null) {
            data['lastReconciledTime'] = extend.lastReconciledTime;
        }

        if (extend.creditCardStatementDate !== undefined && extend.creditCardStatementDate !== null) {
            data['creditCardStatementDate'] = extend.creditCardStatementDate;
        }

        if (extend.creditCardLimit !== undefined && extend.creditCardLimit !== null) {
            data['creditCardLimit'] = extend.creditCardLimit.toString();
        }

        return JSON.stringify(data);
    },
    decode(text: string): unknown {
        const data = JSON.parse(text) as Record<string, unknown>;
        const extend: AccountExtend = {};

        if (typeof data['lastReconciledTime'] === 'number') {
            extend.lastReconciledTime = data['lastReconciledTime'];
        }

        if (typeof data['creditCardStatementDate'] === 'number') {
            extend.creditCardStatementDate = data['creditCardStatementDate'];
        }

        if (typeof data['creditCardLimit'] === 'string' && /^-?\d+$/.test(data['creditCardLimit'])) {
            extend.creditCardLimit = BigInt(data['creditCardLimit']);
        }

        return extend;
    },
};

// Account represents account data stored in database
export interface Account {
    accountId: bigint;
    uid: bigint;
    deleted: boolean;
    category: AccountCategory;
    type: AccountType;
    parentAccountId: bigint;
    name: string;
    displayOrder: number;
    icon: bigint;
    iconType: number;
    color: string;
    currency: string;
    balance: number;
    comment: string;
    extend: AccountExtend | null;
    hidden: boolean;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const accountIndex = ['IDX_account_uid_deleted_parent_account_id_order'];

export const AccountTable = defineTable<Account>('account', [
    ['account_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, index: accountIndex }],
    ['deleted', 'bool', { notNull: true, index: accountIndex }],
    ['category', 'u8', { notNull: true }],
    ['type', 'u8', { notNull: true }],
    ['parent_account_id', 'id', { notNull: true, index: accountIndex }],
    ['name', 'str', { length: 64, notNull: true }],
    ['display_order', 'i32', { notNull: true, index: accountIndex }],
    ['icon', 'id', { notNull: true }],
    ['icon_type', 'u8'],
    ['color', 'str', { length: 6, notNull: true }],
    ['currency', 'str', { length: 3, notNull: true }],
    ['balance', 'i64', { notNull: true }],
    ['comment', 'str', { length: 255, notNull: true }],
    ['extend', 'json', { codec: AccountExtendCodec }],
    ['hidden', 'bool', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newAccount(values: Partial<Account> = {}): Account {
    return {
        accountId: 0n,
        uid: 0n,
        deleted: false,
        category: 0,
        type: 0,
        parentAccountId: 0n,
        name: '',
        displayOrder: 0,
        icon: 0n,
        iconType: 0,
        color: '',
        currency: '',
        balance: 0,
        comment: '',
        extend: null,
        hidden: false,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}

// AccountCreateRequest represents all parameters of account creation request
export interface AccountCreateRequest {
    name: string;
    category: AccountCategory;
    type: AccountType;
    icon: bigint;
    iconType: number;
    color: string;
    currency: string;
    balance: string;
    balanceTime: number;
    comment: string;
    creditCardStatementDate: number;
    creditCardLimit: string;
    subAccounts: AccountCreateRequest[] | null;
    clientSessionId: string;
}

// AccountModifyRequest represents all parameters of account modification request
export interface AccountModifyRequest {
    id: bigint;
    name: string;
    category: AccountCategory;
    icon: bigint;
    iconType: number;
    color: string;
    currency: string | null;
    balance: string | null;
    balanceTime: number | null;
    lastReconciledTime: number | null;
    comment: string;
    creditCardStatementDate: number;
    creditCardLimit: string;
    hidden: boolean;
    subAccounts: AccountModifyRequest[] | null;
    clientSessionId: string;
}

export interface AccountUpdateLastReconciledTimeRequest {
    id: bigint;
    lastReconciledTime: number;
}

export interface AccountListRequest {
    visibleOnly: boolean;
}

export interface AccountGetRequest {
    id: bigint;
}

export interface AccountHideRequest {
    id: bigint;
    hidden: boolean;
}

export interface AccountNewDisplayOrderRequest {
    id: bigint;
    displayOrder: number;
}

export interface AccountMoveRequest {
    newDisplayOrders: AccountNewDisplayOrderRequest[];
}

export interface AccountDeleteRequest {
    id: bigint;
}

// AccountInfoResponse represents a view-object of account
export interface AccountInfoResponse {
    id: bigint;
    name: string;
    parentId: bigint;
    category: AccountCategory;
    type: AccountType;
    icon: bigint;
    iconType: number;
    color: string;
    currency: string;
    balance: string;
    lastReconciledTime?: number;
    comment: string;
    creditCardStatementDate?: number;
    creditCardLimit?: string;
    displayOrder: number;
    isAsset?: boolean;
    isLiability?: boolean;
    hidden: boolean;
    subAccounts?: AccountInfoResponse[];
}

export function getAccountLastReconciledTime(a: Account): number {
    if (a.extend && a.extend.lastReconciledTime !== undefined && a.extend.lastReconciledTime !== null) {
        return a.extend.lastReconciledTime;
    }

    return 0;
}

// toAccountInfoResponse returns a view-object according to database model
export function toAccountInfoResponse(a: Account): AccountInfoResponse {
    let lastReconciledTime: number | undefined;
    let creditCardStatementDate: number | undefined;
    let creditCardLimit: string | undefined;

    if (a.extend && a.extend.lastReconciledTime !== undefined && a.extend.lastReconciledTime !== null) {
        lastReconciledTime = a.extend.lastReconciledTime;
    }

    if (a.parentAccountId === LevelOneAccountParentId && a.category === ACCOUNT_CATEGORY_CREDIT_CARD) {
        if (a.extend && a.extend.creditCardStatementDate !== undefined && a.extend.creditCardStatementDate !== null) {
            creditCardStatementDate = a.extend.creditCardStatementDate;
        } else {
            creditCardStatementDate = defaultCreditCardAccountStatementDate;
        }

        if (a.extend && a.extend.creditCardLimit !== undefined && a.extend.creditCardLimit !== null) {
            creditCardLimit = a.extend.creditCardLimit.toString();
        } else {
            creditCardLimit = defaultCreditCardAccountLimit;
        }
    }

    const response: AccountInfoResponse = {
        id: a.accountId,
        name: a.name,
        parentId: a.parentAccountId,
        category: a.category,
        type: a.type,
        icon: a.icon,
        iconType: a.iconType,
        color: a.color,
        currency: a.currency,
        balance: String(a.balance),
        comment: a.comment,
        displayOrder: a.displayOrder,
        hidden: a.hidden,
    };

    return orderAccountInfoResponse(response, lastReconciledTime, creditCardStatementDate, creditCardLimit, isAssetAccountCategory(a.category), isLiabilityAccountCategory(a.category));
}

// orderAccountInfoResponse builds the response object with the same field order as the go struct
function orderAccountInfoResponse(r: AccountInfoResponse, lastReconciledTime: number | undefined, creditCardStatementDate: number | undefined, creditCardLimit: string | undefined, isAsset: boolean, isLiability: boolean): AccountInfoResponse {
    const ret: AccountInfoResponse = {
        id: r.id,
        name: r.name,
        parentId: r.parentId,
        category: r.category,
        type: r.type,
        icon: r.icon,
        iconType: r.iconType,
        color: r.color,
        currency: r.currency,
        balance: r.balance,
    } as AccountInfoResponse;

    if (lastReconciledTime !== undefined) {
        ret.lastReconciledTime = lastReconciledTime;
    }

    ret.comment = r.comment;

    if (creditCardStatementDate !== undefined) {
        ret.creditCardStatementDate = creditCardStatementDate;
    }

    if (creditCardLimit !== undefined) {
        ret.creditCardLimit = creditCardLimit;
    }

    ret.displayOrder = r.displayOrder;

    if (isAsset) {
        ret.isAsset = true;
    }

    if (isLiability) {
        ret.isLiability = true;
    }

    ret.hidden = r.hidden;

    return ret;
}

// sortAccountInfoResponses sorts account responses by category and display order
export function sortAccountInfoResponses(a: AccountInfoResponse[]): AccountInfoResponse[] {
    return a.sort((x, y) => {
        if (x.category !== y.category) {
            return x.category - y.category;
        }

        return x.displayOrder - y.displayOrder;
    });
}
