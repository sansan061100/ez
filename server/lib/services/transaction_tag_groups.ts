import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { type TransactionTagGroup, TransactionTagGroupTable, TransactionTagTable } from '../models/index';
import { UUID_TYPE_TAG_GROUP } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

// TransactionTagGroupService represents transaction tag group service
export class TransactionTagGroupService extends ServiceBase {
    // getAllTagGroupsByUid returns all transaction tag group models of user
    public async getAllTagGroupsByUid(c: Context, uid: bigint): Promise<TransactionTagGroup[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).find(TransactionTagGroupTable);
    }

    // getTagGroupByTagGroupId returns a transaction tag group model according to transaction tag group id
    public async getTagGroupByTagGroupId(c: Context, uid: bigint, tagGroupId: bigint): Promise<TransactionTagGroup> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (tagGroupId <= 0n) {
            throw errs.ErrTransactionTagGroupIdInvalid;
        }

        const tagGroup = await this.userDataDB(uid).newSession(c).id(tagGroupId).where('uid=? AND deleted=?', uid, false).get(TransactionTagGroupTable);

        if (!tagGroup) {
            throw errs.ErrTransactionTagGroupNotFound;
        }

        return tagGroup;
    }

    // getMaxDisplayOrder returns the max display order
    public async getMaxDisplayOrder(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const tagGroup = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'display_order').where('uid=? AND deleted=?', uid, false).orderBy('display_order desc').limit(1).get(TransactionTagGroupTable);
        return tagGroup ? tagGroup.displayOrder : 0;
    }

    // createTagGroup saves a new transaction tag group model to database
    public async createTagGroup(c: Context, tagGroup: TransactionTagGroup): Promise<void> {
        if (tagGroup.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        tagGroup.tagGroupId = this.generateUuid(UUID_TYPE_TAG_GROUP);

        if (tagGroup.tagGroupId < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        tagGroup.deleted = false;
        tagGroup.createdUnixTime = nowUnix();
        tagGroup.updatedUnixTime = nowUnix();

        await this.userDataDB(tagGroup.uid).doTransaction(c, async sess => {
            await sess.insert(TransactionTagGroupTable, tagGroup);
        });
    }

    // modifyTagGroup saves an existed transaction tag group model to database
    public async modifyTagGroup(c: Context, tagGroup: TransactionTagGroup): Promise<void> {
        if (tagGroup.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        tagGroup.updatedUnixTime = nowUnix();

        await this.userDataDB(tagGroup.uid).doTransaction(c, async sess => {
            const updatedRows = await sess.id(tagGroup.tagGroupId).cols('name', 'updated_unix_time').where('uid=? AND deleted=?', tagGroup.uid, false).update(TransactionTagGroupTable, tagGroup);

            if (updatedRows < 1) {
                throw errs.ErrTransactionTagGroupNotFound;
            }
        });
    }

    // modifyTagGroupDisplayOrders updates display order of given transaction tag groups
    public async modifyTagGroupDisplayOrders(c: Context, uid: bigint, tagGroups: TransactionTagGroup[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const tagGroup of tagGroups) {
            tagGroup.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const tagGroup of tagGroups) {
                const updatedRows = await sess.id(tagGroup.tagGroupId).cols('display_order', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagGroupTable, tagGroup);

                if (updatedRows < 1) {
                    throw errs.ErrTransactionTagGroupNotFound;
                }
            }
        });
    }

    // deleteTagGroup deletes an existed transaction tag group from database
    public async deleteTagGroup(c: Context, uid: bigint, tagGroupId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionTagGroup> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const exists = await sess.cols('uid', 'deleted').where('uid=? AND deleted=? AND tag_group_id=?', uid, false, tagGroupId).limit(1).exist(TransactionTagTable);

            if (exists) {
                throw errs.ErrTransactionTagGroupInUseCannotBeDeleted;
            }

            const deletedRows = await sess.id(tagGroupId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagGroupTable, updateModel);

            if (deletedRows < 1) {
                throw errs.ErrTransactionTagGroupNotFound;
            }
        });
    }

    // deleteAllTagGroups deletes all existed transaction tag groups from database
    public async deleteAllTagGroups(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionTagGroup> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const exists = await sess.cols('uid', 'deleted').where('uid=? AND deleted=? AND tag_group_id>?', uid, false, 0).limit(1).exist(TransactionTagTable);

            if (exists) {
                throw errs.ErrTransactionTagGroupInUseCannotBeDeleted;
            }

            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagGroupTable, updateModel);
        });
    }
}

export const TransactionTagGroups = new TransactionTagGroupService();
