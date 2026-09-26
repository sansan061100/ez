import { DUPLICATE_CHECKER_TYPE_NEW_TEMPLATE } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    newTransactionTemplate,
    sortByDisplayOrder,
    type TransactionTemplate,
    type TransactionTemplateCreateRequest,
    type TransactionTemplateModifyRequest,
    toTransactionTemplateInfoResponse,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS,
    TRANSACTION_TEMPLATE_TYPE_NORMAL,
    TRANSACTION_TEMPLATE_TYPE_SCHEDULE,
    TRANSACTION_TYPE_MODIFY_BALANCE,
    TRANSACTION_TYPE_TRANSFER,
} from '../models/index';
import { TransactionTemplates } from '../services/transaction_templates';
import { stringToInt, stringToInt64 } from '../utils/converter';
import { getServerTimezoneOffsetMinutes, parseFromLongDateFirstTime, parseFromLongDateLastTime } from '../utils/datetimes';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery, currentConfig, errMsg, getSubmissionRemark, setSubmissionRemarkIfEnable } from './base';
import { callOrFail } from './common';
import { IdDeleteRequestSchema, IdHideRequestSchema, IdQueryRequestSchema, MoveRequestSchema, TransactionTemplateCreateRequestSchema, TransactionTemplateListRequestSchema, TransactionTemplateModifyRequestSchema } from './schemas';

const P = 'transaction_templates';
const maximumTagsCountOfTemplate = 10;

interface ScheduledFields {
    scheduledFrequencyType: number | null;
    scheduledFrequency: string | null;
    scheduledStartDate: string | null;
    scheduledEndDate: string | null;
    utcOffset: number | null;
}

function tryStringToInt(s: string): number | null {
    try {
        return stringToInt(s);
    } catch {
        return null;
    }
}

function checkScheduledFields(req: ScheduledFields): void {
    if (req.scheduledFrequencyType === null || req.scheduledFrequency === null || req.utcOffset === null) {
        throw errs.ErrScheduledTransactionFrequencyInvalid;
    }

    if (req.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED && req.scheduledFrequency !== '') {
        throw errs.ErrScheduledTransactionFrequencyInvalid;
    } else if (req.scheduledFrequencyType !== TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED && req.scheduledFrequency === '') {
        throw errs.ErrScheduledTransactionFrequencyInvalid;
    }

    if (req.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS) {
        const frequencyValue = tryStringToInt(req.scheduledFrequency);

        if (frequencyValue === null || frequencyValue <= 0) {
            throw errs.ErrScheduledTransactionFrequencyInvalid;
        }
    }

    if (req.scheduledFrequencyType === TRANSACTION_SCHEDULE_FREQUENCY_TYPE_EVERY_N_DAYS && req.scheduledStartDate === null) {
        throw errs.ErrScheduledTransactionStartDateRequired;
    }
}

function getUTCScheduledAt(scheduledTimezoneUtcOffset: number): number {
    return (((-scheduledTimezoneUtcOffset) % 1440) + 1440) % 1440;
}

function getOrderedFrequencyValues(frequencyValue: string): string {
    if (frequencyValue === '') {
        return '';
    }

    const values: number[] = [];
    const valueExistMap = new Set<number>();

    for (const item of frequencyValue.split(',')) {
        const value = tryStringToInt(item);

        if (value === null) {
            continue;
        }

        if (!valueExistMap.has(value)) {
            values.push(value);
            valueExistMap.add(value);
        }
    }

    values.sort((a, b) => a - b);
    return values.join(',');
}

