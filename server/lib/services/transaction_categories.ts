import type { Context } from '../core/context';
import * as errs from '../errs/index';
import {
    CATEGORY_TYPE_EXPENSE,
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    LevelOneTransactionCategoryParentId,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED,
    TRANSACTION_TEMPLATE_TYPE_NORMAL,
    TRANSACTION_TEMPLATE_TYPE_SCHEDULE,
    type TransactionCategory,
    TransactionCategoryTable,
    type TransactionCategoryType,
    TransactionTable,
    TransactionTemplateTable,
} from '../models/index';
import { stringArrayToInt64Array } from '../utils/converter';
import { UUID_TYPE_CATEGORY } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

export type CategoryNameMap = Map<string, Map<string, TransactionCategory>>;

// TransactionCategoryService represents transaction category service
export class TransactionCategoryService extends ServiceBase {
    // getTotalCategoryCountByUid returns total category count of user
    public async getTotalCategoryCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).count(TransactionCategoryTable);
    }

    // getAllCategoriesByUid returns all transaction category models of user
    public async getAllCategoriesByUid(c: Context, uid: bigint, categoryType: TransactionCategoryType, parentCategoryId: bigint): Promise<TransactionCategory[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        let condition = 'uid=? AND deleted=?';
        const conditionParams: unknown[] = [uid, false];

        if (categoryType > 0) {
            condition = condition + ' AND type=?';
            conditionParams.push(categoryType);
        }

        if (parentCategoryId >= 0n) {
            condition = condition + ' AND parent_category_id=?';
            conditionParams.push(parentCategoryId);
        }

        return this.userDataDB(uid).newSession(c).where(condition, ...conditionParams).orderBy('type asc, parent_category_id asc, display_order asc').find(TransactionCategoryTable);
    }

    // getSubCategoriesByCategoryIds returns sub transaction category models according to category ids
    public async getSubCategoriesByCategoryIds(c: Context, uid: bigint, categoryIds: bigint[]): Promise<TransactionCategory[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (categoryIds.length <= 0) {
            throw errs.ErrTransactionCategoryIdInvalid;
        }

        let condition = 'uid=? AND deleted=?';
        const conditionParams: unknown[] = [uid, false];
        const placeholders: string[] = [];

        for (const categoryId of categoryIds) {
            if (categoryId <= 0n) {
                throw errs.ErrTransactionCategoryIdInvalid;
            }

            placeholders.push('?');
            conditionParams.push(categoryId);
        }

        if (placeholders.length > 1) {
            condition = condition + ' AND parent_category_id IN (' + placeholders.join(',') + ')';
        } else {
            condition = condition + ' AND parent_category_id = ' + placeholders.join(',');
        }

        return this.userDataDB(uid).newSession(c).where(condition, ...conditionParams).orderBy('display_order asc').find(TransactionCategoryTable);
    }

    // getCategoryByCategoryId returns a transaction category model according to transaction category id
    public async getCategoryByCategoryId(c: Context, uid: bigint, categoryId: bigint): Promise<TransactionCategory> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (categoryId <= 0n) {
            throw errs.ErrTransactionCategoryIdInvalid;
        }

        const category = await this.userDataDB(uid).newSession(c).id(categoryId).where('uid=? AND deleted=?', uid, false).get(TransactionCategoryTable);

        if (!category) {
            throw errs.ErrTransactionCategoryNotFound;
        }

        return category;
    }

    // getCategoriesByCategoryIds returns transaction category models according to transaction category ids
    public async getCategoriesByCategoryIds(c: Context, uid: bigint, categoryIds: bigint[] | null): Promise<Map<bigint, TransactionCategory>> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (!categoryIds) {
            throw errs.ErrTransactionCategoryIdInvalid;
        }

        const categories = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).in('category_id', categoryIds).find(TransactionCategoryTable);
        return this.getCategoryMapByList(categories);
    }

    // getMaxDisplayOrder returns the max display order according to transaction category type
    public async getMaxDisplayOrder(c: Context, uid: bigint, categoryType: TransactionCategoryType): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const category = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'parent_category_id', 'display_order')
            .where('uid=? AND deleted=? AND type=? AND parent_category_id=?', uid, false, categoryType, LevelOneTransactionCategoryParentId)
            .orderBy('display_order desc').limit(1).get(TransactionCategoryTable);

        return category ? category.displayOrder : 0;
    }

    // getMaxSubCategoryDisplayOrder returns the max display order of sub transaction category according to transaction category type and parent transaction category id
    public async getMaxSubCategoryDisplayOrder(c: Context, uid: bigint, categoryType: TransactionCategoryType, parentCategoryId: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (parentCategoryId <= 0n) {
            throw errs.ErrTransactionCategoryIdInvalid;
        }

        const category = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'parent_category_id', 'display_order')
            .where('uid=? AND deleted=? AND type=? AND parent_category_id=?', uid, false, categoryType, parentCategoryId)
            .orderBy('display_order desc').limit(1).get(TransactionCategoryTable);

        return category ? category.displayOrder : 0;
    }

    // createCategory saves a new transaction category model to database
    public async createCategory(c: Context, category: TransactionCategory): Promise<void> {
        if (category.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        category.categoryId = this.generateUuid(UUID_TYPE_CATEGORY);

        if (category.categoryId < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        category.deleted = false;
        category.createdUnixTime = nowUnix();
        category.updatedUnixTime = nowUnix();

        await this.userDataDB(category.uid).doTransaction(c, async sess => {
            await sess.insert(TransactionCategoryTable, category);
        });
    }

    // createCategories saves a few transaction category models to database (the key null contains primary categories)
    public async createCategories(c: Context, uid: bigint, categories: Map<TransactionCategory | null, TransactionCategory[]>): Promise<TransactionCategory[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const allCategories: TransactionCategory[] = [];
        const primaryCategories = categories.get(null) ?? [];
        const primaryCategoryUuids = this.generateUuids(UUID_TYPE_CATEGORY, primaryCategories.length);

        if (!primaryCategoryUuids || primaryCategoryUuids.length < primaryCategories.length) {
            throw errs.ErrSystemIsBusy;
        }

        for (let i = 0; i < primaryCategories.length; i++) {
            const primaryCategory = primaryCategories[i]!;
            primaryCategory.categoryId = primaryCategoryUuids[i]!;
            primaryCategory.deleted = false;
            primaryCategory.createdUnixTime = nowUnix();
            primaryCategory.updatedUnixTime = nowUnix();

            allCategories.push(primaryCategory);

            const secondaryCategories = categories.get(primaryCategory) ?? [];
            const secondaryCategoryUuids = this.generateUuids(UUID_TYPE_CATEGORY, secondaryCategories.length);

            if (!secondaryCategoryUuids || secondaryCategoryUuids.length < secondaryCategories.length) {
                throw errs.ErrSystemIsBusy;
            }

            for (let j = 0; j < secondaryCategories.length; j++) {
                const secondaryCategory = secondaryCategories[j]!;
                secondaryCategory.categoryId = secondaryCategoryUuids[j]!;
                secondaryCategory.parentCategoryId = primaryCategory.categoryId;
                secondaryCategory.deleted = false;
                secondaryCategory.createdUnixTime = nowUnix();
                secondaryCategory.updatedUnixTime = nowUnix();

                allCategories.push(secondaryCategory);
            }
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const category of allCategories) {
                await sess.insert(TransactionCategoryTable, category);
            }
        });

        return allCategories;
    }

    // modifyCategory saves an existed transaction category model to database
    public async modifyCategory(c: Context, category: TransactionCategory): Promise<void> {
        if (category.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        category.updatedUnixTime = nowUnix();

        await this.userDataDB(category.uid).doTransaction(c, async sess => {
            const updatedRows = await sess.id(category.categoryId).cols('parent_category_id', 'name', 'display_order', 'icon', 'icon_type', 'color', 'comment', 'hidden', 'updated_unix_time').where('uid=? AND deleted=?', category.uid, false).update(TransactionCategoryTable, category);

            if (updatedRows < 1) {
                throw errs.ErrTransactionCategoryNotFound;
            }
        });
    }

    // hideCategory updates hidden field of given transaction categories
    public async hideCategory(c: Context, uid: bigint, ids: bigint[], hidden: boolean): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionCategory> = {
            hidden: hidden,
            updatedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const updatedRows = await sess.cols('hidden', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).in('category_id', ids).update(TransactionCategoryTable, updateModel);

            if (updatedRows < 1) {
                throw errs.ErrTransactionCategoryNotFound;
            }
        });
    }

    // modifyCategoryDisplayOrders updates display order of given transaction categories
    public async modifyCategoryDisplayOrders(c: Context, uid: bigint, categories: TransactionCategory[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const category of categories) {
            category.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const category of categories) {
                const updatedRows = await sess.id(category.categoryId).cols('display_order', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionCategoryTable, category);

                if (updatedRows < 1) {
                    throw errs.ErrTransactionCategoryNotFound;
                }
            }
        });
    }

    // deleteCategory deletes an existed transaction category from database
    public async deleteCategory(c: Context, uid: bigint, categoryId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();
        const updateModel: Partial<TransactionCategory> = {
            deleted: true,
            deletedUnixTime: now,
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const categoryAndSubCategories = await sess.where('uid=? AND deleted=? AND (category_id=? OR parent_category_id=?)', uid, false, categoryId, categoryId).find(TransactionCategoryTable);

            if (categoryAndSubCategories.length < 1) {
                throw errs.ErrTransactionCategoryNotFound;
            }

            const categoryAndSubCategoryIds = categoryAndSubCategories.map(category => category.categoryId);

            let exists = await sess.cols('uid', 'deleted', 'category_id').where('uid=? AND deleted=?', uid, false).in('category_id', categoryAndSubCategoryIds).limit(1).exist(TransactionTable);

            if (exists) {
                throw errs.ErrTransactionCategoryInUseCannotBeDeleted;
            }

            exists = await sess.cols('uid', 'deleted', 'category_id', 'template_type', 'scheduled_frequency_type', 'scheduled_end_time')
                .where('uid=? AND deleted=? AND (template_type=? OR (template_type=? AND scheduled_frequency_type<>? AND (scheduled_end_time IS NULL OR scheduled_end_time>=?)))', uid, false, TRANSACTION_TEMPLATE_TYPE_NORMAL, TRANSACTION_TEMPLATE_TYPE_SCHEDULE, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED, now)
                .in('category_id', categoryAndSubCategoryIds).limit(1).exist(TransactionTemplateTable);

            if (exists) {
                throw errs.ErrTransactionCategoryInUseCannotBeDeleted;
            }

            const deletedRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).in('category_id', categoryAndSubCategoryIds).update(TransactionCategoryTable, updateModel);

            if (deletedRows < 1) {
                throw errs.ErrTransactionCategoryNotFound;
            }
        });
    }

    // deleteAllCategories deletes all existed transaction categories from database
    public async deleteAllCategories(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionCategory> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const exists = await sess.cols('uid', 'deleted', 'category_id').where('uid=? AND deleted=? AND category_id<>?', uid, false, 0).limit(1).exist(TransactionTable);

            if (exists) {
                throw errs.ErrTransactionCategoryInUseCannotBeDeleted;
            }

            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionCategoryTable, updateModel);
        });
    }

    // getCategoryMapByList returns a transaction category map by a list
    public getCategoryMapByList(categories: TransactionCategory[]): Map<bigint, TransactionCategory> {
        const categoryMap = new Map<bigint, TransactionCategory>();

        for (const category of categories) {
            categoryMap.set(category.categoryId, category);
        }

        return categoryMap;
    }

    // getVisibleSubCategoryNameMapByList returns visible sub transaction category maps (category name -> parent category name -> category) by a list
    public getVisibleSubCategoryNameMapByList(categories: TransactionCategory[]): [CategoryNameMap, CategoryNameMap, CategoryNameMap] {
        const categoryMap = new Map<bigint, TransactionCategory>();
        const expenseCategoryMap: CategoryNameMap = new Map();
        const incomeCategoryMap: CategoryNameMap = new Map();
        const transferCategoryMap: CategoryNameMap = new Map();

        for (const category of categories) {
            categoryMap.set(category.categoryId, category);
        }

        for (const category of categories) {
            if (category.hidden) {
                continue;
            }

            if (category.parentCategoryId === LevelOneTransactionCategoryParentId) {
                continue;
            }

            const parentCategory = categoryMap.get(category.parentCategoryId);

            if (!parentCategory) {
                continue;
            }

            let targetMap: CategoryNameMap;

            if (category.type === CATEGORY_TYPE_INCOME) {
                targetMap = incomeCategoryMap;
            } else if (category.type === CATEGORY_TYPE_EXPENSE) {
                targetMap = expenseCategoryMap;
            } else if (category.type === CATEGORY_TYPE_TRANSFER) {
                targetMap = transferCategoryMap;
            } else {
                continue;
            }

            let categoriesByParentName = targetMap.get(category.name);

            if (!categoriesByParentName) {
                categoriesByParentName = new Map();
                targetMap.set(category.name, categoriesByParentName);
            }

            categoriesByParentName.set(parentCategory.name, category);
        }

        return [expenseCategoryMap, incomeCategoryMap, transferCategoryMap];
    }

    // getCategoryNames returns a list with transaction category names from transaction category models list
    public getCategoryNames(categories: TransactionCategory[]): string[] {
        return categories.map(category => category.name);
    }

    // getCategoryOrSubCategoryIds returns a list of category ids or sub-category ids according to given category ids
    public async getCategoryOrSubCategoryIds(c: Context, categoryIds: string, uid: bigint): Promise<bigint[] | null> {
        if (categoryIds === '' || categoryIds === '0') {
            return null;
        }

        let requestCategoryIds: bigint[];

        try {
            requestCategoryIds = stringArrayToInt64Array(categoryIds.split(','));
        } catch (err) {
            throw errs.or(err, errs.ErrTransactionCategoryIdInvalid);
        }

        const allCategoryIds: bigint[] = [];

        if (requestCategoryIds.length > 0) {
            const allSubCategories = await this.getSubCategoriesByCategoryIds(c, uid, requestCategoryIds);
            const categoryIdsMap = new Map<bigint, number>();

            for (const categoryId of requestCategoryIds) {
                categoryIdsMap.set(categoryId, 0);
            }

            for (const subCategory of allSubCategories) {
                const refCount = categoryIdsMap.get(subCategory.parentCategoryId);

                if (refCount !== undefined) {
                    categoryIdsMap.set(subCategory.parentCategoryId, refCount + 1);
                } else {
                    categoryIdsMap.set(subCategory.parentCategoryId, 1);
                }

                if (categoryIdsMap.has(subCategory.categoryId)) {
                    categoryIdsMap.delete(subCategory.categoryId);
                }

                allCategoryIds.push(subCategory.categoryId);
            }

            for (const [categoryId, refCount] of categoryIdsMap) {
                if (refCount < 1) {
                    allCategoryIds.push(categoryId);
                }
            }
        }

        return allCategoryIds;
    }

    // getCategoryOrSubCategoryIdsByCategoryName returns a list of category ids or sub-category ids according to given category name
    public getCategoryOrSubCategoryIdsByCategoryName(categories: TransactionCategory[], categoryName: string): bigint[] {
        const categoryIds: bigint[] = [];
        const parentCategoryIds: bigint[] = [];
        const childCategoryByParentCategoryId = new Map<bigint, TransactionCategory[]>();

        for (const category of categories) {
            if (category.name === categoryName) {
                if (category.parentCategoryId !== LevelOneTransactionCategoryParentId) {
                    categoryIds.push(category.categoryId);
                } else {
                    parentCategoryIds.push(category.categoryId);
                }
            } else if (category.parentCategoryId !== LevelOneTransactionCategoryParentId) {
                let childCategories = childCategoryByParentCategoryId.get(category.parentCategoryId);

                if (!childCategories) {
                    childCategories = [];
                    childCategoryByParentCategoryId.set(category.parentCategoryId, childCategories);
                }

                childCategories.push(category);
            }
        }

        for (const parentCategoryId of parentCategoryIds) {
            const childCategories = childCategoryByParentCategoryId.get(parentCategoryId);

            if (childCategories) {
                for (const childCategory of childCategories) {
                    categoryIds.push(childCategory.categoryId);
                }
            }
        }

        return categoryIds;
    }
}

export const TransactionCategories = new TransactionCategoryService();
