import { defineTable } from '../datastore/schema';

// TransactionTagIndex represents transaction and transaction tag relation stored in database
export interface TransactionTagIndex {
    tagIndexId: bigint;
    uid: bigint;
    deleted: boolean;
    transactionTime: number;
    tagId: bigint;
    transactionId: bigint;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const idxTagIdTransactionId = 'IDX_transaction_tag_index_uid_deleted_tag_id_transaction_id';
const idxTransactionTimeTagId = 'IDX_transaction_tag_index_uid_deleted_transaction_time_tag_id';
const idxTransactionId = 'IDX_transaction_tag_index_uid_deleted_transaction_id';

export const TransactionTagIndexTable = defineTable<TransactionTagIndex>('transaction_tag_index', [
    ['tag_index_id', 'id', { pk: true }],
    ['uid', 'id', { index: [idxTagIdTransactionId, idxTransactionTimeTagId, idxTransactionId] }],
    ['deleted', 'bool', { notNull: true, index: [idxTagIdTransactionId, idxTransactionTimeTagId, idxTransactionId] }],
    ['transaction_time', 'i64', { notNull: true, index: [idxTransactionTimeTagId] }],
    ['tag_id', 'id', { index: [idxTagIdTransactionId, idxTransactionTimeTagId] }],
    ['transaction_id', 'id', { index: [idxTagIdTransactionId, idxTransactionId] }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newTransactionTagIndex(values: Partial<TransactionTagIndex> = {}): TransactionTagIndex {
    return {
        tagIndexId: 0n,
        uid: 0n,
        deleted: false,
        transactionTime: 0,
        tagId: 0n,
        transactionId: 0n,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}