// fillScheduledFields fills the scheduled fields of template (request fields must be checked before)
function fillScheduledFields(template: TransactionTemplate, req: ScheduledFields): void {
    const utcOffset = req.utcOffset as number;
    template.scheduledFrequencyType = req.scheduledFrequencyType as number;
    template.scheduledFrequency = getOrderedFrequencyValues(req.scheduledFrequency as string);
    template.scheduledAt = getUTCScheduledAt(utcOffset);
    template.scheduledTimezoneUtcOffset = utcOffset;

    if (req.scheduledStartDate !== null) {
        template.scheduledStartTime = Math.floor(parseFromLongDateFirstTime(req.scheduledStartDate, utcOffset).toSeconds());
    }

    if (req.scheduledEndDate !== null) {
        template.scheduledEndTime = Math.floor(parseFromLongDateLastTime(req.scheduledEndDate, utcOffset).toSeconds());
    }

    if (template.scheduledStartTime !== null && template.scheduledEndTime !== null && template.scheduledStartTime > template.scheduledEndTime) {
        throw errs.ErrScheduledTransactionTemplateStartDataLaterThanEndDate;
    }
}

function checkScheduledTransactionEnabled(templateType: number): void {
    if (templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE && !currentConfig().enableScheduledTransaction) {
        throw errs.ErrScheduledTransactionNotEnabled;
    }
}

async function getTemplateOrFail(c: WebContext, uid: bigint, id: bigint, handler: string): Promise<TransactionTemplate> {
    return callOrFail(c, () => TransactionTemplates.getTemplateByTemplateId(c, uid, id), () => `[${P}.${handler}] failed to get template "id:${id}" for user "uid:${uid}"`);
}

// templateListHandler returns transaction template list of current user
export async function templateListHandler(c: WebContext): Promise<unknown> {
    const req = bindQuery<{ templateType: number }>(c, TransactionTemplateListRequestSchema, `${P}.TemplateListHandler`);

    if (req.templateType < TRANSACTION_TEMPLATE_TYPE_NORMAL || req.templateType > TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        log.warnf(c, `[${P}.TemplateListHandler] template type invalid, type is ${req.templateType}`);
        throw errs.ErrTransactionTemplateTypeInvalid;
    }

    checkScheduledTransactionEnabled(req.templateType);

    const uid = c.getCurrentUid();
    const templates = await callOrFail(c, () => TransactionTemplates.getAllTemplatesByUid(c, uid, req.templateType), () => `[${P}.TemplateListHandler] failed to get templates for user "uid:${uid}"`);
    const serverUtcOffset = getServerTimezoneOffsetMinutes();

    return sortByDisplayOrder(templates.map(template => toTransactionTemplateInfoResponse(template, serverUtcOffset)));
}

// templateGetHandler returns one specific transaction template of current user
export async function templateGetHandler(c: WebContext): Promise<unknown> {
    const req = bindQuery<{ id: bigint }>(c, IdQueryRequestSchema, `${P}.TemplateGetHandler`);
    const uid = c.getCurrentUid();
    const template = await getTemplateOrFail(c, uid, req.id, 'TemplateGetHandler');
    checkScheduledTransactionEnabled(template.templateType);

    return toTransactionTemplateInfoResponse(template, getServerTimezoneOffsetMinutes());
}

