import { defineTable } from '../datastore/schema';

// TransactionTag represents transaction tag data stored in database
export interface TransactionTag {
    tagId: bigint;
    uid: bigint;
    deleted: boolean;
    tagGroupId: bigint;
    name: string;
    displayOrder: number;
    hidden: boolean;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const tagIndex = ['IDX_tag_uid_deleted_group_order'];

export const TransactionTagTable = defineTable<TransactionTag>('transaction_tag', [
    ['tag_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, index: tagIndex }],
    ['deleted', 'bool', { notNull: true, index: tagIndex }],
    ['tag_group_id', 'id', { notNull: true, defaultValue: '0', index: tagIndex }],
    ['name', 'str', { length: 64, notNull: true }],
    ['display_order', 'i32', { notNull: true, index: tagIndex }],
    ['hidden', 'bool', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newTransactionTag(values: Partial<TransactionTag> = {}): TransactionTag {
    return {
        tagId: 0n,
        uid: 0n,
        deleted: false,
        tagGroupId: 0n,
        name: '',
        displayOrder: 0,
        hidden: false,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}

export interface TransactionTagGetRequest {
    id: bigint;
}

export interface TransactionTagCreateRequest {
    groupId: bigint;
    name: string;
}

export interface TransactionTagCreateBatchRequest {
    tags: TransactionTagCreateRequest[] | null;
    groupId: bigint;
    skipExists: boolean;
}

export interface TransactionTagModifyRequest {
    id: bigint;
    groupId: bigint;
    name: string;
}

export interface TransactionTagHideRequest {
    id: bigint;
    hidden: boolean;
}

export interface TransactionTagNewDisplayOrderRequest {
    id: bigint;
    displayOrder: number;
}

export interface TransactionTagMoveRequest {
    newDisplayOrders: TransactionTagNewDisplayOrderRequest[];
}

export interface TransactionTagDeleteRequest {
    id: bigint;
}

// TransactionTagInfoResponse represents a view-object of transaction tag
export interface TransactionTagInfoResponse {
    id: bigint;
    name: string;
    groupId: bigint;
    displayOrder: number;
    hidden: boolean;
}

export function fillTagFromOtherTag(t: TransactionTag, tag: TransactionTag): void {
    t.tagId = tag.tagId;
    t.uid = tag.uid;
    t.deleted = tag.deleted;
    t.name = tag.name;
    t.tagGroupId = tag.tagGroupId;
    t.displayOrder = tag.displayOrder;
    t.hidden = tag.hidden;
    t.createdUnixTime = tag.createdUnixTime;
    t.updatedUnixTime = tag.updatedUnixTime;
    t.deletedUnixTime = tag.deletedUnixTime;
}

export function toTransactionTagInfoResponse(t: TransactionTag): TransactionTagInfoResponse {
    return {
        id: t.tagId,
        name: t.name,
        groupId: t.tagGroupId,
        displayOrder: t.displayOrder,
        hidden: t.hidden,
    };
}

export function sortTransactionTagInfoResponses(s: TransactionTagInfoResponse[]): TransactionTagInfoResponse[] {
    return s.sort((a, b) => {
        if (a.groupId !== b.groupId) {
            return a.groupId < b.groupId ? -1 : 1;
        }

        return a.displayOrder - b.displayOrder;
    });
}
