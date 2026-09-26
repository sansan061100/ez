import { ICON_TYPE_USER_CUSTOM, isValidIconType } from '../core/types';
import { DUPLICATE_CHECKER_TYPE_NEW_CATEGORY } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    LevelOneTransactionCategoryParentId,
    newTransactionCategory,
    sortByDisplayOrder,
    type TransactionCategory,
    type TransactionCategoryCreateBatchRequest,
    type TransactionCategoryCreateRequest,
    type TransactionCategoryInfoResponse,
    type TransactionCategoryListRequest,
    type TransactionCategoryModifyRequest,
    type TransactionCategoryType,
    toTransactionCategoryInfoResponse,
} from '../models/index';
import { TransactionCategories } from '../services/transaction_categories';
import { UserCustomIcons } from '../services/user_custom_icons';
import { stringToInt64 } from '../utils/converter';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery, currentConfig, errMsg, getSubmissionRemark, setSubmissionRemarkIfEnable } from './base';
import {
    IdDeleteRequestSchema,
    IdHideRequestSchema,
    IdQueryRequestSchema,
    MoveRequestSchema,
    TransactionCategoryCreateBatchRequestSchema,
    TransactionCategoryCreateRequestSchema,
    TransactionCategoryListRequestSchema,
    TransactionCategoryModifyRequestSchema,
} from './schemas';

interface IdRequest {
    id: bigint;
}

interface IdHideRequest {
    id: bigint;
    hidden: boolean;
}

interface MoveRequest {
    newDisplayOrders: { id: bigint; displayOrder: number }[];
}