// templateCreateHandler saves a new transaction template by request parameters for current user
export async function templateCreateHandler(c: WebContext): Promise<unknown> {
    const handler = 'TemplateCreateHandler';
    const req = await bindJson<TransactionTemplateCreateRequest>(c, TransactionTemplateCreateRequestSchema, `${P}.${handler}`);

    if (req.templateType < TRANSACTION_TEMPLATE_TYPE_NORMAL || req.templateType > TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        log.warnf(c, `[${P}.${handler}] template type invalid, type is ${req.templateType}`);
        throw errs.ErrTransactionTemplateTypeInvalid;
    }

    checkScheduledTransactionEnabled(req.templateType);

    if (req.type <= TRANSACTION_TYPE_MODIFY_BALANCE || req.type > TRANSACTION_TYPE_TRANSFER) {
        log.warnf(c, `[${P}.${handler}] transaction type invalid, type is ${req.type}`);
        throw errs.ErrTransactionTypeInvalid;
    }

    if (req.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        checkScheduledFields(req);
    }

    const tagIds = req.tagIds ?? [];

    if (tagIds.length > maximumTagsCountOfTemplate) {
        throw errs.ErrTransactionTemplateHasTooManyTags;
    }

    const uid = c.getCurrentUid();
    const maxOrderId = await callOrFail(c, () => TransactionTemplates.getMaxDisplayOrder(c, uid, req.templateType), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);
    const serverUtcOffset = getServerTimezoneOffsetMinutes();

    let template = newTransactionTemplate({
        uid: uid,
        templateType: req.templateType,
        name: req.name,
        type: req.type,
        categoryId: req.categoryId,
        accountId: req.sourceAccountId,
        tagIds: tagIds.join(','),
        amount: req.sourceAmount,
        relatedAccountId: req.destinationAccountId,
        relatedAccountAmount: req.destinationAmount,
        hideAmount: req.hideAmount,
        comment: req.comment,
        displayOrder: maxOrderId + 1,
    });

    if (req.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        try {
            fillScheduledFields(template, req);
        } catch (err) {
            log.errorf(c, `[${P}.${handler}] failed to create new template for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }
    }

    if (currentConfig().enableDuplicateSubmissionsCheck && req.clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_NEW_TEMPLATE, uid, req.clientSessionId);

        if (found) {
            log.infof(c, `[${P}.${handler}] another template "id:${remark}" has been created for user "uid:${uid}"`);
            let templateId: bigint | null = null;

            try {
                templateId = stringToInt64(remark);
            } catch {
                templateId = null;
            }

            if (templateId !== null) {
                const id = templateId;
                template = await callOrFail(c, () => TransactionTemplates.getTemplateByTemplateId(c, uid, id), () => `[${P}.${handler}] failed to get existed template "id:${id}" for user "uid:${uid}"`);
                return toTransactionTemplateInfoResponse(template, serverUtcOffset);
            }
        }
    }

    const newTemplate = template;
    await callOrFail(c, () => TransactionTemplates.createTemplate(c, newTemplate), () => `[${P}.${handler}] failed to create template "id:${newTemplate.templateId}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has created a new template "id:${newTemplate.templateId}" successfully`);

    setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_NEW_TEMPLATE, uid, req.clientSessionId, newTemplate.templateId.toString());
    return toTransactionTemplateInfoResponse(newTemplate, serverUtcOffset);
}

// templateModifyHandler saves an existed transaction template by request parameters for current user
export async function templateModifyHandler(c: WebContext): Promise<unknown> {
    const handler = 'TemplateModifyHandler';
    const req = await bindJson<TransactionTemplateModifyRequest>(c, TransactionTemplateModifyRequestSchema, `${P}.${handler}`);

    if (req.type <= TRANSACTION_TYPE_MODIFY_BALANCE || req.type > TRANSACTION_TYPE_TRANSFER) {
        log.warnf(c, `[${P}.${handler}] transaction type invalid, type is ${req.type}`);
        throw errs.ErrTransactionTypeInvalid;
    }

    const uid = c.getCurrentUid();
    const template = await getTemplateOrFail(c, uid, req.id, handler);
    checkScheduledTransactionEnabled(template.templateType);

    if (template.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        checkScheduledFields(req);
    }

    const tagIds = req.tagIds ?? [];

    if (tagIds.length > maximumTagsCountOfTemplate) {
        throw errs.ErrTransactionTemplateHasTooManyTags;
    }

    const newTemplate = newTransactionTemplate({
        templateId: template.templateId,
        uid: uid,
        name: req.name,
        type: req.type,
        categoryId: req.categoryId,
        accountId: req.sourceAccountId,
        tagIds: tagIds.join(','),
        amount: req.sourceAmount,
        relatedAccountId: req.destinationAccountId,
        relatedAccountAmount: req.destinationAmount,
        hideAmount: req.hideAmount,
        comment: req.comment,
    });

    if (template.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
        try {
            fillScheduledFields(newTemplate, req);
        } catch (err) {
            if (err instanceof errs.AppError && err.is(errs.ErrScheduledTransactionTemplateStartDataLaterThanEndDate)) {
                throw err;
            }

            log.errorf(c, `[${P}.${handler}] failed to parse scheduled date for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }
    }

    if (newTemplate.name === template.name &&
        newTemplate.type === template.type &&
        newTemplate.categoryId === template.categoryId &&
        newTemplate.accountId === template.accountId &&
        newTemplate.tagIds === template.tagIds &&
        newTemplate.amount === template.amount &&
        newTemplate.relatedAccountId === template.relatedAccountId &&
        newTemplate.relatedAccountAmount === template.relatedAccountAmount &&
        newTemplate.hideAmount === template.hideAmount &&
        newTemplate.comment === template.comment) {
        if (template.templateType === TRANSACTION_TEMPLATE_TYPE_NORMAL) {
            throw errs.ErrNothingWillBeUpdated;
        } else if (template.templateType === TRANSACTION_TEMPLATE_TYPE_SCHEDULE) {
            // go compares the pointers of start/end time, which are only equal when both are nil
            if (newTemplate.scheduledFrequencyType === template.scheduledFrequencyType &&
                newTemplate.scheduledFrequency === template.scheduledFrequency &&
                newTemplate.scheduledStartTime === null && template.scheduledStartTime === null &&
                newTemplate.scheduledEndTime === null && template.scheduledEndTime === null &&
                newTemplate.scheduledAt === template.scheduledAt &&
                newTemplate.scheduledTimezoneUtcOffset === template.scheduledTimezoneUtcOffset) {
                throw errs.ErrNothingWillBeUpdated;
            }
        }
    }

    await callOrFail(c, () => TransactionTemplates.modifyTemplate(c, newTemplate), () => `[${P}.${handler}] failed to update template "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has updated template "id:${req.id}" successfully`);

    newTemplate.templateType = template.templateType;
    newTemplate.displayOrder = template.displayOrder;
    newTemplate.hidden = template.hidden;
    return toTransactionTemplateInfoResponse(newTemplate, getServerTimezoneOffsetMinutes());
}

// templateHideHandler hides a transaction template by request parameters for current user
export async function templateHideHandler(c: WebContext): Promise<unknown> {
    const handler = 'TemplateHideHandler';
    const req = await bindJson<{ id: bigint; hidden: boolean }>(c, IdHideRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const template = await getTemplateOrFail(c, uid, req.id, handler);
    checkScheduledTransactionEnabled(template.templateType);

    await callOrFail(c, () => TransactionTemplates.hideTemplate(c, uid, [req.id], req.hidden), () => `[${P}.${handler}] failed to hide template "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has hidden template "id:${req.id}"`);
    return true;
}

// templateMoveHandler moves display order of existed transaction templates by request parameters for current user
export async function templateMoveHandler(c: WebContext): Promise<unknown> {
    const handler = 'TemplateMoveHandler';
    const req = await bindJson<{ newDisplayOrders: { id: bigint; displayOrder: number }[] }>(c, MoveRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const first = req.newDisplayOrders[0];

    if (first) {
        const template = await getTemplateOrFail(c, uid, first.id, handler);
        checkScheduledTransactionEnabled(template.templateType);
    }

    const templates = req.newDisplayOrders.map(item => newTransactionTemplate({ uid: uid, templateId: item.id, displayOrder: item.displayOrder }));

    await callOrFail(c, () => TransactionTemplates.modifyTemplateDisplayOrders(c, uid, templates), () => `[${P}.${handler}] failed to move templates for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has moved templates`);
    return true;
}

// templateDeleteHandler deletes an existed transaction template by request parameters for current user
export async function templateDeleteHandler(c: WebContext): Promise<unknown> {
    const handler = 'TemplateDeleteHandler';
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const template = await getTemplateOrFail(c, uid, req.id, handler);
    checkScheduledTransactionEnabled(template.templateType);

    await callOrFail(c, () => TransactionTemplates.deleteTemplate(c, uid, req.id), () => `[${P}.${handler}] failed to delete template "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has deleted template "id:${req.id}"`);
    return true;
}
