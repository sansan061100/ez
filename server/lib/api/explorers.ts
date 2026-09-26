import * as errs from '../errs/index';
import * as log from '../log/index';
import { type InsightsExplorer, type InsightsExplorerCreateRequest, type InsightsExplorerInfoResponse, type InsightsExplorerModifyRequest, sortByDisplayOrder, toInsightsExplorerInfoResponse } from '../models/index';
import { InsightsExplorers } from '../services/explorer';
import type { WebContext } from '../web/context';
import { goMarshalMap } from '../web/json';
import { bindJson, bindQuery, errMsg } from './base';
import { callOrFail } from './common';
import { IdDeleteRequestSchema, IdHideRequestSchema, IdQueryRequestSchema, InsightsExplorerCreateRequestSchema, InsightsExplorerModifyRequestSchema, MoveRequestSchema } from './schemas';

const P = 'explorers';

function toResponse(c: WebContext, explorer: InsightsExplorer, handler: string, uid: bigint): InsightsExplorerInfoResponse {
    try {
        return toInsightsExplorerInfoResponse(explorer);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get exploration response for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.ErrInsightsExplorerDataInvalid;
    }
}

// insightsExplorerListHandler returns insights explorer list of current user
export async function insightsExplorerListHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    const explorers = await callOrFail(c, () => InsightsExplorers.getAllExplorationNamesByUid(c, uid), () => `[${P}.InsightsExplorerListHandler] failed to get explorations for user "uid:${uid}"`);
    return sortByDisplayOrder(explorers.map(explorer => toResponse(c, explorer, 'InsightsExplorerListHandler', uid)));
}

// insightsExplorerGetHandler returns one specific insights explorer of current user
export async function insightsExplorerGetHandler(c: WebContext): Promise<unknown> {
    const req = bindQuery<{ id: bigint }>(c, IdQueryRequestSchema, `${P}.InsightsExplorerGetHandler`);
    const uid = c.getCurrentUid();
    const explorer = await callOrFail(c, () => InsightsExplorers.getExplorationByExplorationId(c, uid, req.id), () => `[${P}.InsightsExplorerGetHandler] failed to get exploration "id:${req.id}" for user "uid:${uid}"`);
    return toResponse(c, explorer, 'InsightsExplorerGetHandler', uid);
}

// insightsExplorerCreateHandler saves a new insights explorer by request parameters for current user
export async function insightsExplorerCreateHandler(c: WebContext): Promise<unknown> {
    const handler = 'InsightsExplorerCreateHandler';
    const req = await bindJson<InsightsExplorerCreateRequest>(c, InsightsExplorerCreateRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const maxOrderId = await callOrFail(c, () => InsightsExplorers.getMaxDisplayOrder(c, uid), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);

    const explorer: InsightsExplorer = {
        explorerId: 0n,
        uid: uid,
        deleted: false,
        name: req.name,
        displayOrder: maxOrderId + 1,
        data: goMarshalMap(req.data),
        hidden: false,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
    };

    await callOrFail(c, () => InsightsExplorers.createExploration(c, explorer), () => `[${P}.${handler}] failed to create exploration "id:${explorer.explorerId}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has created a new exploration "id:${explorer.explorerId}" successfully`);

    return toResponse(c, explorer, handler, uid);
}

// insightsExplorerModifyHandler saves an existed insights explorer by request parameters for current user
export async function insightsExplorerModifyHandler(c: WebContext): Promise<unknown> {
    const handler = 'InsightsExplorerModifyHandler';
    const req = await bindJson<InsightsExplorerModifyRequest>(c, InsightsExplorerModifyRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const explorer = await callOrFail(c, () => InsightsExplorers.getExplorationByExplorationId(c, uid, req.id), () => `[${P}.${handler}] failed to get exploration "id:${req.id}" for user "uid:${uid}"`);

    const newExplorer: InsightsExplorer = {
        ...explorer,
        uid: uid,
        name: req.name,
        data: goMarshalMap(req.data),
    };

    if (newExplorer.name === explorer.name && newExplorer.data === explorer.data) {
        throw errs.ErrNothingWillBeUpdated;
    }

    await callOrFail(c, () => InsightsExplorers.modifyExploration(c, newExplorer), () => `[${P}.${handler}] failed to update exploration "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has updated exploration "id:${req.id}" successfully`);

    explorer.name = newExplorer.name;
    explorer.data = newExplorer.data;
    return toResponse(c, explorer, handler, uid);
}

// insightsExplorerHideHandler hides an insights explorer by request parameters for current user
export async function insightsExplorerHideHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint; hidden: boolean }>(c, IdHideRequestSchema, `${P}.InsightsExplorerHideHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => InsightsExplorers.hideExploration(c, uid, [req.id], req.hidden), () => `[${P}.InsightsExplorerHideHandler] failed to hide exploration "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.InsightsExplorerHideHandler] user "uid:${uid}" has hidden exploration "id:${req.id}"`);
    return true;
}

// insightsExplorerMoveHandler moves display order of existed insights explorers by request parameters for current user
export async function insightsExplorerMoveHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ newDisplayOrders: { id: bigint; displayOrder: number }[] }>(c, MoveRequestSchema, `${P}.InsightsExplorerMoveHandler`);
    const uid = c.getCurrentUid();
    const explorers = req.newDisplayOrders.map(item => ({ uid: uid, explorerId: item.id, displayOrder: item.displayOrder } as InsightsExplorer));

    await callOrFail(c, () => InsightsExplorers.modifyExplorationDisplayOrders(c, uid, explorers), () => `[${P}.InsightsExplorerMoveHandler] failed to move explorations for user "uid:${uid}"`);
    log.infof(c, `[${P}.InsightsExplorerMoveHandler] user "uid:${uid}" has moved explorations`);
    return true;
}

// insightsExplorerDeleteHandler deletes an existed insights explorer by request parameters for current user
export async function insightsExplorerDeleteHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.InsightsExplorerDeleteHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => InsightsExplorers.deleteExploration(c, uid, req.id), () => `[${P}.InsightsExplorerDeleteHandler] failed to delete exploration "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.InsightsExplorerDeleteHandler] user "uid:${uid}" has deleted exploration "id:${req.id}"`);
    return true;
}