// categoryListHandler returns transaction category list of current user
export async function categoryListHandler(c: WebContext): Promise<unknown> {
    const categoryListReq = bindQuery<TransactionCategoryListRequest>(c, TransactionCategoryListRequestSchema, 'transaction_categories.CategoryListHandler');
    const uid = c.getCurrentUid();
    let categories: TransactionCategory[];

    try {
        categories = await TransactionCategories.getAllCategoriesByUid(c, uid, categoryListReq.type, categoryListReq.parentId);
    } catch (err) {
        log.errorf(c, `[transaction_categories.CategoryListHandler] failed to get categories for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return getTransactionCategoryListByTypeResponse(categories, categoryListReq.parentId);
}

// categoryGetHandler returns one specific transaction category of current user
export async function categoryGetHandler(c: WebContext): Promise<unknown> {
    const categoryGetReq = bindQuery<IdRequest>(c, IdQueryRequestSchema, 'transaction_categories.CategoryGetHandler');
    const uid = c.getCurrentUid();

    try {
        const category = await TransactionCategories.getCategoryByCategoryId(c, uid, categoryGetReq.id);
        return toTransactionCategoryInfoResponse(category);
    } catch (err) {
        log.errorf(c, `[transaction_categories.CategoryGetHandler] failed to get category "id:${categoryGetReq.id}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// categoryCreateHandler saves a new transaction category by request parameters for current user
export async function categoryCreateHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'transaction_categories.CategoryCreateHandler';
    const categoryCreateReq = await bindJson<TransactionCategoryCreateRequest>(c, TransactionCategoryCreateRequestSchema, logPrefix);

    if (categoryCreateReq.type < CATEGORY_TYPE_INCOME || categoryCreateReq.type > CATEGORY_TYPE_TRANSFER) {
        log.warnf(c, `[${logPrefix}] category type invalid, type is ${categoryCreateReq.type}`);
        throw errs.ErrTransactionCategoryTypeInvalid;
    }

    const uid = c.getCurrentUid();

    if (categoryCreateReq.parentId > 0n) {
        let parentCategory: TransactionCategory;

        try {
            parentCategory = await TransactionCategories.getCategoryByCategoryId(c, uid, categoryCreateReq.parentId);
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to get parent category "id:${categoryCreateReq.parentId}" for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        if (parentCategory.parentCategoryId > 0n) {
            log.warnf(c, `[${logPrefix}] parent category "id:${parentCategory.categoryId}" has another parent category "id:${parentCategory.parentCategoryId}" for user "uid:${uid}"`);
            throw errs.ErrCannotAddToSecondaryTransactionCategory;
        }
    }

    let maxOrderId: number;

    try {
        if (categoryCreateReq.parentId <= 0n) {
            maxOrderId = await TransactionCategories.getMaxDisplayOrder(c, uid, categoryCreateReq.type);
        } else {
            maxOrderId = await TransactionCategories.getMaxSubCategoryDisplayOrder(c, uid, categoryCreateReq.type, categoryCreateReq.parentId);
        }
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get max display order for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    let category = createNewCategoryModel(uid, categoryCreateReq, maxOrderId + 1);

    if (!await isTransactionCategoryIconTypeValid(c, uid, [category])) {
        log.warnf(c, `[${logPrefix}] icon type invalid for user "uid:${uid}"`);
        throw errs.ErrTransactionCategoryIconInvalid;
    }

    if (currentConfig().enableDuplicateSubmissionsCheck && categoryCreateReq.clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_NEW_CATEGORY, uid, categoryCreateReq.clientSessionId);

        if (found) {
            log.infof(c, `[${logPrefix}] another category "id:${remark}" has been created for user "uid:${uid}"`);
            let categoryId: bigint | null = null;

            try {
                categoryId = stringToInt64(remark);
            } catch {
                categoryId = null;
            }

            if (categoryId !== null) {
                try {
                    category = await TransactionCategories.getCategoryByCategoryId(c, uid, categoryId);
                } catch (err) {
                    log.errorf(c, `[${logPrefix}] failed to get existed category "id:${categoryId}" for user "uid:${uid}", because ${errMsg(err)}`);
                    throw errs.or(err, errs.ErrOperationFailed);
                }

                return toTransactionCategoryInfoResponse(category);
            }
        }
    }

    try {
        await TransactionCategories.createCategory(c, category);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create category "id:${category.categoryId}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${logPrefix}] user "uid:${uid}" has created a new category "id:${category.categoryId}" successfully`);

    setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_NEW_CATEGORY, uid, categoryCreateReq.clientSessionId, category.categoryId.toString());
    return toTransactionCategoryInfoResponse(category);
}

// categoryCreateBatchHandler saves some new transaction category by request parameters for current user
export async function categoryCreateBatchHandler(c: WebContext): Promise<unknown> {
    const categoryCreateBatchReq = await bindJson<TransactionCategoryCreateBatchRequest>(c, TransactionCategoryCreateBatchRequestSchema, 'transaction_categories.CategoryCreateBatchHandler');
    const uid = c.getCurrentUid();

    let categories: TransactionCategory[];

    try {
        categories = await createBatchCategories(c, uid, categoryCreateBatchReq);
    } catch (err) {
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return getTransactionCategoryListByTypeResponse(categories, 0n);
}

// categoryModifyHandler saves an existed transaction category by request parameters for current user
export async function categoryModifyHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'transaction_categories.CategoryModifyHandler';
    const categoryModifyReq = await bindJson<TransactionCategoryModifyRequest>(c, TransactionCategoryModifyRequestSchema, logPrefix);
    const uid = c.getCurrentUid();
    let category: TransactionCategory;

    try {
        category = await TransactionCategories.getCategoryByCategoryId(c, uid, categoryModifyReq.id);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get category "id:${categoryModifyReq.id}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const newCategory = newTransactionCategory({
        categoryId: category.categoryId,
        uid: uid,
        parentCategoryId: categoryModifyReq.parentId,
        name: categoryModifyReq.name,
        displayOrder: category.displayOrder,
        icon: categoryModifyReq.icon,
        iconType: categoryModifyReq.iconType,
        color: categoryModifyReq.color,
        comment: categoryModifyReq.comment,
        hidden: categoryModifyReq.hidden,
    });

    if (newCategory.parentCategoryId === category.parentCategoryId &&
        newCategory.name === category.name &&
        newCategory.icon === category.icon &&
        newCategory.iconType === category.iconType &&
        newCategory.color === category.color &&
        newCategory.comment === category.comment &&
        newCategory.hidden === category.hidden) {
        throw errs.ErrNothingWillBeUpdated;
    }

    if (category.parentCategoryId === LevelOneTransactionCategoryParentId && newCategory.parentCategoryId !== LevelOneTransactionCategoryParentId) {
        throw errs.ErrNotAllowChangePrimaryTransactionCategoryToSecondary;
    }

    if (category.parentCategoryId !== LevelOneTransactionCategoryParentId && newCategory.parentCategoryId === LevelOneTransactionCategoryParentId) {
        throw errs.ErrNotAllowChangeSecondaryTransactionCategoryToPrimary;
    }

    if (newCategory.parentCategoryId !== category.parentCategoryId) {
        let fromPrimaryCategory: TransactionCategory;
        let toPrimaryCategory: TransactionCategory;

        try {
            fromPrimaryCategory = await TransactionCategories.getCategoryByCategoryId(c, uid, category.parentCategoryId);
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to get old primary category "id:${category.parentCategoryId}" of category "id:${categoryModifyReq.id}" for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        try {
            toPrimaryCategory = await TransactionCategories.getCategoryByCategoryId(c, uid, newCategory.parentCategoryId);
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to get new primary category "id:${newCategory.parentCategoryId}" of category "id:${categoryModifyReq.id}" for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        if (fromPrimaryCategory.type !== toPrimaryCategory.type) {
            throw errs.ErrNotAllowChangePrimaryTransactionType;
        }

        if (toPrimaryCategory.parentCategoryId !== LevelOneTransactionCategoryParentId) {
            throw errs.ErrNotAllowUseSecondaryTransactionAsPrimaryCategory;
        }

        let maxOrderId: number;

        try {
            maxOrderId = await TransactionCategories.getMaxSubCategoryDisplayOrder(c, uid, category.type, newCategory.parentCategoryId);
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to get max display order for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        newCategory.displayOrder = maxOrderId + 1;
    }

    if (!await isTransactionCategoryIconTypeValid(c, uid, [newCategory])) {
        log.warnf(c, `[${logPrefix}] icon type invalid for user "uid:${uid}"`);
        throw errs.ErrTransactionCategoryIconInvalid;
    }

    try {
        await TransactionCategories.modifyCategory(c, newCategory);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to update category "id:${categoryModifyReq.id}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${logPrefix}] user "uid:${uid}" has updated category "id:${categoryModifyReq.id}" successfully`);

    newCategory.type = category.type;
    return toTransactionCategoryInfoResponse(newCategory);
}

// categoryHideHandler hides an existed transaction category by request parameters for current user
export async function categoryHideHandler(c: WebContext): Promise<unknown> {
    const categoryHideReq = await bindJson<IdHideRequest>(c, IdHideRequestSchema, 'transaction_categories.CategoryHideHandler');
    const uid = c.getCurrentUid();

    try {
        await TransactionCategories.hideCategory(c, uid, [categoryHideReq.id], categoryHideReq.hidden);
    } catch (err) {
        log.errorf(c, `[transaction_categories.CategoryHideHandler] failed to hide category "id:${categoryHideReq.id}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[transaction_categories.CategoryHideHandler] user "uid:${uid}" has hidden category "id:${categoryHideReq.id}"`);
    return true;
}

// categoryMoveHandler moves display order of existed transaction categories by request parameters for current user
export async function categoryMoveHandler(c: WebContext): Promise<unknown> {
    const categoryMoveReq = await bindJson<MoveRequest>(c, MoveRequestSchema, 'transaction_categories.CategoryMoveHandler');
    const uid = c.getCurrentUid();
    const categories = categoryMoveReq.newDisplayOrders.map(newDisplayOrder => newTransactionCategory({
        uid: uid,
        categoryId: newDisplayOrder.id,
        displayOrder: newDisplayOrder.displayOrder,
    }));

    try {
        await TransactionCategories.modifyCategoryDisplayOrders(c, uid, categories);
    } catch (err) {
        log.errorf(c, `[transaction_categories.CategoryMoveHandler] failed to move categories for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[transaction_categories.CategoryMoveHandler] user "uid:${uid}" has moved categories`);
    return true;
}

// categoryDeleteHandler deletes an existed transaction category by request parameters for current user
export async function categoryDeleteHandler(c: WebContext): Promise<unknown> {
    const categoryDeleteReq = await bindJson<IdRequest>(c, IdDeleteRequestSchema, 'transaction_categories.CategoryDeleteHandler');
    const uid = c.getCurrentUid();

    try {
        await TransactionCategories.deleteCategory(c, uid, categoryDeleteReq.id);
    } catch (err) {
        log.errorf(c, `[transaction_categories.CategoryDeleteHandler] failed to delete category "id:${categoryDeleteReq.id}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[transaction_categories.CategoryDeleteHandler] user "uid:${uid}" has deleted category "id:${categoryDeleteReq.id}"`);
    return true;
}

// createBatchCategories creates the batch categories (used by category batch creation and user registration)
export async function createBatchCategories(c: WebContext, uid: bigint, categoryCreateBatchReq: TransactionCategoryCreateBatchRequest): Promise<TransactionCategory[]> {
    const categoryTypeMaxOrderMap = new Map<TransactionCategoryType, number>();
    const categories: TransactionCategory[] = [];
    const categoriesMap = new Map<TransactionCategory | null, TransactionCategory[]>();
    const requestCategories = categoryCreateBatchReq.categories ?? [];
    const primaryCategories: TransactionCategory[] = [];

    categoriesMap.set(null, primaryCategories);

    for (const categoryCreateReq of requestCategories) {
        let maxOrderId = categoryTypeMaxOrderMap.get(categoryCreateReq.type);

        if (maxOrderId === undefined) {
            try {
                maxOrderId = await TransactionCategories.getMaxDisplayOrder(c, uid, categoryCreateReq.type);
            } catch (err) {
                log.errorf(c, `[transaction_categories.CategoryCreateBatchHandler] failed to get max display order for user "uid:${uid}", because ${errMsg(err)}`);
                throw errs.or(err, errs.ErrOperationFailed);
            }
        }

        const category = createNewCategoryModel(uid, {
            name: categoryCreateReq.name,
            type: categoryCreateReq.type,
            parentId: 0n,
            icon: categoryCreateReq.icon,
            iconType: categoryCreateReq.iconType,
            color: categoryCreateReq.color,
            comment: '',
            clientSessionId: '',
        }, maxOrderId + 1);

        categories.push(category);

        const subCategories: TransactionCategory[] = [];
        const subCategoryRequests = categoryCreateReq.subCategories ?? [];

        for (let j = 0; j < subCategoryRequests.length; j++) {
            const subCategory = createNewCategoryModel(uid, subCategoryRequests[j]!, j + 1);
            categories.push(subCategory);
            subCategories.push(subCategory);
        }

        categoriesMap.set(category, subCategories);
        primaryCategories.push(category);
        categoryTypeMaxOrderMap.set(categoryCreateReq.type, maxOrderId + 1);
    }

    if (!await isTransactionCategoryIconTypeValid(c, uid, categories)) {
        log.warnf(c, `[transaction_categories.createBatchCategories] icon type invalid for user "uid:${uid}"`);
        throw errs.ErrTransactionCategoryIconInvalid;
    }

    let createdCategories: TransactionCategory[];

    try {
        createdCategories = await TransactionCategories.createCategories(c, uid, categoriesMap);
    } catch (err) {
        log.errorf(c, `[transaction_categories.createBatchCategories] failed to create categories for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[transaction_categories.createBatchCategories] user "uid:${uid}" has created categories successfully`);
    return createdCategories;
}

function createNewCategoryModel(uid: bigint, categoryCreateReq: TransactionCategoryCreateRequest, order: number): TransactionCategory {
    return newTransactionCategory({
        uid: uid,
        name: categoryCreateReq.name,
        type: categoryCreateReq.type,
        parentCategoryId: categoryCreateReq.parentId,
        displayOrder: order,
        icon: categoryCreateReq.icon,
        iconType: categoryCreateReq.iconType,
        color: categoryCreateReq.color,
        comment: categoryCreateReq.comment,
    });
}

// getTransactionCategoryListByTypeResponse returns the category list response grouped by category type
export function getTransactionCategoryListByTypeResponse(categories: TransactionCategory[], parentId: bigint): Record<string, TransactionCategoryInfoResponse[]> {
    const categoryResps = categories.map(toTransactionCategoryInfoResponse);
    const categoryRespMap = new Map<bigint, TransactionCategoryInfoResponse>();

    for (const categoryResp of categoryResps) {
        categoryRespMap.set(categoryResp.id, categoryResp);
    }

    for (const categoryResp of categoryResps) {
        if (categoryResp.parentId <= LevelOneTransactionCategoryParentId) {
            continue;
        }

        const parentCategory = categoryRespMap.get(categoryResp.parentId);

        if (!parentCategory) {
            continue;
        }

        (parentCategory.subCategories ??= []).push(categoryResp);
    }

    const finalCategoryResps: TransactionCategoryInfoResponse[] = [];

    for (const categoryResp of categoryResps) {
        if (parentId <= 0n && categoryResp.parentId === LevelOneTransactionCategoryParentId) {
            if (categoryResp.subCategories) {
                sortByDisplayOrder(categoryResp.subCategories);
            }

            finalCategoryResps.push(categoryResp);
        } else if (parentId > 0n && categoryResp.parentId === parentId) {
            finalCategoryResps.push(categoryResp);
        }
    }

    sortByDisplayOrder(finalCategoryResps);

    const typeCategoryMapResponse: Record<string, TransactionCategoryInfoResponse[]> = {};

    for (const category of finalCategoryResps) {
        (typeCategoryMapResponse[String(category.type)] ??= []).push(category);
    }

    return typeCategoryMapResponse;
}

async function isTransactionCategoryIconTypeValid(c: WebContext, uid: bigint, categories: TransactionCategory[]): Promise<boolean> {
    const iconIds: bigint[] = [];

    for (const category of categories) {
        if (!isValidIconType(category.iconType)) {
            return false;
        }

        if (category.iconType === ICON_TYPE_USER_CUSTOM) {
            iconIds.push(category.icon);
        }
    }

    if (iconIds.length < 1) {
        return true;
    }

    try {
        return await UserCustomIcons.existsCustomIcons(c, uid, iconIds);
    } catch (err) {
        log.errorf(c, `[category.isTransactionCategoryIconTypeValid] failed to check custom icons for user "uid:${uid}", because ${errMsg(err)}`);
        return false;
    }
}
