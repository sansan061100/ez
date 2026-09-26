import { defineTable } from '../datastore/schema';
import { fixedZone, formatUnixTimeToLongDate, getMinTransactionTimeFromUnixTime } from '../utils/datetimes';
import { buildTransactionInfoResponse, TRANSACTION_TYPE_TRANSFER, type TransactionInfoResponse, type TransactionType } from './transaction';

export type TransactionTemplateType = number;

export const TRANSACTION_TEMPLATE_TYPE_NORMAL = 1;
export const TRANSACTION_TEMPLATE_TYPE_SCHEDULE = 2;

export type TransactionScheduleFrequencyType = number;

export const TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED = 0;
export const TRANSACTION_SCHEDULE_FREQUENCY_TYPE_WEEKLY = 1;
export const TRANSACTION_SCHEDULE_FREQUENCY_TYPE_MONTHLY = 2;
export const TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DAILY = 3;
export const TRANSACTION_SCHEDULE_FREQUENCY_TYPE_YEARLY = 4;
export const TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS = 5;

// TransactionTemplate represents transaction template data stored in database
export interface TransactionTemplate {
    templateId: bigint;
    uid: bigint;
    deleted: boolean;
    templateType: TransactionTemplateType;
    name: string;
    type: TransactionType;
    categoryId: bigint;
    accountId: bigint;
    scheduledFrequencyType: TransactionScheduleFrequencyType;
    scheduledFrequency: string;
    scheduledStartTime: number | null;
    scheduledEndTime: number | null;
    scheduledAt: number;
    scheduledTimezoneUtcOffset: number;
    tagIds: string;
    amount: number;
    relatedAccountId: bigint;
    relatedAccountAmount: number;
    hideAmount: boolean;
    comment: string;
    displayOrder: number;
    hidden: boolean;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
}

const idxUidDeletedTemplateTypeOrder = 'IDX_transaction_template_uid_deleted_template_type_order';
const idxDeletedTypeFreqTypeScheduledTime = 'IDX_transaction_template_deleted_type_freqtype_scheduled_time';

