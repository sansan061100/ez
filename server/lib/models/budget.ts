import { defineTable } from '../datastore/schema';

// Budget represents the monthly expense budget of a primary expense category (or of all expenses when category id is 0) stored in database
export interface Budget {
    uid: bigint;
    categoryId: bigint;
    amount: number;
    createdUnixTime: number;
    updatedUnixTime: number;
}

// AllExpensesBudgetCategoryId is the category id of the budget for all expenses
export const AllExpensesBudgetCategoryId = 0n;

export const BudgetTable = defineTable<Budget>('budget', [
    ['uid', 'id', { pk: true }],
    ['category_id', 'id', { pk: true }],
    ['amount', 'i64', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
]);

// BudgetSaveItemRequest represents one budget item of the budget save request
export interface BudgetSaveItemRequest {
    categoryId: bigint;
    amount: number;
}

// BudgetSaveRequest represents all parameters of budget save request, it replaces all the budgets of current user
export interface BudgetSaveRequest {
    budgets: BudgetSaveItemRequest[];
}

// BudgetInfoResponse represents a view-object of budget
export interface BudgetInfoResponse {
    categoryId: string;
    amount: number;
}

export function toBudgetInfoResponse(b: Budget): BudgetInfoResponse {
    return {
        categoryId: b.categoryId.toString(),
        amount: b.amount,
    };
}
