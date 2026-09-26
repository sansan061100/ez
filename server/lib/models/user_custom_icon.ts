import { defineTable } from '../datastore/schema';

export const UserCustomIconFileExtension = 'png';

// UserCustomIcon represents user custom icon stored in database
export interface UserCustomIcon {
    iconId: bigint;
    uid: bigint;
    deleted: boolean;
    displayOrder: number;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const idxUidDeletedOrder = 'IDX_user_custom_icon_uid_deleted_order';

export const UserCustomIconTable = defineTable<UserCustomIcon>('user_custom_icon', [
    ['icon_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, index: [idxUidDeletedOrder] }],
    ['deleted', 'bool', { notNull: true, index: [idxUidDeletedOrder] }],
    ['display_order', 'i32', { notNull: true, index: [idxUidDeletedOrder] }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export interface UserCustomIconNewDisplayOrderRequest {
    id: bigint;
    displayOrder: number;
}

export interface UserCustomIconMoveRequest {
    newDisplayOrders: UserCustomIconNewDisplayOrderRequest[];
}

export interface UserCustomIconDeleteRequest {
    id: bigint;
}

export interface UserCustomIconInfoResponse {
    id: bigint;
    displayOrder: number;
}

export function toUserCustomIconInfoResponse(i: UserCustomIcon): UserCustomIconInfoResponse {
    return {
        id: i.iconId,
        displayOrder: i.displayOrder,
    };
}