export const TransactionTemplateTable = defineTable<TransactionTemplate>('transaction_template', [
    ['template_id', 'id', { pk: true }],
    ['uid', 'id', { notNull: true, index: [idxUidDeletedTemplateTypeOrder] }],
    ['deleted', 'bool', { notNull: true, index: [idxUidDeletedTemplateTypeOrder, idxDeletedTypeFreqTypeScheduledTime] }],
    ['template_type', 'u8', { notNull: true, index: [idxUidDeletedTemplateTypeOrder, idxDeletedTypeFreqTypeScheduledTime] }],
    ['name', 'str', { length: 64, notNull: true }],
    ['type', 'u8', { notNull: true }],
    ['category_id', 'id', { notNull: true }],
    ['account_id', 'id', { notNull: true }],
    ['scheduled_frequency_type', 'u8', { index: [idxDeletedTypeFreqTypeScheduledTime] }],
    ['scheduled_frequency', 'str', { length: 100 }],
    ['scheduled_start_time', 'ni64', { index: [idxDeletedTypeFreqTypeScheduledTime] }],
    ['scheduled_end_time', 'ni64', { index: [idxDeletedTypeFreqTypeScheduledTime] }],
    ['scheduled_at', 'i16', { index: [idxDeletedTypeFreqTypeScheduledTime] }],
    ['scheduled_timezone_utc_offset', 'i16'],
    ['tag_ids', 'str', { length: 255, notNull: true }],
    ['amount', 'i64', { notNull: true }],
    ['related_account_id', 'id', { notNull: true }],
    ['related_account_amount', 'i64', { notNull: true }],
    ['hide_amount', 'bool', { notNull: true }],
    ['comment', 'str', { length: 255, notNull: true }],
    ['display_order', 'i32', { notNull: true, index: [idxUidDeletedTemplateTypeOrder] }],
    ['hidden', 'bool', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
]);

export function newTransactionTemplate(values: Partial<TransactionTemplate> = {}): TransactionTemplate {
    return {
        templateId: 0n,
        uid: 0n,
        deleted: false,
        templateType: 0,
        name: '',
        type: 0,
        categoryId: 0n,
        accountId: 0n,
        scheduledFrequencyType: 0,
        scheduledFrequency: '',
        scheduledStartTime: null,
        scheduledEndTime: null,
        scheduledAt: 0,
        scheduledTimezoneUtcOffset: 0,
        tagIds: '',
        amount: 0,
        relatedAccountId: 0n,
        relatedAccountAmount: 0,
        hideAmount: false,
        comment: '',
        displayOrder: 0,
        hidden: false,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        ...values,
    };
}

export interface TransactionTemplateListRequest {
    templateType: TransactionTemplateType;
}

export interface TransactionTemplateGetRequest {
    id: bigint;
}

export interface TransactionTemplateCreateRequest {
    templateType: TransactionTemplateType;
    name: string;
    type: TransactionType;
    categoryId: bigint;
    sourceAccountId: bigint;
    destinationAccountId: bigint;
    sourceAmount: number;
    destinationAmount: number;
    hideAmount: boolean;
    tagIds: string[] | null;
    comment: string;
    scheduledFrequencyType: number | null;
    scheduledFrequency: string | null;
    scheduledStartDate: string | null;
    scheduledEndDate: string | null;
    utcOffset: number | null;
    clientSessionId: string;
}

export interface TransactionTemplateModifyRequest {
    id: bigint;
    name: string;
    type: TransactionType;
    categoryId: bigint;
    sourceAccountId: bigint;
    destinationAccountId: bigint;
    sourceAmount: number;
    destinationAmount: number;
    hideAmount: boolean;
    tagIds: string[] | null;
    comment: string;
    scheduledFrequencyType: number | null;
    scheduledFrequency: string | null;
    scheduledStartDate: string | null;
    scheduledEndDate: string | null;
    utcOffset: number | null;
}

export interface TransactionTemplateHideRequest {
    id: bigint;
    hidden: boolean;
}

export interface TransactionTemplateNewDisplayOrderRequest {
    id: bigint;
    displayOrder: number;
}

export interface TransactionTemplateMoveRequest {
    newDisplayOrders: TransactionTemplateNewDisplayOrderRequest[];
}

export interface TransactionTemplateDeleteRequest {
    id: bigint;
}

export type TransactionTemplateInfoResponse = TransactionInfoResponse & {
    templateType: TransactionTemplateType;
    name: string;
    scheduledFrequencyType?: number;
    scheduledFrequency?: string;
    scheduledStartDate: string | null;
    scheduledEndDate: string | null;
    scheduledAt?: number;
    displayOrder: number;
    hidden: boolean;
};

export function getTemplateTagIds(t: TransactionTemplate): bigint[] {
    if (t.tagIds === '') {
        return [];
    }

    try {
        return t.tagIds.split(',').map(id => BigInt(id));
    } catch {
        return [];
    }
}

export function toTransactionTemplateInfoResponse(t: TransactionTemplate, serverUtcOffset: number): TransactionTemplateInfoResponse {
    let utcOffset = serverUtcOffset;

    if (t.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        utcOffset = t.scheduledTimezoneUtcOffset;
    }

    const response: Record<string, unknown> = {
        ...templateToTransactionInfoResponse(t, utcOffset),
        templateType: t.templateType,
        name: t.name,
    };

    let scheduledStartDate: string | null = null;
    let scheduledEndDate: string | null = null;

    if (t.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        response['scheduledFrequencyType'] = t.scheduledFrequencyType;
        response['scheduledFrequency'] = t.scheduledFrequency;

        const templateTimeZone = fixedZone(t.scheduledTimezoneUtcOffset);

        if (t.scheduledStartTime !== null) {
            scheduledStartDate = formatUnixTimeToLongDate(t.scheduledStartTime, templateTimeZone);
        }

        if (t.scheduledEndTime !== null) {
            scheduledEndDate = formatUnixTimeToLongDate(t.scheduledEndTime, templateTimeZone);
        }
    }

    response['scheduledStartDate'] = scheduledStartDate;
    response['scheduledEndDate'] = scheduledEndDate;

    if (t.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        response['scheduledAt'] = t.scheduledAt;
    }

    response['displayOrder'] = t.displayOrder;
    response['hidden'] = t.hidden;

    return response as unknown as TransactionTemplateInfoResponse;
}

function templateToTransactionInfoResponse(t: TransactionTemplate, utcOffset: number): TransactionInfoResponse {
    const tagIds = t.tagIds !== '' ? t.tagIds.split(',') : [];
    let destinationAmount: number | undefined;

    if (t.type === TRANSACTION_TYPE_TRANSFER) {
        destinationAmount = t.relatedAccountAmount;
    }

    return buildTransactionInfoResponse({
        id: t.templateId,
        timeSequenceId: BigInt(getMinTransactionTimeFromUnixTime(t.createdUnixTime)),
        type: t.type,
        categoryId: t.categoryId,
        time: 0,
        utcOffset: utcOffset,
        sourceAccountId: t.accountId,
        destinationAccountId: t.relatedAccountId,
        sourceAmount: t.amount,
        destinationAmount: destinationAmount,
        hideAmount: t.hideAmount,
        tagIds: tagIds,
        comment: t.comment,
        editable: true,
    });
}
