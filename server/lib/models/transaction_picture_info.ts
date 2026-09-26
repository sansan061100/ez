import { defineTable } from '../datastore/schema';

export const TransactionPictureNewPictureTransactionId = 0n;

// TransactionPictureInfo represents transaction picture info stored in database
export interface TransactionPictureInfo {
    uid: bigint;
    deleted: boolean;
    transactionId: bigint;
    pictureId: bigint;
    pictureExtension: string;
    createdIp: string;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const idxUidDeletedTransactionIdPictureId = 'IDX_transaction_picture_uid_deleted_transaction_id_picture_id';
const idxUidDeletedPictureId = 'IDX_transaction_picture_uid_deleted_picture_id';

export const TransactionPictureInfoTable = defineTable<TransactionPictureInfo>('transaction_picture_info', [
    ['uid', 'id', { notNull: true, index: [idxUidDeletedTransactionIdPictureId, idxUidDeletedPictureId] }],
    ['deleted', 'bool', { notNull: true, index: [idxUidDeletedTransactionIdPictureId, idxUidDeletedPictureId] }],
    ['transaction_id', 'id', { notNull: true, index: [idxUidDeletedTransactionIdPictureId] }],
    ['picture_id', 'id', { pk: true, index: [idxUidDeletedTransactionIdPictureId, idxUidDeletedPictureId] }],
    ['picture_extension', 'str', { length: 10, notNull: true }],
    ['created_ip', 'str', { length: 39 }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newTransactionPictureInfo(values: Partial<TransactionPictureInfo> = {}): TransactionPictureInfo {
    return {
        uid: 0n,
        deleted: false,
        transactionId: 0n,
        pictureId: 0n,
        pictureExtension: '',
        createdIp: '',
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}

export interface TransactionPictureUnusedDeleteRequest {
    id: bigint;
}

export interface TransactionPictureInfoBasicResponse {
    pictureId: bigint;
    originalUrl: string;
}

export function toTransactionPictureInfoBasicResponse(p: TransactionPictureInfo, originalUrl: string): TransactionPictureInfoBasicResponse {
    return {
        pictureId: p.pictureId,
        originalUrl: originalUrl,
    };
}

export function sortTransactionPictureInfoBasicResponses(s: TransactionPictureInfoBasicResponse[]): TransactionPictureInfoBasicResponse[] {
    return s.sort((a, b) => (a.pictureId < b.pictureId ? -1 : a.pictureId > b.pictureId ? 1 : 0));
}
