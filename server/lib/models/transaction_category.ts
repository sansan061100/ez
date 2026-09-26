import { defineTable } from '../datastore/schema';

export const LevelOneTransactionCategoryParentId = 0n;

export type TransactionCategoryType = number;

export const CATEGORY_TYPE_INCOME = 1;
export const CATEGORY_TYPE_EXPENSE = 2;
export const CATEGORY_TYPE_TRANSFER = 3;

// TransactionCategory represents transaction category data stored in database
export interface TransactionCategory {
    categoryId: bigint;
    uid: bigint;
    deleted: boolean;
    type: TransactionCategoryType;
    parentCategoryId: bigint;
    name: string;
    displayOrder: number;
    icon: bigint;
    iconType: number;
    color: string;
    hidden: boolean;
    comment: string;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const categoryIndex = ['IDX_category_uid_deleted_type_parent_category_id_order'];

export const TransactionCategoryTable = defineTable<TransactionCategory>('transaction_category', [
    ['category_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, index: categoryIndex }],
    ['deleted', 'bool', { notNull: true, index: categoryIndex }],
    ['type', 'u8', { notNull: true, index: categoryIndex }],
    ['parent_category_id', 'id', { notNull: true, index: categoryIndex }],
    ['name', 'str', { length: 64, notNull: true }],
    ['display_order', 'i32', { notNull: true, index: categoryIndex }],
    ['icon', 'id', { notNull: true }],
    ['icon_type', 'u8'],
    ['color', 'str', { length: 6, notNull: true }],
    ['hidden', 'bool', { notNull: true }],
    ['comment', 'str', { length: 255, notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newTransactionCategory(values: Partial<TransactionCategory> = {}): TransactionCategory {
    return {
        categoryId: 0n,
        uid: 0n,
        deleted: false,
        type: 0,
        parentCategoryId: 0n,
        name: '',
        displayOrder: 0,
        icon: 0n,
        iconType: 0,
        color: '',
        hidden: false,
        comment: '',
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}

export interface TransactionCategoryListRequest {
    type: TransactionCategoryType;
    parentId: bigint;
}

export interface TransactionCategoryGetRequest {
    id: bigint;
}

export interface TransactionCategoryCreateRequest {
    name: string;
    type: TransactionCategoryType;
    parentId: bigint;
    icon: bigint;
    iconType: number;
    color: string;
    comment: string;
    clientSessionId: string;
}

export interface TransactionCategoryCreateWithSubCategories {
    name: string;
    type: TransactionCategoryType;
    icon: bigint;
    iconType: number;
    color: string;
    comment: string;
    subCategories: TransactionCategoryCreateRequest[] | null;
}

export interface TransactionCategoryCreateBatchRequest {
    categories: TransactionCategoryCreateWithSubCategories[] | null;
}

export interface TransactionCategoryModifyRequest {
    id: bigint;
    name: string;
    parentId: bigint;
    icon: bigint;
    iconType: number;
    color: string;
    comment: string;
    hidden: boolean;
}

export interface TransactionCategoryHideRequest {
    id: bigint;
    hidden: boolean;
}

export interface TransactionCategoryNewDisplayOrderRequest {
    id: bigint;
    displayOrder: number;
}

export interface TransactionCategoryMoveRequest {
    newDisplayOrders: TransactionCategoryNewDisplayOrderRequest[];
}

export interface TransactionCategoryDeleteRequest {
    id: bigint;
}

// TransactionCategoryInfoResponse represents a view-object of transaction category
export interface TransactionCategoryInfoResponse {
    id: bigint;
    name: string;
    parentId: bigint;
    type: TransactionCategoryType;
    icon: bigint;
    iconType: number;
    color: string;
    comment: string;
    displayOrder: number;
    hidden: boolean;
    subCategories?: TransactionCategoryInfoResponse[];
}

export function toTransactionCategoryInfoResponse(c: TransactionCategory): TransactionCategoryInfoResponse {
    return {
        id: c.categoryId,
        name: c.name,
        parentId: c.parentCategoryId,
        type: c.type,
        icon: c.icon,
        iconType: c.iconType,
        color: c.color,
        comment: c.comment,
        displayOrder: c.displayOrder,
        hidden: c.hidden,
    };
}

export function sortByDisplayOrder<T extends { displayOrder: number }>(items: T[]): T[] {
    return items.sort((a, b) => a.displayOrder - b.displayOrder);
}
