import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { type InsightsExplorer, InsightsExplorerTable } from '../models/index';
import { UUID_TYPE_EXPLORER } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

// InsightsExplorerService represents insights explorer service
export class InsightsExplorerService extends ServiceBase {
    // getTotalExplorationsCountByUid returns total explorations count of user
    public async getTotalExplorationsCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).count(InsightsExplorerTable);
    }

    // getAllExplorationNamesByUid returns all insights explorer names of user
    public async getAllExplorationNamesByUid(c: Context, uid: bigint): Promise<InsightsExplorer[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).select('explorer_id, uid, name, display_order, hidden').where('uid=? AND deleted=?', uid, false).find(InsightsExplorerTable);
    }

    // getExplorationByExplorationId returns an insights explorer model according to explorer id
    public async getExplorationByExplorationId(c: Context, uid: bigint, explorationId: bigint): Promise<InsightsExplorer> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (explorationId <= 0n) {
            throw errs.ErrInsightsExplorerIdInvalid;
        }

        const exploration = await this.userDataDB(uid).newSession(c).id(explorationId).where('uid=? AND deleted=?', uid, false).get(InsightsExplorerTable);

        if (!exploration) {
            throw errs.ErrInsightsExplorerNotFound;
        }

        return exploration;
    }

    // getMaxDisplayOrder returns the max display order
    public async getMaxDisplayOrder(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const exploration = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'display_order').where('uid=? AND deleted=?', uid, false).orderBy('display_order desc').limit(1).get(InsightsExplorerTable);
        return exploration ? exploration.displayOrder : 0;
    }

    // createExploration saves a new insights explorer model to database
    public async createExploration(c: Context, exploration: InsightsExplorer): Promise<void> {
        if (exploration.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        exploration.explorerId = this.generateUuid(UUID_TYPE_EXPLORER);

        if (exploration.explorerId < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        exploration.deleted = false;
        exploration.createdUnixTime = nowUnix();
        exploration.updatedUnixTime = nowUnix();

        await this.userDataDB(exploration.uid).doTransaction(c, async sess => {
            await sess.insert(InsightsExplorerTable, exploration);
        });
    }

    // modifyExploration saves an existed insights explorer model to database
    public async modifyExploration(c: Context, exploration: InsightsExplorer): Promise<void> {
        if (exploration.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        exploration.updatedUnixTime = nowUnix();

        await this.userDataDB(exploration.uid).doTransaction(c, async sess => {
            const updatedRows = await sess.id(exploration.explorerId).cols('name', 'data', 'updated_unix_time').where('uid=? AND deleted=?', exploration.uid, false).update(InsightsExplorerTable, exploration);

            if (updatedRows < 1) {
                throw errs.ErrInsightsExplorerNotFound;
            }
        });
    }

    // hideExploration updates hidden field of given insights explorers
    public async hideExploration(c: Context, uid: bigint, ids: bigint[], hidden: boolean): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<InsightsExplorer> = {
            hidden: hidden,
            updatedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const updatedRows = await sess.cols('hidden', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).in('explorer_id', ids).update(InsightsExplorerTable, updateModel);

            if (updatedRows < 1) {
                throw errs.ErrInsightsExplorerNotFound;
            }
        });
    }

    // modifyExplorationDisplayOrders updates display order of given insights explorers
    public async modifyExplorationDisplayOrders(c: Context, uid: bigint, explorations: InsightsExplorer[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const exploration of explorations) {
            exploration.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const exploration of explorations) {
                const updatedRows = await sess.id(exploration.explorerId).cols('display_order', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(InsightsExplorerTable, exploration);

                if (updatedRows < 1) {
                    throw errs.ErrInsightsExplorerNotFound;
                }
            }
        });
    }

    // deleteExploration deletes an existed insights explorer from database
    public async deleteExploration(c: Context, uid: bigint, explorerId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<InsightsExplorer> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const deletedRows = await sess.id(explorerId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(InsightsExplorerTable, updateModel);

            if (deletedRows < 1) {
                throw errs.ErrInsightsExplorerNotFound;
            }
        });
    }

    // deleteAllExplorations deletes all existed insights explorers from database
    public async deleteAllExplorations(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<InsightsExplorer> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(InsightsExplorerTable, updateModel);
        });
    }
}

export const InsightsExplorers = new InsightsExplorerService();
