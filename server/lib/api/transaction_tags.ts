import * as errs from '../errs/index';
import * as log from '../log/index';
import { newTransactionTag, sortTransactionTagInfoResponses, type TransactionTag, type TransactionTagCreateBatchRequest, type TransactionTagCreateRequest, type TransactionTagModifyRequest, toTransactionTagInfoResponse } from '../models/index';
import { TransactionTagGroups } from '../services/transaction_tag_groups';
import { TransactionTags } from '../services/transaction_tags';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery } from './base';
import { callOrFail } from './common';
import { IdDeleteRequestSchema, IdHideRequestSchema, IdQueryRequestSchema, MoveRequestSchema, TransactionTagCreateBatchRequestSchema, TransactionTagCreateRequestSchema, TransactionTagModifyRequestSchema } from './schemas';

const P = 'transaction_tags';

async function checkTagGroupExists(c: WebContext, uid: bigint, groupId: bigint, handler: string): Promise<void> {
    const tagGroup = await callOrFail(c, () => TransactionTagGroups.getTagGroupByTagGroupId(c, uid, groupId), () => `[${P}.${handler}] failed to get tag group "id:${groupId}" for user "uid:${uid}"`);

    if (!tagGroup) {
        log.warnf(c, `[${P}.${handler}] the tag group "id:${groupId}" does not exist for user "uid:${uid}"`);
        throw errs.ErrTransactionTagGroupNotFound;
    }
}

function createNewTagModel(uid: bigint, req: TransactionTagCreateRequest, order: number): TransactionTag {
    return newTransactionTag({ uid: uid, name: req.name, tagGroupId: req.groupId, displayOrder: order });
}

// tagListHandler returns transaction tag list of current user
export async function tagListHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    const tags = await callOrFail(c, () => TransactionTags.getAllTagsByUid(c, uid), () => `[${P}.TagListHandler] failed to get tags for user "uid:${uid}"`);
    return sortTransactionTagInfoResponses(tags.map(toTransactionTagInfoResponse));
}

// tagGetHandler returns one specific transaction tag of current user
export async function tagGetHandler(c: WebContext): Promise<unknown> {
    const req = bindQuery<{ id: bigint }>(c, IdQueryRequestSchema, `${P}.TagGetHandler`);
    const uid = c.getCurrentUid();
    const tag = await callOrFail(c, () => TransactionTags.getTagByTagId(c, uid, req.id), () => `[${P}.TagGetHandler] failed to get tag "id:${req.id}" for user "uid:${uid}"`);
    return toTransactionTagInfoResponse(tag);
}

