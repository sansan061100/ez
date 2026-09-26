import * as errs from '../errs/index';
import * as log from '../log/index';
import { newTransactionTagGroup, sortByDisplayOrder, type TransactionTagGroupCreateRequest, type TransactionTagGroupModifyRequest, toTransactionTagGroupInfoResponse } from '../models/index';
import { TransactionTagGroups } from '../services/transaction_tag_groups';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery } from './base';
import { callOrFail } from './common';
import { IdDeleteRequestSchema, IdQueryRequestSchema, MoveRequestSchema, TransactionTagGroupCreateRequestSchema, TransactionTagGroupModifyRequestSchema } from './schemas';

const P = 'transaction_tag_groups';

// tagGroupListHandler returns transaction tag group list of current user
export async function tagGroupListHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    const tagGroups = await callOrFail(c, () => TransactionTagGroups.getAllTagGroupsByUid(c, uid), () => `[${P}.TagGroupListHandler] failed to get tag groups for user "uid:${uid}"`);
    return sortByDisplayOrder(tagGroups.map(toTransactionTagGroupInfoResponse));
}

// tagGroupGetHandler returns one specific transaction tag group of current user
export async function tagGroupGetHandler(c: WebContext): Promise<unknown> {
    const req = bindQuery<{ id: bigint }>(c, IdQueryRequestSchema, `${P}.TagGroupGetHandler`);
    const uid = c.getCurrentUid();
    const tagGroup = await callOrFail(c, () => TransactionTagGroups.getTagGroupByTagGroupId(c, uid, req.id), () => `[${P}.TagGroupGetHandler] failed to get tag group "id:${req.id}" for user "uid:${uid}"`);
    return toTransactionTagGroupInfoResponse(tagGroup);
}

// tagGroupCreateHandler saves a new transaction tag group by request parameters for current user
export async function tagGroupCreateHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<TransactionTagGroupCreateRequest>(c, TransactionTagGroupCreateRequestSchema, `${P}.TagGroupCreateHandler`);
    const uid = c.getCurrentUid();
    const maxOrderId = await callOrFail(c, () => TransactionTagGroups.getMaxDisplayOrder(c, uid), () => `[${P}.TagGroupCreateHandler] failed to get max display order for user "uid:${uid}"`);
    const tagGroup = newTransactionTagGroup({ uid: uid, name: req.name, displayOrder: maxOrderId + 1 });

    await callOrFail(c, () => TransactionTagGroups.createTagGroup(c, tagGroup), () => `[${P}.TagGroupCreateHandler] failed to create tag group "id:${tagGroup.tagGroupId}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.TagGroupCreateHandler] user "uid:${uid}" has created a new tag group "id:${tagGroup.tagGroupId}" successfully`);

    return toTransactionTagGroupInfoResponse(tagGroup);
}

// tagGroupModifyHandler saves an existed transaction tag group by request parameters for current user
export async function tagGroupModifyHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<TransactionTagGroupModifyRequest>(c, TransactionTagGroupModifyRequestSchema, `${P}.TagGroupModifyHandler`);
    const uid = c.getCurrentUid();
    const tagGroup = await callOrFail(c, () => TransactionTagGroups.getTagGroupByTagGroupId(c, uid, req.id), () => `[${P}.TagGroupModifyHandler] failed to get tag group "id:${req.id}" for user "uid:${uid}"`);
    const newTagGroup = newTransactionTagGroup({ tagGroupId: tagGroup.tagGroupId, uid: uid, name: req.name });

    if (newTagGroup.name === tagGroup.name) {
        throw errs.ErrNothingWillBeUpdated;
    }

    await callOrFail(c, () => TransactionTagGroups.modifyTagGroup(c, newTagGroup), () => `[${P}.TagGroupModifyHandler] failed to update tag group "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.TagGroupModifyHandler] user "uid:${uid}" has updated tag group "id:${req.id}" successfully`);

    tagGroup.name = newTagGroup.name;
    return toTransactionTagGroupInfoResponse(tagGroup);
}

// tagGroupMoveHandler moves display order of existed transaction tag groups by request parameters for current user
export async function tagGroupMoveHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ newDisplayOrders: { id: bigint; displayOrder: number }[] }>(c, MoveRequestSchema, `${P}.TagGroupMoveHandler`);
    const uid = c.getCurrentUid();
    const tagGroups = req.newDisplayOrders.map(item => newTransactionTagGroup({ uid: uid, tagGroupId: item.id, displayOrder: item.displayOrder }));

    await callOrFail(c, () => TransactionTagGroups.modifyTagGroupDisplayOrders(c, uid, tagGroups), () => `[${P}.TagGroupMoveHandler] failed to move tag groups for user "uid:${uid}"`);
    log.infof(c, `[${P}.TagGroupMoveHandler] user "uid:${uid}" has moved tag groups`);
    return true;
}

// tagGroupDeleteHandler deletes an existed transaction tag group by request parameters for current user
export async function tagGroupDeleteHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.TagGroupDeleteHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => TransactionTagGroups.deleteTagGroup(c, uid, req.id), () => `[${P}.TagGroupDeleteHandler] failed to delete tag group "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.TagGroupDeleteHandler] user "uid:${uid}" has deleted tag group "id:${req.id}"`);
    return true;
}
