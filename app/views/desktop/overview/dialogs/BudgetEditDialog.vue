<template>
    <v-dialog width="600" v-model="showState">
        <one-column-dialog-layout :title="tt('Monthly Budget')" :cancel-button-title="tt('Cancel')"
                                  :disabled="saving" @cancel="showState = false">
            <template #toolbar>
                <v-btn class="mx-2" density="comfortable" variant="outlined" :disabled="saving" @click="save">
                    {{ tt('Save') }}
                    <v-progress-circular indeterminate size="18" class="ms-2" v-if="saving"></v-progress-circular>
                </v-btn>
            </template>

            <template #content>
                <div class="text-body-medium text-medium-emphasis mb-4">{{ tt('Set a monthly limit for all expenses or for each primary expense category. Leave it as 0 to have no budget.') }}</div>
                <amount-input :label="tt('All Expenses')" :currency="defaultCurrency" :show-currency="true"
                              :disabled="saving" v-model="amounts[ALL_EXPENSES_BUDGET_CATEGORY_ID]" />
                <amount-input class="mt-4" :key="category.id" :label="category.name" :currency="defaultCurrency" :show-currency="true"
                              :disabled="saving" v-model="amounts[category.id]"
                              v-for="category in expenseCategories" />
            </template>
        </one-column-dialog-layout>

        <snack-bar ref="snackbar" />
    </v-dialog>
</template>

<script setup lang="ts">
import SnackBar from '@/components/desktop/SnackBar.vue';

import { ref, computed, useTemplateRef } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useUserStore } from '@/stores/user.ts';
import { useTransactionCategoriesStore } from '@/stores/transactionCategory.ts';
import { useBudgetsStore } from '@/stores/budget.ts';

import { CategoryType } from '@/core/category.ts';
import type { TransactionCategory } from '@/models/transaction_category.ts';
import { type BudgetSaveItemRequest, ALL_EXPENSES_BUDGET_CATEGORY_ID } from '@/models/budget.ts';

type SnackBarType = InstanceType<typeof SnackBar>;

const emit = defineEmits<{
    (e: 'saved'): void;
}>();

const { tt } = useI18n();

const userStore = useUserStore();
const transactionCategoriesStore = useTransactionCategoriesStore();
const budgetsStore = useBudgetsStore();

const snackbar = useTemplateRef<SnackBarType>('snackbar');

const showState = ref<boolean>(false);
const saving = ref<boolean>(false);
const amounts = ref<Record<string, number>>({});

const defaultCurrency = computed<string>(() => userStore.currentUserDefaultCurrency);

// budgets are set on primary expense categories, the expenses of the secondary categories are counted in their primary category
const expenseCategories = computed<TransactionCategory[]>(() => (transactionCategoriesStore.allTransactionCategories[CategoryType.Expense] ?? [])
    .filter(category => !category.hidden || !!budgetsStore.allBudgets[category.id]));

function open(): void {
    amounts.value = { [ALL_EXPENSES_BUDGET_CATEGORY_ID]: 0, ...budgetsStore.allBudgets };
    showState.value = true;
}

function save(): void {
    const budgets: BudgetSaveItemRequest[] = [];

    for (const [categoryId, amount] of Object.entries(amounts.value)) {
        if (amount > 0) {
            budgets.push({ categoryId, amount });
        }
    }

    saving.value = true;

    budgetsStore.saveBudgets(budgets).then(() => {
        saving.value = false;
        showState.value = false;
        emit('saved');
    }).catch(error => {
        saving.value = false;

        if (!error.processed) {
            snackbar.value?.showError(error);
        }
    });
}

defineExpose({
    open
});
</script>