// tagCreateHandler saves a new transaction tag by request parameters for current user
export async function tagCreateHandler(c: WebContext): Promise<unknown> {
    const handler = 'TagCreateHandler';
    const req = await bindJson<TransactionTagCreateRequest>(c, TransactionTagCreateRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();

    if (req.groupId > 0n) {
        await checkTagGroupExists(c, uid, req.groupId, handler);
    }

    const maxOrderId = await callOrFail(c, () => TransactionTags.getMaxDisplayOrder(c, uid, req.groupId), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);
    const tag = createNewTagModel(uid, req, maxOrderId + 1);

    await callOrFail(c, () => TransactionTags.createTag(c, tag), () => `[${P}.${handler}] failed to create tag "id:${tag.tagId}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has created a new tag "id:${tag.tagId}" successfully`);

    return toTransactionTagInfoResponse(tag);
}

// tagCreateBatchHandler saves some new transaction tags by request parameters for current user
export async function tagCreateBatchHandler(c: WebContext): Promise<unknown> {
    const handler = 'TagCreateBatchHandler';
    const req = await bindJson<TransactionTagCreateBatchRequest>(c, TransactionTagCreateBatchRequestSchema, `${P}.${handler}`);
    const reqTags = req.tags ?? [];

    for (let i = 0; i < reqTags.length; i++) {
        const reqTag = reqTags[i] as TransactionTagCreateRequest;

        if (reqTag.groupId !== req.groupId) {
            log.warnf(c, `[${P}.${handler}] the group id "${reqTag.groupId}" of tag#${i} is inconsistent with the batch group id "${req.groupId}"`);
            throw errs.ErrTransactionTagGroupIdInvalid;
        }
    }

    const uid = c.getCurrentUid();

    if (req.groupId > 0n) {
        await checkTagGroupExists(c, uid, req.groupId, handler);
    }

    const maxOrderId = await callOrFail(c, () => TransactionTags.getMaxDisplayOrder(c, uid, req.groupId), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);
    const tags = reqTags.map((reqTag, i) => {
        const tag = createNewTagModel(uid, reqTag, maxOrderId + 1 + i);
        tag.tagGroupId = req.groupId;
        return tag;
    });

    await callOrFail(c, () => TransactionTags.createTags(c, uid, tags, req.skipExists), () => `[${P}.${handler}] failed to create tags for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has created tags successfully`);

    return sortTransactionTagInfoResponses(tags.map(toTransactionTagInfoResponse));
}

// tagModifyHandler saves an existed transaction tag by request parameters for current user
export async function tagModifyHandler(c: WebContext): Promise<unknown> {
    const handler = 'TagModifyHandler';
    const req = await bindJson<TransactionTagModifyRequest>(c, TransactionTagModifyRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const tag = await callOrFail(c, () => TransactionTags.getTagByTagId(c, uid, req.id), () => `[${P}.${handler}] failed to get tag "id:${req.id}" for user "uid:${uid}"`);

    if (req.groupId !== tag.tagGroupId && req.groupId > 0n) {
        await checkTagGroupExists(c, uid, req.groupId, handler);
    }

    const newTag = newTransactionTag({
        tagId: tag.tagId,
        uid: uid,
        name: req.name,
        tagGroupId: req.groupId,
        displayOrder: tag.displayOrder,
    });

    const tagNameChanged = newTag.name !== tag.name;

    if (!tagNameChanged && newTag.tagGroupId === tag.tagGroupId) {
        throw errs.ErrNothingWillBeUpdated;
    }

    if (newTag.tagGroupId !== tag.tagGroupId) {
        const maxOrderId = await callOrFail(c, () => TransactionTags.getMaxDisplayOrder(c, uid, newTag.tagGroupId), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);
        newTag.displayOrder = maxOrderId + 1;
    }

    await callOrFail(c, () => TransactionTags.modifyTag(c, newTag, tagNameChanged), () => `[${P}.${handler}] failed to update tag "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has updated tag "id:${req.id}" successfully`);

    tag.name = newTag.name;
    tag.tagGroupId = newTag.tagGroupId;
    tag.displayOrder = newTag.displayOrder;
    return toTransactionTagInfoResponse(tag);
}

// tagHideHandler hides an existed transaction tag by request parameters for current user
export async function tagHideHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint; hidden: boolean }>(c, IdHideRequestSchema, `${P}.TagHideHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => TransactionTags.hideTag(c, uid, [req.id], req.hidden), () => `[${P}.TagHideHandler] failed to hide tag "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.TagHideHandler] user "uid:${uid}" has hidden tag "id:${req.id}"`);
    return true;
}

// tagMoveHandler moves display order of existed transaction tags by request parameters for current user
export async function tagMoveHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ newDisplayOrders: { id: bigint; displayOrder: number }[] }>(c, MoveRequestSchema, `${P}.TagMoveHandler`);
    const uid = c.getCurrentUid();
    const tags = req.newDisplayOrders.map(item => newTransactionTag({ uid: uid, tagId: item.id, displayOrder: item.displayOrder }));

    await callOrFail(c, () => TransactionTags.modifyTagDisplayOrders(c, uid, tags), () => `[${P}.TagMoveHandler] failed to move tags for user "uid:${uid}"`);
    log.infof(c, `[${P}.TagMoveHandler] user "uid:${uid}" has moved tags`);
    return true;
}

// tagDeleteHandler deletes an existed transaction tag by request parameters for current user
export async function tagDeleteHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.TagDeleteHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => TransactionTags.deleteTag(c, uid, req.id), () => `[${P}.TagDeleteHandler] failed to delete tag "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.TagDeleteHandler] user "uid:${uid}" has deleted tag "id:${req.id}"`);
    return true;
}
