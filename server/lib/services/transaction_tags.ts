import type { Context } from '../core/context';
import * as errs from '../errs/index';
import {
    fillTagFromOtherTag,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED,
    TRANSACTION_TEMPLATE_TYPE_NORMAL,
    TRANSACTION_TEMPLATE_TYPE_SCHEDULE,
    type TransactionTag,
    type TransactionTagIndex,
    TransactionTagIndexTable,
    TransactionTagTable,
    TransactionTemplateTable,
} from '../models/index';
import { stringArrayToInt64Array } from '../utils/converter';
import { int64Sort } from '../utils/slices';
import { UUID_TYPE_TAG, UUID_TYPE_TAG_INDEX } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

const pageCountForLoadAllTransactionTagIndexes = 1000;

// TransactionTagService represents transaction tag service
export class TransactionTagService extends ServiceBase {
    // getTotalTagCountByUid returns total tag count of user
    public async getTotalTagCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).count(TransactionTagTable);
    }

    // getAllTagsByUid returns all transaction tag models of user
    public async getAllTagsByUid(c: Context, uid: bigint): Promise<TransactionTag[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).find(TransactionTagTable);
    }

    // getTagByTagId returns a transaction tag model according to transaction tag id
    public async getTagByTagId(c: Context, uid: bigint, tagId: bigint): Promise<TransactionTag> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (tagId <= 0n) {
            throw errs.ErrTransactionTagIdInvalid;
        }

        const tag = await this.userDataDB(uid).newSession(c).id(tagId).where('uid=? AND deleted=?', uid, false).get(TransactionTagTable);

        if (!tag) {
            throw errs.ErrTransactionTagNotFound;
        }

        return tag;
    }

    // getTagsByTagIds returns transaction tag models according to transaction tag ids
    public async getTagsByTagIds(c: Context, uid: bigint, tagIds: bigint[] | null): Promise<Map<bigint, TransactionTag>> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (!tagIds) {
            throw errs.ErrTransactionTagIdInvalid;
        }

        const tags = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).in('tag_id', tagIds).find(TransactionTagTable);
        return this.getTagMapByList(tags);
    }

    // getMaxDisplayOrder returns the max display order
    public async getMaxDisplayOrder(c: Context, uid: bigint, tagGroupId: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const tag = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'display_order').where('uid=? AND deleted=? AND tag_group_id=?', uid, false, tagGroupId).orderBy('display_order desc').limit(1).get(TransactionTagTable);
        return tag ? tag.displayOrder : 0;
    }

    // getAllTagIdsOfAllTransactions returns all transaction tag ids
    public async getAllTagIdsOfAllTransactions(c: Context, uid: bigint): Promise<TransactionTagIndex[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const allTransactionTagIndexes: TransactionTagIndex[] = [];
        let maxTransactionTagIndexId = 0n;

        while (maxTransactionTagIndexId >= 0n) {
            let finalCondition = 'uid=? AND deleted=?';
            const finalConditionParams: unknown[] = [uid, false];

            if (maxTransactionTagIndexId > 0n) {
                finalCondition = finalCondition + ' AND tag_index_id<=?';
                finalConditionParams.push(maxTransactionTagIndexId);
            }

            const tagIndexes = await this.userDataDB(uid).newSession(c).where(finalCondition, ...finalConditionParams).limit(pageCountForLoadAllTransactionTagIndexes, 0).orderBy('tag_index_id desc').find(TransactionTagIndexTable);
            allTransactionTagIndexes.push(...tagIndexes);

            if (tagIndexes.length < pageCountForLoadAllTransactionTagIndexes) {
                break;
            }

            maxTransactionTagIndexId = tagIndexes[tagIndexes.length - 1]!.tagIndexId - 1n;
        }

        return allTransactionTagIndexes;
    }

    // getAllTagIdsMapOfAllTransactions returns all transaction tag ids map grouped by transaction id
    public async getAllTagIdsMapOfAllTransactions(c: Context, uid: bigint): Promise<Map<bigint, bigint[]>> {
        const tagIndexes = await this.getAllTagIdsOfAllTransactions(c, uid);
        return this.getGroupedTransactionTagIds(tagIndexes);
    }

    // getAllTagIdsOfTransactions returns transaction tag ids for given transactions
    public async getAllTagIdsOfTransactions(c: Context, uid: bigint, transactionIds: bigint[]): Promise<Map<bigint, bigint[]>> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const tagIndexes = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).in('transaction_id', transactionIds).orderBy('transaction_id asc, tag_index_id asc').find(TransactionTagIndexTable);
        return this.getGroupedTransactionTagIds(tagIndexes);
    }

    // createTag saves a new transaction tag model to database
    public async createTag(c: Context, tag: TransactionTag): Promise<void> {
        if (tag.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (await this.existsTagName(c, tag.uid, tag.name)) {
            throw errs.ErrTransactionTagNameAlreadyExists;
        }

        tag.tagId = this.generateUuid(UUID_TYPE_TAG);

        if (tag.tagId < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        tag.deleted = false;
        tag.createdUnixTime = nowUnix();
        tag.updatedUnixTime = nowUnix();

        await this.userDataDB(tag.uid).doTransaction(c, async sess => {
            await sess.insert(TransactionTagTable, tag);
        });
    }

    // createTags saves a few transaction tag models to database
    public async createTags(c: Context, uid: bigint, tags: TransactionTag[], skipExists: boolean): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const allTagNames = tags.map(tag => tag.name);
        const existTags = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).in('name', allTagNames).find(TransactionTagTable);

        if (!skipExists && existTags.length > 0) {
            throw errs.ErrTransactionTagNameAlreadyExists;
        }

        const existsNameTagMap = new Map<string, TransactionTag>();

        for (const tag of existTags) {
            existsNameTagMap.set(tag.name, tag);
        }

        const newTags: TransactionTag[] = [];

        for (const tag of tags) {
            const existsTag = existsNameTagMap.get(tag.name);

            if (existsTag) {
                fillTagFromOtherTag(tag, existsTag);
                continue;
            }

            newTags.push(tag);
        }

        const tagUuids = this.generateUuids(UUID_TYPE_TAG_INDEX, newTags.length);

        if (!tagUuids || tagUuids.length < newTags.length) {
            throw errs.ErrSystemIsBusy;
        }

        for (let i = 0; i < newTags.length; i++) {
            const tag = newTags[i]!;
            tag.tagId = tagUuids[i]!;
            tag.deleted = false;
            tag.createdUnixTime = nowUnix();
            tag.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const tag of newTags) {
                await sess.insert(TransactionTagTable, tag);
            }
        });
    }

    // modifyTag saves an existed transaction tag model to database
    public async modifyTag(c: Context, tag: TransactionTag, tagNameChanged: boolean): Promise<void> {
        if (tag.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (tagNameChanged && await this.existsTagName(c, tag.uid, tag.name)) {
            throw errs.ErrTransactionTagNameAlreadyExists;
        }

        tag.updatedUnixTime = nowUnix();

        await this.userDataDB(tag.uid).doTransaction(c, async sess => {
            const updatedRows = await sess.id(tag.tagId).cols('name', 'tag_group_id', 'display_order', 'updated_unix_time').where('uid=? AND deleted=?', tag.uid, false).update(TransactionTagTable, tag);

            if (updatedRows < 1) {
                throw errs.ErrTransactionTagNotFound;
            }
        });
    }

    // hideTag updates hidden field of given transaction tags
    public async hideTag(c: Context, uid: bigint, ids: bigint[], hidden: boolean): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionTag> = {
            hidden: hidden,
            updatedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const updatedRows = await sess.cols('hidden', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).in('tag_id', ids).update(TransactionTagTable, updateModel);

            if (updatedRows < 1) {
                throw errs.ErrTransactionTagNotFound;
            }
        });
    }

    // modifyTagDisplayOrders updates display order of given transaction tags
    public async modifyTagDisplayOrders(c: Context, uid: bigint, tags: TransactionTag[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const tag of tags) {
            tag.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const tag of tags) {
                const updatedRows = await sess.id(tag.tagId).cols('display_order', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagTable, tag);

                if (updatedRows < 1) {
                    throw errs.ErrTransactionTagNotFound;
                }
            }
        });
    }

    // deleteTag deletes an existed transaction tag from database
    public async deleteTag(c: Context, uid: bigint, tagId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();
        const updateModel: Partial<TransactionTag> = {
            deleted: true,
            deletedUnixTime: now,
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const exists = await sess.cols('uid', 'tag_id').where('uid=? AND deleted=? AND tag_id=?', uid, false, tagId).limit(1).exist(TransactionTagIndexTable);

            if (exists) {
                throw errs.ErrTransactionTagInUseCannotBeDeleted;
            }

            const relatedTransactionTemplatesByTag = await sess.cols('uid', 'deleted', 'tag_ids', 'template_type', 'scheduled_frequency_type', 'scheduled_end_time')
                .where('uid=? AND deleted=? AND (template_type=? OR (template_type=? AND scheduled_frequency_type<>? AND (scheduled_end_time IS NULL OR scheduled_end_time>=?))) AND tag_ids LIKE ?',
                    uid, false, TRANSACTION_TEMPLATE_TYPE_NORMAL, TRANSACTION_TEMPLATE_TYPE_SCHEDULE, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED, now, '%%' + tagId.toString() + '%%')
                .find(TransactionTemplateTable);

            for (const template of relatedTransactionTemplatesByTag) {
                const tagIds = this.getTagIds(template.tagIds);

                if (tagIds && tagIds.includes(tagId)) {
                    throw errs.ErrTransactionTagInUseCannotBeDeleted;
                }
            }

            const deletedRows = await sess.id(tagId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagTable, updateModel);

            if (deletedRows < 1) {
                throw errs.ErrTransactionTagNotFound;
            }
        });
    }

    // deleteAllTags deletes all existed transaction tags from database
    public async deleteAllTags(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionTag> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const exists = await sess.cols('uid', 'deleted').where('uid=? AND deleted=?', uid, false).limit(1).exist(TransactionTagIndexTable);

            if (exists) {
                throw errs.ErrTransactionTagInUseCannotBeDeleted;
            }

            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagTable, updateModel);
        });
    }

    // existsTagName returns whether the given tag name exists
    public async existsTagName(c: Context, uid: bigint, name: string): Promise<boolean> {
        if (name === '') {
            throw errs.ErrTransactionTagNameIsEmpty;
        }

        return this.userDataDB(uid).newSession(c).cols('name').where('uid=? AND deleted=? AND name=?', uid, false, name).exist(TransactionTagTable);
    }

    // modifyTagIndexTransactionTime updates transaction time of given transaction tag indexes
    public async modifyTagIndexTransactionTime(c: Context, uid: bigint, tagIndexes: TransactionTagIndex[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const tagIndex of tagIndexes) {
            tagIndex.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const tagIndex of tagIndexes) {
                const updatedRows = await sess.id(tagIndex.tagIndexId).cols('transaction_time', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTagIndexTable, tagIndex);

                if (updatedRows < 1) {
                    throw errs.ErrTransactionTagIndexNotFound;
                }
            }
        });
    }

    // getTagMapByList returns a transaction tag map by a list
    public getTagMapByList(tags: TransactionTag[]): Map<bigint, TransactionTag> {
        const tagMap = new Map<bigint, TransactionTag>();

        for (const tag of tags) {
            tagMap.set(tag.tagId, tag);
        }

        return tagMap;
    }

    // getVisibleTagNameMapByList returns visible transaction tag map by a list
    public getVisibleTagNameMapByList(tags: TransactionTag[]): Map<string, TransactionTag> {
        const tagMap = new Map<string, TransactionTag>();

        for (const tag of tags) {
            if (tag.hidden) {
                continue;
            }

            tagMap.set(tag.name, tag);
        }

        return tagMap;
    }

    // getTagNames returns a list with transaction tag names from transaction tag models list
    public getTagNames(tags: TransactionTag[]): string[] {
        return tags.map(tag => tag.name);
    }

    // getGroupedTransactionTagIds returns a map of transaction id to tag ids
    public getGroupedTransactionTagIds(tagIndexes: TransactionTagIndex[]): Map<bigint, bigint[]> {
        const allTransactionTagIds = new Map<bigint, bigint[]>();

        for (const tagIndex of tagIndexes) {
            let transactionTagIds = allTransactionTagIds.get(tagIndex.transactionId);

            if (!transactionTagIds) {
                transactionTagIds = [];
                allTransactionTagIds.set(tagIndex.transactionId, transactionTagIds);
            }

            transactionTagIds.push(tagIndex.tagId);
        }

        for (const tagIds of allTransactionTagIds.values()) {
            int64Sort(tagIds);
        }

        return allTransactionTagIds;
    }

    // getTagIds returns tag ids list from the comma separated tag ids text
    public getTagIds(tagIds: string): bigint[] | null {
        if (tagIds === '' || tagIds === '0') {
            return null;
        }

        try {
            return stringArrayToInt64Array(tagIds.split(','));
        } catch (err) {
            throw errs.or(err, errs.ErrTransactionTagIdInvalid);
        }
    }

    // getTransactionTagIds returns all tag ids in the map
    public getTransactionTagIds(allTransactionTagIds: Map<bigint, bigint[]>): bigint[] {
        const allTagIds: bigint[] = [];

        for (const tagIds of allTransactionTagIds.values()) {
            allTagIds.push(...tagIds);
        }

        return allTagIds;
    }
}

export const TransactionTags = new TransactionTagService();
