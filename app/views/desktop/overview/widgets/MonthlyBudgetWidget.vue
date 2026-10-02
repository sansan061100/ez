<template>
    <v-card class="overview-widget budget-widget h-100" :class="{ disabled: loading }">
        <template #title>
            <overview-widget-header :title="title || tt('Monthly Budget')" :icon="mdiPiggyBankOutline">
                <v-spacer />
                <v-btn density="compact" color="default" variant="text" :icon="true"
                       :aria-label="tt('Edit Budget')" :disabled="loading || editing"
                       @click="budgetEditDialog?.open()">
                    <v-icon :icon="mdiPencilOutline" size="18" />
                    <v-tooltip activator="parent">{{ tt('Edit Budget') }}</v-tooltip>
                </v-btn>
            </overview-widget-header>
        </template>

        <v-card-text class="overview-widget__body">
            <div class="budget-widget__item" :key="item.id" v-for="item in budgetItems">
                <div class="overview-widget__detail-row">
                    <span class="text-truncate" :title="item.name">{{ item.name }}</span>
                    <span class="overview-widget__amount text-truncate">{{ getDisplayAmount(item.spent, rankingData.incomplete) }} / {{ getDisplayAmount(item.budget, false) }}</span>
                </div>
                <v-progress-linear class="mt-1" rounded :height="6" :bg-opacity="0.1"
                                   :color="item.percent >= 100 ? 'error' : (item.percent >= 80 ? 'warning' : 'primary')"
                                   :aria-label="item.name" :model-value="Math.min(item.percent, 100)" />
                <div class="overview-widget__caption mt-1" :class="{ 'text-error': item.percent >= 100 }">
                    {{ item.percent >= 100 ? tt('format.misc.budgetOverspent', { amount: getDisplayAmount(item.spent.subtract(item.budget), false) }) : tt('format.misc.budgetRemaining', { amount: getDisplayAmount(item.budget.subtract(item.spent), false) }) }}
                </div>
            </div>
            <div v-if="loading && !budgetItems.length">
                <v-skeleton-loader class="skeleton-no-margin py-4 mb-1" type="text" :key="idx" :loading="true" v-for="idx in 3"></v-skeleton-loader>
            </div>
            <div class="overview-widget__empty" v-if="!loading && !budgetItems.length">
                <v-icon :icon="mdiPiggyBankOutline" size="32" />
                <span>{{ tt('No budget has been set') }}</span>
                <v-btn class="mt-2" density="comfortable" variant="tonal" :disabled="editing"
                       @click="budgetEditDialog?.open()">{{ tt('Set Budget') }}</v-btn>
            </div>
        </v-card-text>

        <budget-edit-dialog ref="budgetEditDialog" />
    </v-card>
</template>

<script setup lang="ts">
import OverviewWidgetHeader from './OverviewWidgetHeader.vue';
import BudgetEditDialog from '../dialogs/BudgetEditDialog.vue';

import { computed, useTemplateRef } from 'vue';

import { useI18n } from '@/locales/helpers.ts';
import { useExpenseCategoryRankingWidgetBase } from '@/views/base/overview/ExpenseCategoryRankingWidgetBase.ts';

import { useTransactionCategoriesStore } from '@/stores/transactionCategory.ts';
import { useBudgetsStore } from '@/stores/budget.ts';

import type { BigDecimal } from '@/core/numeral.ts';
import { DateRange } from '@/core/datetime.ts';
import { ALL_EXPENSES_BUDGET_CATEGORY_ID } from '@/models/budget.ts';

import { BIG_DECIMAL_ZERO, parseBigDecimal } from '@/lib/numeral.ts';

import {
    mdiPiggyBankOutline,
    mdiPencilOutline
} from '@mdi/js';

interface BudgetItem {
    id: string;
    name: string;
    budget: BigDecimal;
    spent: BigDecimal;
    percent: number;
}

const props = defineProps<{
    loading: boolean;
    editing?: boolean;
    title?: string;
}>();

const { tt } = useI18n();

const transactionCategoriesStore = useTransactionCategoriesStore();
const budgetsStore = useBudgetsStore();

// the spent amounts are the expenses of this month grouped by primary category, the same as the expense category ranking widget
const { rankingData, getDisplayAmount } = useExpenseCategoryRankingWidgetBase({
    get loading() { return props.loading; },
    dateType: DateRange.ThisMonth.type,
    categoryLevel: 'primary',
    itemCount: Number.MAX_SAFE_INTEGER
});

const budgetEditDialog = useTemplateRef<InstanceType<typeof BudgetEditDialog>>('budgetEditDialog');

const budgetItems = computed<BudgetItem[]>(() => {
    const spentByCategory: Record<string, BigDecimal> = {};
    const items: BudgetItem[] = [];

    for (const item of rankingData.value.items) {
        spentByCategory[item.id] = item.value;
    }

    for (const [categoryId, amount] of Object.entries(budgetsStore.allBudgets)) {
        let name: string;
        let spent: BigDecimal;

        if (categoryId === ALL_EXPENSES_BUDGET_CATEGORY_ID) {
            name = tt('All Expenses');
            spent = rankingData.value.total;
        } else {
            const category = transactionCategoriesStore.allTransactionCategoriesMap[categoryId];

            if (!category) {
                continue;
            }

            name = category.name;
            spent = spentByCategory[categoryId] ?? BIG_DECIMAL_ZERO;
        }

        const budget = parseBigDecimal(amount);

        items.push({
            id: categoryId,
            name: name,
            budget: budget,
            spent: spent,
            percent: budget.isPositive() ? spent.divide(budget).multiply(100).toDoubleNumber() : 0
        });
    }

    // the budget of all expenses goes first, then the categories which used the most of their budgets
    return items.sort((a, b) => {
        if (a.id === ALL_EXPENSES_BUDGET_CATEGORY_ID || b.id === ALL_EXPENSES_BUDGET_CATEGORY_ID) {
            return a.id === ALL_EXPENSES_BUDGET_CATEGORY_ID ? -1 : 1;
        }

        return b.percent - a.percent;
    });
});
</script>

<style scoped>
.budget-widget__item + .budget-widget__item {
    margin-top: 12px;
}
</style>
