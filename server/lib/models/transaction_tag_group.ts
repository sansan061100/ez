import { defineTable } from '../datastore/schema';

// TransactionTagGroup represents transaction tag group data stored in database
export interface TransactionTagGroup {
    tagGroupId: bigint;
    uid: bigint;
    deleted: boolean;
    name: string;
    displayOrder: number;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const tagGroupIndex = ['IDX_tag_group_uid_deleted_order'];

export const TransactionTagGroupTable = defineTable<TransactionTagGroup>('transaction_tag_group', [
    ['tag_group_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, index: tagGroupIndex }],
    ['deleted', 'bool', { notNull: true, index: tagGroupIndex }],
    ['name', 'str', { length: 64, notNull: true }],
    ['display_order', 'i32', { notNull: true, index: tagGroupIndex }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newTransactionTagGroup(values: Partial<TransactionTagGroup> = {}): TransactionTagGroup {
    return {
        tagGroupId: 0n,
        uid: 0n,
        deleted: false,
        name: '',
        displayOrder: 0,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}

export interface TransactionTagGroupGetRequest {
    id: bigint;
}

export interface TransactionTagGroupCreateRequest {
    name: string;
}

export interface TransactionTagGroupModifyRequest {
    id: bigint;
    name: string;
}

export interface TransactionTagGroupNewDisplayOrderRequest {
    id: bigint;
    displayOrder: number;
}

export interface TransactionTagGroupMoveRequest {
    newDisplayOrders: TransactionTagGroupNewDisplayOrderRequest[];
}

export interface TransactionTagGroupDeleteRequest {
    id: bigint;
}

export interface TransactionTagGroupInfoResponse {
    id: bigint;
    name: string;
    displayOrder: number;
}

export function toTransactionTagGroupInfoResponse(t: TransactionTagGroup): TransactionTagGroupInfoResponse {
    return {
        id: t.tagGroupId,
        name: t.name,
        displayOrder: t.displayOrder,
    };
}
