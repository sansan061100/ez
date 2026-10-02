import * as errs from '../errs/index';
import * as log from '../log/index';
import { AllExpensesBudgetCategoryId, type BudgetSaveRequest, CATEGORY_TYPE_EXPENSE, LevelOneTransactionCategoryParentId, toBudgetInfoResponse } from '../models/index';
import { Budgets } from '../services/budgets';
import { TransactionCategories } from '../services/transaction_categories';
import type { WebContext } from '../web/context';
import { bindJson, errMsg } from './base';
import { BudgetSaveRequestSchema } from './schemas';

const P = 'budgets';

// budgetListHandler returns all budgets of current user
export async function budgetListHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.BudgetListHandler`;
    const uid = c.getCurrentUid();

    try {
        const budgets = await Budgets.getAllBudgetsByUid(c, uid);
        return budgets.map(toBudgetInfoResponse);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to get all budgets for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// budgetSaveHandler replaces all budgets of current user by request parameters
export async function budgetSaveHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.BudgetSaveHandler`;
    const saveReq = await bindJson<BudgetSaveRequest>(c, BudgetSaveRequestSchema, handler);
    const uid = c.getCurrentUid();
    const categoryIds: bigint[] = [];
    const existedCategoryIds = new Set<bigint>();

    for (const item of saveReq.budgets) {
        if (existedCategoryIds.has(item.categoryId)) {
            throw errs.ErrIncompleteOrIncorrectSubmission;
        }

        existedCategoryIds.add(item.categoryId);

        if (item.categoryId !== AllExpensesBudgetCategoryId) {
            categoryIds.push(item.categoryId);
        }
    }

    if (categoryIds.length > 0) {
        const categories = await TransactionCategories.getCategoriesByCategoryIds(c, uid, categoryIds);

        for (const categoryId of categoryIds) {
            const category = categories.get(categoryId);

            if (!category) {
                throw errs.ErrTransactionCategoryNotFound;
            }

            if (category.type !== CATEGORY_TYPE_EXPENSE || category.parentCategoryId !== LevelOneTransactionCategoryParentId) {
                throw errs.ErrTransactionCategoryTypeInvalid;
            }
        }
    }

    try {
        const budgets = await Budgets.saveAllBudgets(c, uid, saveReq.budgets);
        log.infof(c, `[${handler}] user "uid:${uid}" has saved ${budgets.length} budgets successfully`);
        return budgets.map(toBudgetInfoResponse);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to save budgets for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}
