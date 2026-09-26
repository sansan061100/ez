import { defineTable } from '../datastore/schema';

// InsightsExplorer represents insights explorer data stored in database
export interface InsightsExplorer {
    explorerId: bigint;
    uid: bigint;
    deleted: boolean;
    name: string;
    displayOrder: number;
    data: string;
    hidden: boolean;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const idxUidDeletedOrder = 'IDX_insights_explorer_uid_deleted_order';

export const InsightsExplorerTable = defineTable<InsightsExplorer>('insights_explorer', [
    ['explorer_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, index: [idxUidDeletedOrder] }],
    ['deleted', 'bool', { notNull: true, index: [idxUidDeletedOrder] }],
    ['name', 'str', { length: 64, notNull: true }],
    ['display_order', 'i32', { notNull: true, index: [idxUidDeletedOrder] }],
    ['data', 'mblob'],
    ['hidden', 'bool', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export interface InsightsExplorerCreateRequest {
    name: string;
    data: Record<string, unknown> | null;
    clientSessionId: string;
}

export interface InsightsExplorerModifyRequest {
    id: bigint;
    name: string;
    data: Record<string, unknown> | null;
    hidden: boolean;
    clientSessionId: string;
}

export interface InsightsExplorerGetRequest {
    id: bigint;
}

export interface InsightsExplorerHideRequest {
    id: bigint;
    hidden: boolean;
}

export interface InsightsExplorerNewDisplayOrderRequest {
    id: bigint;
    displayOrder: number;
}

export interface InsightsExplorerMoveRequest {
    newDisplayOrders: InsightsExplorerNewDisplayOrderRequest[];
}

export interface InsightsExplorerDeleteRequest {
    id: bigint;
}

export interface InsightsExplorerInfoResponse {
    id: bigint;
    name: string;
    displayOrder: number;
    hidden: boolean;
    data?: Record<string, unknown>;
}

export function toInsightsExplorerInfoResponse(a: InsightsExplorer): InsightsExplorerInfoResponse {
    let data: Record<string, unknown> | null = null;

    if (a.data !== '') {
        data = JSON.parse(a.data) as Record<string, unknown> | null;
    }

    const ret: InsightsExplorerInfoResponse = {
        id: a.explorerId,
        name: a.name,
        displayOrder: a.displayOrder,
        hidden: a.hidden,
    };

    if (data && Object.keys(data).length > 0) {
        ret.data = data;
    }

    return ret;
}
