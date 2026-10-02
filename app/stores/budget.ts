import { ref } from 'vue';
import { defineStore } from 'pinia';

import type { BudgetInfoResponse, BudgetSaveItemRequest } from '@/models/budget.ts';

import logger from '@/lib/logger.ts';
import services from '@/lib/services.ts';

export const useBudgetsStore = defineStore('budgets', () => {
    // the amounts of the monthly budgets of current user, keyed by category id ("0" is the budget of all expenses)
    const allBudgets = ref<Record<string, number>>({});

    function setBudgets(budgets: BudgetInfoResponse[]): void {
        const result: Record<string, number> = {};

        for (const budget of budgets) {
            result[budget.categoryId] = budget.amount;
        }

        allBudgets.value = result;
    }

    function resetBudgets(): void {
        allBudgets.value = {};
    }

    function loadAllBudgets(): Promise<Record<string, number>> {
        return new Promise((resolve, reject) => {
            services.getAllBudgets().then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to retrieve budget list' });
                    return;
                }

                setBudgets(data.result);
                resolve(allBudgets.value);
            }).catch(error => {
                logger.error('failed to load budget list', error);

                if (error.response && error.response.data && error.response.data.errorMessage) {
                    reject({ error: error.response.data });
                } else if (!error.processed) {
                    reject({ message: 'Unable to retrieve budget list' });
                } else {
                    reject(error);
                }
            });
        });
    }

    function saveBudgets(budgets: BudgetSaveItemRequest[]): Promise<Record<string, number>> {
        return new Promise((resolve, reject) => {
            services.saveBudgets({ budgets }).then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to save budgets' });
                    return;
                }

                setBudgets(data.result);
                resolve(allBudgets.value);
            }).catch(error => {
                logger.error('failed to save budgets', error);

                if (error.response && error.response.data && error.response.data.errorMessage) {
                    reject({ error: error.response.data });
                } else if (!error.processed) {
                    reject({ message: 'Unable to save budgets' });
                } else {
                    reject(error);
                }
            });
        });
    }

    return {
        // states
        allBudgets,
        // functions
        resetBudgets,
        loadAllBudgets,
        saveBudgets
    };
});
