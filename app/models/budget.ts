// ALL_EXPENSES_BUDGET_CATEGORY_ID is the category id of the budget for all expenses
export const ALL_EXPENSES_BUDGET_CATEGORY_ID: string = '0';

export interface BudgetInfoResponse {
    readonly categoryId: string;
    readonly amount: number;
}

export interface BudgetSaveItemRequest {
    readonly categoryId: string;
    readonly amount: number;
}

export interface BudgetSaveRequest {
    readonly budgets: BudgetSaveItemRequest[];
}
