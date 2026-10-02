<template>
    <main-page-layout no-navbar>
        <template #content>
            <div class="report-page">
                <v-card class="report-header">
                    <div class="d-flex flex-wrap align-center gap-4">
                        <div class="flex-grow-1">
                            <div class="report-eyebrow">{{ tt('Financial Report') }}</div>
                            <h1 class="report-title">{{ periodLabel }}</h1>
                            <div class="report-subtitle">
                                <span>{{ tt('Compared with') }} {{ previousPeriodLabel }}</span>
                                <span class="report-print-only"> · {{ tt('Generated on') }} {{ generatedTimeLabel }}</span>
                            </div>
                        </div>
                        <div class="report-toolbar d-flex flex-wrap align-center gap-2">
                            <v-btn-toggle class="report-period-toggle" density="comfortable" variant="outlined"
                                          mandatory divided :disabled="loading"
                                          v-model="periodType">
                                <v-btn value="month">{{ tt('Monthly') }}</v-btn>
                                <v-btn value="year">{{ tt('Yearly') }}</v-btn>
                                <v-btn value="custom" @click="showCustomDateRangeDialog = true">{{ tt('Custom') }}</v-btn>
                            </v-btn-toggle>
                            <v-btn-group density="comfortable" variant="outlined" divided v-if="periodType !== 'custom'">
                                <v-btn :icon="mdiArrowLeft" :disabled="loading" :aria-label="tt('Previous')" @click="shiftPeriod(-1)" />
                                <v-btn :icon="mdiArrowRight" :disabled="loading" :aria-label="tt('Next')" @click="shiftPeriod(1)" />
                            </v-btn-group>
                            <v-btn density="comfortable" variant="text" :icon="mdiRefresh" :loading="loading"
                                   :aria-label="tt('Refresh')" @click="reload" />
                            <v-btn color="primary" variant="flat" :prepend-icon="mdiPrinterOutline"
                                   :disabled="loading || !current" @click="print">{{ tt('Print / PDF') }}</v-btn>
                        </div>
                    </div>
                    <v-alert class="mt-4" type="warning" variant="tonal" density="compact"
                             v-if="current && (current.hasUnconvertibleAmount || netWorth?.hasUnconvertibleAmount)">
                        {{ tt('Some amounts cannot be converted to the default currency because the exchange rates are missing, they are excluded from the totals.') }}
                    </v-alert>
                </v-card>

                <div class="d-flex justify-center pa-12" v-if="loading && !current">
                    <v-progress-circular indeterminate color="primary" />
                </div>

                <template v-if="current && previous">
                    <!-- 1. Summary -->
                    <section class="report-section">
                        <h2 class="report-section-title"><span class="report-section-number">1</span>{{ tt('Summary') }}</h2>

                        <div class="report-kpi-grid">
                            <div class="report-kpi" :key="kpi.key" v-for="kpi in kpis">
                                <div class="report-kpi-label">{{ kpi.label }}</div>
                                <div class="report-kpi-value" :class="kpi.valueClass">{{ kpi.value }}</div>
                                <div class="report-kpi-change" :class="kpi.changeClass">
                                    <v-icon size="14" :icon="kpi.changeIcon" v-if="kpi.changeIcon" />
                                    <span>{{ kpi.changeText }}</span>
                                    <span class="text-medium-emphasis ms-1">{{ tt('vs') }} {{ kpi.previousValue }}</span>
                                </div>
                            </div>
                        </div>

                        <div class="report-stat-grid">
                            <div class="report-stat" :key="stat.label" v-for="stat in secondaryStats">
                                <div class="report-stat-label">{{ stat.label }}</div>
                                <div class="report-stat-value">{{ stat.value }}</div>
                                <div class="report-stat-hint" v-if="stat.hint">{{ stat.hint }}</div>
                            </div>
                        </div>

                        <v-card class="report-card">
                            <div class="report-card-title">{{ current.dailyAmounts.length > 62 ? tt('Monthly Income and Expense') : tt('Daily Income and Expense') }}</div>
                            <v-chart ref="incomeExpenseChart" class="report-chart" autoresize :option="incomeExpenseChartOption" />
                        </v-card>
                    </section>

                    <!-- 2. Categories -->
                    <section class="report-section">
                        <h2 class="report-section-title"><span class="report-section-number">2</span>{{ tt('Categories') }}</h2>

                        <v-card class="report-card" :key="group.key" v-for="group in categoryGroups">
                            <div class="report-card-title d-flex align-center">
                                <span>{{ group.title }}</span>
                                <v-spacer />
                                <span :class="group.amountClass">{{ formatAmount(group.total) }}</span>
                            </div>
                            <v-table class="report-table" density="compact">
                                <thead>
                                <tr>
                                    <th>{{ tt('Category') }}</th>
                                    <th class="text-end">{{ tt('Amount') }}</th>
                                    <th class="report-share-column">{{ tt('Share') }}</th>
                                    <th class="text-end">{{ tt('Transactions') }}</th>
                                    <th class="text-end">{{ previousPeriodShortLabel }}</th>
                                    <th class="text-end">{{ tt('Change') }}</th>
                                </tr>
                                </thead>
                                <tbody>
                                <tr v-if="!group.rows.length">
                                    <td colspan="6" class="text-center text-medium-emphasis">{{ tt('No data') }}</td>
                                </tr>
                                <template :key="row.categoryId" v-for="row in group.rows">
                                    <tr class="report-category-row">
                                        <td>
                                            <div class="d-flex align-center">
                                                <ItemIcon class="me-2" size="20px" :icon-type="getCategoryIconTypeById(row.categoryId)"
                                                          :icon-id="getCategoryIconId(row.categoryId)" :color="getCategoryColor(row.categoryId)" />
                                                <span class="font-weight-medium">{{ row.name || tt('Unknown') }}</span>
                                            </div>
                                        </td>
                                        <td class="text-end font-weight-medium">{{ formatAmount(row.amount) }}</td>
                                        <td><share-bar :percent="row.percent" :color="group.barColor" /></td>
                                        <td class="text-end">{{ formatCount(row.count) }}</td>
                                        <td class="text-end text-medium-emphasis">{{ formatAmount(row.previousAmount) }}</td>
                                        <td class="text-end" :class="getChangeClass(row.change.difference, group.increaseIsGood)">{{ formatChange(row.change) }}</td>
                                    </tr>
                                    <tr class="report-subcategory-row" :key="subRow.categoryId" v-for="subRow in row.subCategories">
                                        <td class="ps-10">{{ subRow.name || tt('Unknown') }}</td>
                                        <td class="text-end">{{ formatAmount(subRow.amount) }}</td>
                                        <td class="text-medium-emphasis">{{ formatPercent(subRow.percent) }}</td>
                                        <td class="text-end">{{ formatCount(subRow.count) }}</td>
                                        <td class="text-end text-medium-emphasis">{{ formatAmount(subRow.previousAmount) }}</td>
                                        <td class="text-end" :class="getChangeClass(subRow.change.difference, group.increaseIsGood)">{{ formatChange(subRow.change) }}</td>
                                    </tr>
                                </template>
                                </tbody>
                            </v-table>
                        </v-card>
                    </section>

                    <!-- 3. Cash flow and balances -->
                    <section class="report-section">
                        <h2 class="report-section-title"><span class="report-section-number">3</span>{{ tt('Cash Flow & Account Balances') }}</h2>

                        <div class="report-kpi-grid" v-if="netWorth">
                            <div class="report-kpi" :key="item.key" v-for="item in netWorthItems">
                                <div class="report-kpi-label">{{ item.label }}</div>
                                <div class="report-kpi-value">{{ item.closing }}</div>
                                <div class="report-kpi-change" :class="item.changeClass">
                                    <span>{{ item.changeText }}</span>
                                    <span class="text-medium-emphasis ms-1">{{ tt('from') }} {{ item.opening }}</span>
                                </div>
                            </div>
                        </div>

                        <v-card class="report-card">
                            <div class="report-card-title">{{ tt('Account Cash Flow') }}</div>
                            <v-table class="report-table report-table-wide" density="compact">
                                <thead>
                                <tr>
                                    <th>{{ tt('Account') }}</th>
                                    <th class="text-end">{{ tt('Opening Balance') }}</th>
                                    <th class="text-end">{{ tt('Income') }}</th>
                                    <th class="text-end">{{ tt('Expense') }}</th>
                                    <th class="text-end">{{ tt('Transfers') }}</th>
                                    <th class="text-end" v-if="hasBalanceAdjustments">{{ tt('Adjustment') }}</th>
                                    <th class="text-end">{{ tt('Closing Balance') }}</th>
                                    <th class="text-end">{{ tt('Change') }}</th>
                                </tr>
                                </thead>
                                <tbody>
                                <tr v-if="!cashFlowRows.length">
                                    <td :colspan="hasBalanceAdjustments ? 8 : 7" class="text-center text-medium-emphasis">{{ tt('No data') }}</td>
                                </tr>
                                <tr :key="row.account.id" v-for="row in cashFlowRows">
                                    <td>
                                        <div class="d-flex align-center">
                                            <ItemIcon class="me-2" size="20px" :icon-type="getAccountIconTypeById(row.account.id)"
                                                      :icon-id="getAccountIconId(row.account.id)" :color="getAccountColor(row.account.id)" />
                                            <span class="font-weight-medium">{{ row.account.name }}</span>
                                            <v-chip class="ms-2" size="x-small" variant="tonal" v-if="row.account.isLiability">{{ tt('Liability') }}</v-chip>
                                        </div>
                                    </td>
                                    <td class="text-end">{{ formatAmount(row.opening, row.account.currency) }}</td>
                                    <td class="text-end text-income">{{ formatFlow(row.income, row.account.currency) }}</td>
                                    <td class="text-end text-expense">{{ formatFlow(row.expense, row.account.currency) }}</td>
                                    <td class="text-end">{{ row.transferIn - row.transferOut === 0 ? '—' : formatSignedAmount(row.transferIn - row.transferOut, row.account.currency) }}</td>
                                    <td class="text-end" v-if="hasBalanceAdjustments">{{ formatFlow(row.adjustment, row.account.currency) }}</td>
                                    <td class="text-end font-weight-medium">{{ formatAmount(row.closing, row.account.currency) }}</td>
                                    <td class="text-end" :class="getChangeClass(row.closing - row.opening, true)">{{ formatSignedAmount(row.closing - row.opening, row.account.currency) }}</td>
                                </tr>
                                </tbody>
                            </v-table>
                        </v-card>
                    </section>

                    <!-- 4. Transactions and patterns -->
                    <section class="report-section">
                        <h2 class="report-section-title"><span class="report-section-number">4</span>{{ tt('Transactions & Patterns') }}</h2>

                        <v-card class="report-card" :key="group.key" v-for="group in topTransactionGroups">
                            <div class="report-card-title">{{ group.title }}</div>
                            <v-table class="report-table" density="compact">
                                <thead>
                                <tr>
                                    <th>#</th>
                                    <th>{{ tt('Date') }}</th>
                                    <th>{{ tt('Category') }}</th>
                                    <th>{{ tt('Account') }}</th>
                                    <th>{{ tt('Description') }}</th>
                                    <th class="text-end">{{ tt('Amount') }}</th>
                                    <th class="text-end">{{ tt('Share') }}</th>
                                </tr>
                                </thead>
                                <tbody>
                                <tr v-if="!group.rows.length">
                                    <td colspan="7" class="text-center text-medium-emphasis">{{ tt('No data') }}</td>
                                </tr>
                                <tr :key="row.transaction.id" v-for="(row, index) in group.rows">
                                    <td class="text-medium-emphasis">{{ index + 1 }}</td>
                                    <td class="text-no-wrap">{{ formatDateKey(row.dateKey) }}</td>
                                    <td class="text-no-wrap">{{ getCategoryName(row.transaction.categoryId) }}</td>
                                    <td class="text-no-wrap">{{ getAccountName(row.transaction.sourceAccountId) }}</td>
                                    <td class="report-description">{{ row.transaction.comment }}</td>
                                    <td class="text-end font-weight-medium" :class="group.amountClass">{{ formatAmount(row.amount) }}</td>
                                    <td class="text-end text-medium-emphasis">{{ formatPercent(group.total > 0 ? row.amount / group.total * 100 : 0) }}</td>
                                </tr>
                                </tbody>
                            </v-table>
                        </v-card>

                        <div class="report-two-columns">
                            <v-card class="report-card">
                                <div class="report-card-title">{{ tt('Average Expense by Day of Week') }}</div>
                                <v-chart ref="weekdayChart" class="report-chart report-chart-small" autoresize :option="weekdayChartOption" />
                                <div class="report-card-footnote" v-if="busiestWeekday">
                                    {{ tt('You spend the most on') }} <b>{{ busiestWeekday.name }}</b>,
                                    {{ tt('on average') }} <b>{{ formatAmount(busiestWeekday.average) }}</b> {{ tt('per day') }}.
                                </div>
                            </v-card>

                            <v-card class="report-card">
                                <div class="report-card-title">{{ tt('Highest Spending Days') }}</div>
                                <v-table class="report-table" density="compact">
                                    <thead>
                                    <tr>
                                        <th>{{ tt('Date') }}</th>
                                        <th class="text-end">{{ tt('Transactions') }}</th>
                                        <th class="text-end">{{ tt('Expense') }}</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    <tr v-if="!topSpendingDays.length">
                                        <td colspan="3" class="text-center text-medium-emphasis">{{ tt('No data') }}</td>
                                    </tr>
                                    <tr :key="day.dateKey" v-for="day in topSpendingDays">
                                        <td class="text-no-wrap">{{ formatDateKey(day.dateKey, true) }}</td>
                                        <td class="text-end">{{ formatCount(day.count) }}</td>
                                        <td class="text-end text-expense font-weight-medium">{{ formatAmount(day.expense) }}</td>
                                    </tr>
                                    </tbody>
                                </v-table>
                            </v-card>
                        </div>

                        <v-card class="report-card">
                            <div class="report-card-title">{{ tt('Recurring Expenses') }}</div>
                            <div class="report-card-subtitle">{{ tt('Expenses with the same description that appear more than once in this period') }}</div>
                            <v-table class="report-table" density="compact">
                                <thead>
                                <tr>
                                    <th>{{ tt('Description') }}</th>
                                    <th class="text-end">{{ tt('Times') }}</th>
                                    <th class="text-end">{{ tt('Average') }}</th>
                                    <th class="text-end">{{ tt('Total') }}</th>
                                    <th class="text-end">{{ tt('Share') }}</th>
                                </tr>
                                </thead>
                                <tbody>
                                <tr v-if="!current.frequentExpenseDescriptions.length">
                                    <td colspan="5" class="text-center text-medium-emphasis">{{ tt('No data') }}</td>
                                </tr>
                                <tr :key="row.description" v-for="row in current.frequentExpenseDescriptions">
                                    <td class="report-description">{{ row.description }}</td>
                                    <td class="text-end">{{ formatCount(row.count) }}×</td>
                                    <td class="text-end">{{ formatAmount(Math.round(row.amount / row.count)) }}</td>
                                    <td class="text-end text-expense font-weight-medium">{{ formatAmount(row.amount) }}</td>
                                    <td class="text-end text-medium-emphasis">{{ formatPercent(current.expense > 0 ? row.amount / current.expense * 100 : 0) }}</td>
                                </tr>
                                </tbody>
                            </v-table>
                        </v-card>
                    </section>
                </template>
            </div>
        </template>
    </main-page-layout>

    <date-range-selection-dialog :title="tt('Custom Date Range')"
                                 :min-time="customStartTime"
                                 :max-time="customEndTime"
                                 v-model:show="showCustomDateRangeDialog"
                                 @dateRange:change="setCustomDateRange"
                                 @error="onShowDateRangeError" />

    <snack-bar ref="snackbar" />
</template>

<script setup lang="ts">
import SnackBar from '@/components/desktop/SnackBar.vue';

import { ref, computed, useTemplateRef, watch, h, onMounted, onBeforeUnmount, type FunctionalComponent } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useUserStore } from '@/stores/user.ts';
import { useAccountsStore } from '@/stores/account.ts';
import { useTransactionCategoriesStore } from '@/stores/transactionCategory.ts';
import { useExchangeRatesStore } from '@/stores/exchangeRates.ts';

import { WeekDay } from '@/core/datetime.ts';
import type { TransactionInfoResponse, TransactionStatisticAssetTrendsResponseItem } from '@/models/transaction.ts';

import services from '@/lib/services.ts';
import logger from '@/lib/logger.ts';
import { parseBigDecimal } from '@/lib/numeral.ts';
import { parseDateTimeFromUnixTime } from '@/lib/datetime.ts';
import { getAccountIconType, getCategoryIconType } from '@/lib/icon.ts';
import {
    type ReportAccountInfo,
    type ReportCategoryInfo,
    type ReportChange,
    type ReportContext,
    type ReportDailyAmount,
    type ReportNetWorth,
    type ReportPeriodSummary,
    type ReportAccountCashFlowRow,
    type ReportCategoryComparisonRow,
    type ReportTransactionRow,
    buildReportAccountCashFlows,
    buildReportNetWorth,
    buildReportPeriodSummary,
    compareReportCategories,
    getReportAccountBalances,
    getReportChange
} from '@/lib/report.ts';

import {
    mdiArrowLeft,
    mdiArrowRight,
    mdiArrowDown,
    mdiArrowUp,
    mdiPrinterOutline,
    mdiRefresh
} from '@mdi/js';

type SnackBarType = InstanceType<typeof SnackBar>;
type ChartType = { $el: HTMLElement, resize: (options?: { width?: number | 'auto', height?: number | 'auto' }) => void };
type PeriodType = 'month' | 'year' | 'custom';

interface TimeRange {
    readonly startTime: number;
    readonly endTime: number;
}

const {
    tt,
    getWeekdayLongName,
    getWeekdayShortName,
    formatAmountToLocalizedNumeralsWithCurrency,
    formatNumberToLocalizedNumerals,
    formatPercentToLocalizedNumerals,
    formatDateTimeToLongDate,
    formatDateTimeToShortDate,
    formatDateTimeToGregorianLikeLongYearMonth,
    formatDateTimeToGregorianLikeShortYearMonth,
    formatDateTimeToGregorianLikeLongYear,
    formatDateTimeToLongDateTime
} = useI18n();

const userStore = useUserStore();
const accountsStore = useAccountsStore();
const transactionCategoriesStore = useTransactionCategoriesStore();
const exchangeRatesStore = useExchangeRatesStore();

const snackbar = useTemplateRef<SnackBarType>('snackbar');
const incomeExpenseChart = useTemplateRef<ChartType>('incomeExpenseChart');
const weekdayChart = useTemplateRef<ChartType>('weekdayChart');

const now = new Date();
const periodType = ref<PeriodType>('month');
const anchorYear = ref<number>(now.getFullYear());
const anchorMonth = ref<number>(now.getMonth()); // 0-based
const customStartTime = ref<number>(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
const customEndTime = ref<number>(Math.floor(now.getTime() / 1000));
const showCustomDateRangeDialog = ref<boolean>(false);
const loading = ref<boolean>(false);
const generatedTime = ref<number>(0);

const current = ref<ReportPeriodSummary | null>(null);
const previous = ref<ReportPeriodSummary | null>(null);
const cashFlowRows = ref<ReportAccountCashFlowRow[]>([]);
const netWorth = ref<ReportNetWorth | null>(null);
const chartColors = ref<{ income: string, expense: string, primary: string, grid: string, text: string }>({
    income: 'rgb(0, 150, 136)',
    expense: 'rgb(212, 63, 63)',
    primary: 'rgb(198, 126, 72)',
    grid: 'rgba(0, 0, 0, 0.08)',
    text: 'rgba(0, 0, 0, 0.6)'
});

let reloadSequence = 0;

const defaultCurrency = computed<string>(() => userStore.currentUserDefaultCurrency);

const currentRange = computed<TimeRange>(() => {
    if (periodType.value === 'year') {
        return {
            startTime: new Date(anchorYear.value, 0, 1).getTime() / 1000,
            endTime: new Date(anchorYear.value + 1, 0, 1).getTime() / 1000 - 1
        };
    } else if (periodType.value === 'custom') {
        return { startTime: customStartTime.value, endTime: customEndTime.value };
    }

    return {
        startTime: new Date(anchorYear.value, anchorMonth.value, 1).getTime() / 1000,
        endTime: new Date(anchorYear.value, anchorMonth.value + 1, 1).getTime() / 1000 - 1
    };
});

const previousRange = computed<TimeRange>(() => {
    if (periodType.value === 'year') {
        return {
            startTime: new Date(anchorYear.value - 1, 0, 1).getTime() / 1000,
            endTime: new Date(anchorYear.value, 0, 1).getTime() / 1000 - 1
        };
    } else if (periodType.value === 'custom') {
        const length = customEndTime.value - customStartTime.value + 1;
        return { startTime: customStartTime.value - length, endTime: customStartTime.value - 1 };
    }

    return {
        startTime: new Date(anchorYear.value, anchorMonth.value - 1, 1).getTime() / 1000,
        endTime: new Date(anchorYear.value, anchorMonth.value, 1).getTime() / 1000 - 1
    };
});

function formatRange(range: TimeRange, short: boolean): string {
    const start = parseDateTimeFromUnixTime(range.startTime);

    if (periodType.value === 'year') {
        return formatDateTimeToGregorianLikeLongYear(start);
    } else if (periodType.value === 'month') {
        return short ? formatDateTimeToGregorianLikeShortYearMonth(start) : formatDateTimeToGregorianLikeLongYearMonth(start);
    }

    const end = parseDateTimeFromUnixTime(range.endTime);

    if (short) {
        return `${formatDateTimeToShortDate(start)} - ${formatDateTimeToShortDate(end)}`;
    }

    return `${formatDateTimeToLongDate(start)} - ${formatDateTimeToLongDate(end)}`;
}

const periodLabel = computed<string>(() => formatRange(currentRange.value, false));
const previousPeriodLabel = computed<string>(() => formatRange(previousRange.value, false));
const previousPeriodShortLabel = computed<string>(() => periodType.value === 'custom' ? tt('Previous Period') : formatRange(previousRange.value, true));
const generatedTimeLabel = computed<string>(() => generatedTime.value ? formatDateTimeToLongDateTime(parseDateTimeFromUnixTime(generatedTime.value)) : '');

// ---------- formatting ----------

function formatAmount(amount: number, currency?: string): string {
    return formatAmountToLocalizedNumeralsWithCurrency(parseBigDecimal(Math.round(amount)), currency || defaultCurrency.value);
}

function formatSignedAmount(amount: number, currency?: string): string {
    if (amount === 0) {
        return formatAmount(0, currency);
    }

    return (amount > 0 ? '+' : '-') + formatAmount(Math.abs(amount), currency);
}

function formatFlow(amount: number, currency: string): string {
    return amount === 0 ? '—' : formatAmount(amount, currency);
}

function formatCount(count: number): string {
    return formatNumberToLocalizedNumerals(count);
}

function formatPercent(percent: number): string {
    return formatPercentToLocalizedNumerals(percent, 1, '<0.1');
}

function formatChange(change: ReportChange): string {
    if (change.difference === 0) {
        return '—';
    } else if (change.percent === null) {
        return tt('New');
    }

    return (change.percent > 0 ? '+' : '') + formatPercent(change.percent);
}

function getChangeClass(difference: number, increaseIsGood: boolean): string {
    if (difference === 0) {
        return 'text-medium-emphasis';
    }

    return (difference > 0) === increaseIsGood ? 'report-change-good' : 'report-change-bad';
}

function dateKeyToUnixTime(dateKey: number): number {
    return new Date(Math.trunc(dateKey / 10000), Math.trunc((dateKey % 10000) / 100) - 1, dateKey % 100).getTime() / 1000;
}

function formatDateKey(dateKey: number, withWeekday?: boolean): string {
    const dateTime = parseDateTimeFromUnixTime(dateKeyToUnixTime(dateKey));
    const text = formatDateTimeToLongDate(dateTime);

    if (!withWeekday) {
        return text;
    }

    return `${text} (${getWeekdayShortName(dateTime.getWeekDay())})`;
}

// ---------- lookups ----------

function getCategoryName(categoryId: string): string {
    const category = transactionCategoriesStore.allTransactionCategoriesMap[categoryId];
    return category ? category.name : tt('Unknown');
}

function getCategoryIconTypeById(categoryId: string) {
    const category = transactionCategoriesStore.allTransactionCategoriesMap[categoryId];
    return getCategoryIconType(category ? category.iconType : 0);
}

function getCategoryIconId(categoryId: string): string {
    const category = transactionCategoriesStore.allTransactionCategoriesMap[categoryId];
    return category ? category.icon : '';
}

function getCategoryColor(categoryId: string) {
    const category = transactionCategoriesStore.allTransactionCategoriesMap[categoryId];
    return category ? category.color : undefined;
}

function getAccountName(accountId: string): string {
    const account = accountsStore.allAccountsMap[accountId];
    return account ? account.name : tt('Unknown');
}

function getAccountIconTypeById(accountId: string) {
    const account = accountsStore.allAccountsMap[accountId];
    return getAccountIconType(account ? account.iconType : 0);
}

function getAccountIconId(accountId: string): string {
    const account = accountsStore.allAccountsMap[accountId];
    return account ? account.icon : '';
}

function getAccountColor(accountId: string) {
    const account = accountsStore.allAccountsMap[accountId];
    return account ? account.color : undefined;
}

// ---------- report data ----------

function buildContext(): ReportContext {
    const accounts: Record<string, ReportAccountInfo> = {};
    const categories: Record<string, ReportCategoryInfo> = {};

    for (const account of Object.values(accountsStore.allAccountsMap)) {
        const parentAccount = account.parentId && account.parentId !== '0' ? accountsStore.allAccountsMap[account.parentId] : undefined;

        accounts[account.id] = {
            id: account.id,
            name: parentAccount ? `${parentAccount.name} / ${account.name}` : account.name,
            currency: account.currency,
            isAsset: account.isAsset || false,
            isLiability: account.isLiability || false
        };
    }

    for (const category of Object.values(transactionCategoriesStore.allTransactionCategoriesMap)) {
        categories[category.id] = {
            id: category.id,
            name: category.name,
            parentId: category.parentId
        };
    }

    return {
        accounts: accounts,
        categories: categories,
        convert: (amount: number, currency: string): number | null => {
            if (currency === defaultCurrency.value) {
                return amount;
            }

            const exchangedAmount = exchangeRatesStore.getExchangedAmount(parseBigDecimal(amount), currency, defaultCurrency.value);
            return exchangedAmount ? exchangedAmount.truncate().toSafeIntegerNumber() : null;
        }
    };
}

function updateChartColors(): void {
    const element = document.querySelector('.v-application');

    if (!element) {
        return;
    }

    const style = getComputedStyle(element);
    const readColor = (name: string, fallback: string): string => {
        const value = style.getPropertyValue(name).trim();
        return value ? `rgb(${value})` : fallback;
    };
    const onSurface = style.getPropertyValue('--v-theme-on-surface').trim();

    chartColors.value = {
        income: readColor('--v-theme-income', chartColors.value.income),
        expense: readColor('--v-theme-expense', chartColors.value.expense),
        primary: readColor('--v-theme-primary', chartColors.value.primary),
        grid: onSurface ? `rgba(${onSurface}, 0.08)` : chartColors.value.grid,
        text: onSurface ? `rgba(${onSurface}, 0.6)` : chartColors.value.text
    };
}

function loadAllTransactions(range: TimeRange): Promise<TransactionInfoResponse[]> {
    return services.getAllTransactions({ startTime: range.startTime, endTime: range.endTime, withPictures: false }).then(response => {
        if (!response.data || !response.data.success || !response.data.result) {
            throw new Error('Unable to retrieve all transactions');
        }

        return response.data.result;
    });
}

function loadAccountDailyBalances(range: TimeRange): Promise<TransactionStatisticAssetTrendsResponseItem[]> {
    return services.getTransactionStatisticsAssetTrends({ startTime: range.startTime, endTime: range.endTime }).then(response => {
        if (!response.data || !response.data.success || !response.data.result) {
            throw new Error('Unable to retrieve account balances');
        }

        return response.data.result;
    });
}

function reload(): void {
    const sequence = ++reloadSequence;
    const range = currentRange.value;
    const previousPeriodRange = previousRange.value;

    loading.value = true;
    updateChartColors();

    Promise.all([
        accountsStore.loadAllAccounts({ force: false }),
        transactionCategoriesStore.loadAllCategories({ force: false }),
        // the previous period is right before the current period, so all transactions are loaded in one request
        loadAllTransactions({ startTime: previousPeriodRange.startTime, endTime: range.endTime }),
        loadAccountDailyBalances(range)
    ]).then(([, , transactions, dailyBalances]) => {
        if (sequence !== reloadSequence) {
            return;
        }

        const context = buildContext();
        const sortedDailyBalances = dailyBalances.slice().sort((a, b) => (a.year * 10000 + a.month * 100 + a.day) - (b.year * 10000 + b.month * 100 + b.day));
        const currentTime = Math.floor(Date.now() / 1000);
        const currentSummary = buildReportPeriodSummary(transactions, range.startTime, range.endTime, context, currentTime);
        const previousSummary = buildReportPeriodSummary(transactions, previousPeriodRange.startTime, previousPeriodRange.endTime, context, currentTime);
        const accounts = accountsStore.allPlainAccounts.map(account => context.accounts[account.id]).filter((account): account is ReportAccountInfo => !!account);

        current.value = currentSummary;
        previous.value = previousSummary;
        cashFlowRows.value = buildReportAccountCashFlows(accounts, currentSummary.accountFlows, getReportAccountBalances(sortedDailyBalances));
        netWorth.value = buildReportNetWorth(cashFlowRows.value, context.convert);
        generatedTime.value = Math.floor(Date.now() / 1000);
    }).catch(error => {
        if (sequence !== reloadSequence) {
            return;
        }

        logger.error('failed to load report data', error);

        if (error && error.response && error.response.data && error.response.data.errorMessage) {
            snackbar.value?.showError(error.response.data);
        } else if (!error || !error.processed) {
            snackbar.value?.showError('Unable to load report data');
        }
    }).finally(() => {
        if (sequence === reloadSequence) {
            loading.value = false;
        }
    });
}

function shiftPeriod(step: number): void {
    if (periodType.value === 'year') {
        anchorYear.value += step;
    } else if (periodType.value === 'month') {
        const date = new Date(anchorYear.value, anchorMonth.value + step, 1);
        anchorYear.value = date.getFullYear();
        anchorMonth.value = date.getMonth();
    }
}

function setCustomDateRange(minTime: number, maxTime: number): void {
    customStartTime.value = minTime;
    customEndTime.value = maxTime;
    showCustomDateRangeDialog.value = false;
    reload();
}

function onShowDateRangeError(message: string): void {
    snackbar.value?.showError(message);
}

// the width of the printable area of A4 paper (210mm - 2 * 12mm margins) in css pixels
const PRINT_CONTENT_WIDTH = 186 / 25.4 * 96;

// resizeChartsForPrint resizes the charts to the paper width, because the charts are drawn in the screen width
// and the charts are not redrawn automatically before printing
function resizeChartsForPrint(): void {
    const page = document.querySelector<HTMLElement>('.report-page');

    if (!page || !page.clientWidth) {
        return;
    }

    const ratio = Math.min(1, PRINT_CONTENT_WIDTH / page.clientWidth);

    for (const chart of [incomeExpenseChart.value, weekdayChart.value]) {
        if (chart && chart.$el && chart.$el.clientWidth) {
            chart.resize({ width: Math.floor(chart.$el.clientWidth * ratio), height: chart.$el.clientHeight });
        }
    }
}

function resizeChartsForScreen(): void {
    for (const chart of [incomeExpenseChart.value, weekdayChart.value]) {
        chart?.resize({ width: 'auto', height: 'auto' });
    }
}

function print(): void {
    resizeChartsForPrint();
    window.print();
}

// ---------- view models ----------

interface KpiItem {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly valueClass: string;
    readonly previousValue: string;
    readonly changeText: string;
    readonly changeClass: string;
    readonly changeIcon: string | null;
}

function buildKpi(key: string, label: string, currentValue: number, previousValue: number, increaseIsGood: boolean, valueClass: string, format: (value: number) => string, isPoint?: boolean): KpiItem {
    const change = getReportChange(currentValue, previousValue);
    let changeText: string;

    if (isPoint) {
        changeText = change.difference === 0 ? '—' : `${change.difference > 0 ? '+' : ''}${formatNumberToLocalizedNumerals(change.difference, 1)} ${tt('pts')}`;
    } else {
        changeText = formatChange(change);
    }

    return {
        key: key,
        label: label,
        value: format(currentValue),
        valueClass: valueClass,
        previousValue: format(previousValue),
        changeText: changeText,
        changeClass: getChangeClass(change.difference, increaseIsGood),
        changeIcon: change.difference === 0 ? null : (change.difference > 0 ? mdiArrowUp : mdiArrowDown)
    };
}

const kpis = computed<KpiItem[]>(() => {
    if (!current.value || !previous.value) {
        return [];
    }

    const cur = current.value;
    const prev = previous.value;

    return [
        buildKpi('income', tt('Income'), cur.income, prev.income, true, 'text-income', value => formatAmount(value)),
        buildKpi('expense', tt('Expense'), cur.expense, prev.expense, false, 'text-expense', value => formatAmount(value)),
        buildKpi('net', tt('Net Savings'), cur.net, prev.net, true, cur.net >= 0 ? 'text-income' : 'text-expense', value => formatSignedAmount(value)),
        buildKpi('rate', tt('Savings Rate'), cur.savingsRate ?? 0, prev.savingsRate ?? 0, true, '', value => formatPercent(value), true)
    ];
});

const secondaryStats = computed<{ label: string, value: string, hint?: string }[]>(() => {
    if (!current.value || !previous.value) {
        return [];
    }

    const cur = current.value;
    const topDay = topSpendingDays.value[0];

    return [
        {
            label: tt('Average Daily Expense'),
            value: formatAmount(cur.averageDailyExpense),
            hint: `${tt('Previous')}: ${formatAmount(previous.value.averageDailyExpense)}`
        },
        {
            label: tt('Average per Expense'),
            value: formatAmount(cur.averageExpensePerTransaction),
            hint: `${formatCount(cur.expenseCount)} ${tt('expense transactions')}`
        },
        {
            label: tt('Transactions'),
            value: formatCount(cur.incomeCount + cur.expenseCount + cur.transferCount),
            hint: `${formatCount(cur.incomeCount)} ${tt('income')} · ${formatCount(cur.expenseCount)} ${tt('expense')} · ${formatCount(cur.transferCount)} ${tt('transfer')}`
        },
        {
            label: tt('Days Without Spending'),
            value: `${formatCount(cur.noExpenseDayCount)} / ${formatCount(cur.dayCount)}`,
            hint: `${formatPercent(cur.noExpenseDayCount / cur.dayCount * 100)} ${tt('of the days so far')}`
        },
        {
            label: tt('Highest Spending Day'),
            value: topDay ? formatAmount(topDay.expense) : '—',
            hint: topDay ? formatDateKey(topDay.dateKey, true) : undefined
        },
        {
            label: tt('Transfers Between Accounts'),
            value: formatAmount(cur.transferAmount),
            hint: tt('Not counted as income or expense')
        }
    ];
});

interface CategoryGroup {
    readonly key: string;
    readonly title: string;
    readonly total: number;
    readonly rows: ReportCategoryComparisonRow[];
    readonly increaseIsGood: boolean;
    readonly amountClass: string;
    readonly barColor: string;
}

const categoryGroups = computed<CategoryGroup[]>(() => {
    if (!current.value || !previous.value) {
        return [];
    }

    return [
        {
            key: 'expense',
            title: tt('Expense by Category'),
            total: current.value.expense,
            rows: compareReportCategories(current.value.expenseCategories, previous.value.expenseCategories),
            increaseIsGood: false,
            amountClass: 'text-expense',
            barColor: chartColors.value.expense
        },
        {
            key: 'income',
            title: tt('Income by Category'),
            total: current.value.income,
            rows: compareReportCategories(current.value.incomeCategories, previous.value.incomeCategories),
            increaseIsGood: true,
            amountClass: 'text-income',
            barColor: chartColors.value.income
        }
    ];
});

const netWorthItems = computed(() => {
    if (!netWorth.value) {
        return [];
    }

    const value = netWorth.value;
    const build = (key: string, label: string, opening: number, closing: number, increaseIsGood: boolean) => {
        const change = getReportChange(closing, opening);

        return {
            key: key,
            label: label,
            opening: formatAmount(opening),
            closing: formatAmount(closing),
            changeText: `${formatSignedAmount(change.difference)} (${formatChange(change)})`,
            changeClass: getChangeClass(change.difference, increaseIsGood)
        };
    };

    return [
        build('assets', tt('Total Assets'), value.openingAssets, value.closingAssets, true),
        build('liabilities', tt('Total Liabilities'), value.openingLiabilities, value.closingLiabilities, false),
        build('netWorth', tt('Net Worth'), value.openingNetWorth, value.closingNetWorth, true)
    ];
});

const hasBalanceAdjustments = computed<boolean>(() => cashFlowRows.value.some(row => row.adjustment !== 0));

interface TopTransactionGroup {
    readonly key: string;
    readonly title: string;
    readonly rows: ReportTransactionRow[];
    readonly total: number;
    readonly amountClass: string;
}

const topTransactionGroups = computed<TopTransactionGroup[]>(() => {
    if (!current.value) {
        return [];
    }

    return [
        { key: 'expense', title: tt('Largest Expenses'), rows: current.value.topExpenses, total: current.value.expense, amountClass: 'text-expense' },
        { key: 'income', title: tt('Largest Income'), rows: current.value.topIncomes, total: current.value.income, amountClass: 'text-income' }
    ];
});

const topSpendingDays = computed<ReportDailyAmount[]>(() => {
    if (!current.value) {
        return [];
    }

    return current.value.dailyAmounts
        .filter(day => day.expense > 0)
        .slice()
        .sort((a, b) => b.expense - a.expense)
        .slice(0, 7);
});

const orderedWeekdays = computed<WeekDay[]>(() => {
    const firstDayOfWeek = userStore.currentUserFirstDayOfWeek;
    const weekdays: WeekDay[] = [];

    for (let i = 0; i < 7; i++) {
        const weekDay = WeekDay.valueOf((firstDayOfWeek + i) % 7);

        if (weekDay) {
            weekdays.push(weekDay);
        }
    }

    return weekdays;
});

const weekdayAverages = computed<{ weekDay: WeekDay, average: number }[]>(() => {
    if (!current.value) {
        return [];
    }

    const weekdayAmounts = current.value.weekdayAmounts;

    return orderedWeekdays.value.map(weekDay => {
        const amount = weekdayAmounts[weekDay.type];
        return {
            weekDay: weekDay,
            average: amount && amount.dayCount > 0 ? Math.round(amount.expense / amount.dayCount) : 0
        };
    });
});

const busiestWeekday = computed<{ name: string, average: number } | null>(() => {
    let busiest: { weekDay: WeekDay, average: number } | null = null;

    for (const item of weekdayAverages.value) {
        if (item.average > 0 && (!busiest || item.average > busiest.average)) {
            busiest = item;
        }
    }

    return busiest ? { name: getWeekdayLongName(busiest.weekDay), average: busiest.average } : null;
});

// ---------- charts ----------

function toChartAmount(amount: number): number {
    return amount / 100;
}

function getBaseAxisChartOption() {
    const colors = chartColors.value;

    return {
        animation: false,
        grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
        textStyle: { fontFamily: 'inherit' },
        legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 12, textStyle: { color: colors.text } },
        tooltip: {
            trigger: 'axis',
            valueFormatter: (value: number) => formatAmount(Math.round(value * 100))
        },
        yAxis: {
            type: 'value',
            axisLabel: { color: colors.text, formatter: (value: number) => formatNumberToLocalizedNumerals(value) },
            splitLine: { lineStyle: { color: colors.grid } }
        }
    };
}

const incomeExpenseChartOption = computed(() => {
    if (!current.value) {
        return {};
    }

    const colors = chartColors.value;
    const isMonthly = current.value.dailyAmounts.length > 62;
    const labels: string[] = [];
    const incomes: number[] = [];
    const expenses: number[] = [];

    if (isMonthly) {
        const monthlyAmounts = new Map<number, { income: number, expense: number }>();

        for (const day of current.value.dailyAmounts) {
            const yearMonth = Math.trunc(day.dateKey / 100);
            const monthlyAmount = monthlyAmounts.get(yearMonth) ?? { income: 0, expense: 0 };
            monthlyAmount.income += day.income;
            monthlyAmount.expense += day.expense;
            monthlyAmounts.set(yearMonth, monthlyAmount);
        }

        for (const [yearMonth, amount] of monthlyAmounts) {
            labels.push(formatDateTimeToGregorianLikeShortYearMonth(parseDateTimeFromUnixTime(dateKeyToUnixTime(yearMonth * 100 + 1))));
            incomes.push(toChartAmount(amount.income));
            expenses.push(toChartAmount(amount.expense));
        }
    } else {
        for (const day of current.value.dailyAmounts) {
            labels.push(String(day.dateKey % 100));
            incomes.push(toChartAmount(day.income));
            expenses.push(toChartAmount(day.expense));
        }
    }

    let cumulativeExpense = 0;
    const cumulativeExpenses = expenses.map(value => (cumulativeExpense += value));

    return {
        ...getBaseAxisChartOption(),
        xAxis: {
            type: 'category',
            data: labels,
            axisTick: { show: false },
            axisLine: { lineStyle: { color: colors.grid } },
            axisLabel: { color: colors.text }
        },
        series: [
            { name: tt('Income'), type: 'bar', data: incomes, itemStyle: { color: colors.income, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
            { name: tt('Expense'), type: 'bar', data: expenses, itemStyle: { color: colors.expense, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
            {
                name: tt('Cumulative Expense'),
                type: 'line',
                data: cumulativeExpenses,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: colors.primary, width: 2, type: 'dashed' },
                itemStyle: { color: colors.primary }
            }
        ]
    };
});

const weekdayChartOption = computed(() => {
    const colors = chartColors.value;
    const maxAverage = Math.max(0, ...weekdayAverages.value.map(item => item.average));

    return {
        ...getBaseAxisChartOption(),
        legend: { show: false },
        grid: { left: 8, right: 8, top: 12, bottom: 8, containLabel: true },
        xAxis: {
            type: 'category',
            data: weekdayAverages.value.map(item => getWeekdayShortName(item.weekDay)),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: colors.grid } },
            axisLabel: { color: colors.text }
        },
        series: [
            {
                name: tt('Average Expense'),
                type: 'bar',
                barMaxWidth: 36,
                data: weekdayAverages.value.map(item => ({
                    value: toChartAmount(item.average),
                    itemStyle: {
                        color: item.average === maxAverage && maxAverage > 0 ? colors.expense : colors.grid.replace('0.08', '0.25'),
                        borderRadius: [4, 4, 0, 0]
                    }
                }))
            }
        ]
    };
});

// ShareBar renders a horizontal bar of the percentage and the percentage text
const ShareBar: FunctionalComponent<{ percent: number, color: string }> = (props) => {
    return h('div', { class: 'report-share' }, [
        h('div', { class: 'report-share-track' }, [
            h('div', { class: 'report-share-fill', style: { width: `${Math.min(100, Math.max(0, props.percent))}%`, backgroundColor: props.color } })
        ]),
        h('span', { class: 'report-share-text' }, formatPercent(props.percent))
    ]);
};

onMounted(() => {
    window.addEventListener('beforeprint', resizeChartsForPrint);
    window.addEventListener('afterprint', resizeChartsForScreen);
});

onBeforeUnmount(() => {
    window.removeEventListener('beforeprint', resizeChartsForPrint);
    window.removeEventListener('afterprint', resizeChartsForScreen);
});

watch([periodType, anchorYear, anchorMonth], ([newPeriodType]) => {
    if (newPeriodType === 'custom') {
        return; // reloaded after selecting the date range
    }

    reload();
});

reload();
</script>

<style>
.report-page {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 1280px;
    margin: 0 auto;
    width: 100%;
}

.report-header {
    padding: 24px;
}

.report-eyebrow {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em !important;
    text-transform: uppercase;
    color: rgb(var(--v-theme-primary));
}

.report-title {
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1.25;
    margin: 4px 0;
}

.report-subtitle {
    font-size: 0.875rem;
    color: rgba(var(--v-theme-on-surface), 0.6);
}

.report-print-only {
    display: none;
}

.report-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.report-section-title {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1.25rem;
    font-weight: 700;
    margin: 8px 0 0;
}

.report-section-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    font-size: 0.875rem;
    color: rgb(var(--v-theme-on-primary));
    background-color: rgb(var(--v-theme-primary));
}

.report-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
}

.report-kpi {
    padding: 18px 20px;
    border-radius: 12px;
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    background-color: rgb(var(--v-theme-surface));
}

.report-kpi-label,
.report-stat-label {
    font-size: 0.8125rem;
    color: rgba(var(--v-theme-on-surface), 0.6);
}

.report-kpi-value {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 6px 0 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.report-kpi-change {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.report-kpi-change .text-medium-emphasis {
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
}

.report-stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1px;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    background-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.report-stat {
    padding: 14px 16px;
    background-color: rgb(var(--v-theme-surface));
}

.report-stat-value {
    font-size: 1.0625rem;
    font-weight: 700;
    margin-top: 4px;
}

.report-stat-hint {
    font-size: 0.75rem;
    margin-top: 2px;
    color: rgba(var(--v-theme-on-surface), 0.6);
}

.report-card {
    padding: 20px;
}

.report-card-title {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 12px;
}

.report-card-subtitle {
    font-size: 0.8125rem;
    margin: -8px 0 12px;
    color: rgba(var(--v-theme-on-surface), 0.6);
}

.report-card-footnote {
    font-size: 0.8125rem;
    margin-top: 8px;
    color: rgba(var(--v-theme-on-surface), 0.7);
}

.report-chart {
    height: 300px;
    width: 100%;
}

.report-chart-small {
    height: 220px;
}

.report-two-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));
    gap: 16px;
}

.report-table th {
    font-size: 0.75rem !important;
    font-weight: 600 !important;
    text-transform: uppercase;
    letter-spacing: 0.04em !important;
    color: rgba(var(--v-theme-on-surface), 0.6) !important;
    white-space: nowrap;
}

.report-table td {
    font-size: 0.875rem;
    white-space: nowrap;
}

.report-table .report-description {
    white-space: normal;
    min-width: 160px;
}

.report-subcategory-row td {
    font-size: 0.8125rem;
    color: rgba(var(--v-theme-on-surface), 0.8);
}

.report-table-wide {
    overflow-x: auto;
}

.report-share-column {
    width: 180px;
}

.report-share {
    display: flex;
    align-items: center;
    gap: 8px;
}

.report-share-track {
    flex: 1;
    height: 6px;
    min-width: 60px;
    border-radius: 3px;
    overflow: hidden;
    background-color: rgba(var(--v-theme-on-surface), 0.08);
}

.report-share-fill {
    height: 100%;
    border-radius: 3px;
}

.report-share-text {
    width: 48px;
    text-align: end;
    font-size: 0.8125rem;
    color: rgba(var(--v-theme-on-surface), 0.7);
}

.report-page .report-change-good {
    color: rgb(var(--v-theme-success));
}

.report-page .report-change-bad {
    color: rgb(var(--v-theme-error));
}

@media print {
    @page {
        size: A4;
        margin: 12mm;
    }

    html {
        font-size: 10px !important;
    }

    html,
    body,
    .v-application,
    .v-main {
        background: #fff !important;
    }

    .layout-navbar,
    .layout-nav-type-vertical .layout-vertical-nav,
    .report-toolbar,
    .v-snackbar {
        display: none !important;
    }

    .layout-content-wrapper,
    .layout-page-content,
    .v-main {
        padding: 0 !important;
        margin: 0 !important;
    }

    .report-page {
        max-width: none;
        gap: 14px;
    }

    .report-kpi-grid {
        grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
        gap: 8px;
    }

    .report-kpi,
    .report-card,
    .report-header {
        padding: 10px 12px !important;
    }

    .report-kpi-value,
    .report-kpi-change {
        white-space: normal;
        overflow: visible;
        flex-wrap: wrap;
    }

    .report-stat-grid {
        grid-template-columns: repeat(3, 1fr);
    }

    .report-table .v-table__wrapper {
        overflow: visible !important;
    }

    .report-table th,
    .report-table td {
        white-space: normal !important;
        height: auto !important;
        padding: 4px 6px !important;
    }

    .report-share-column {
        width: auto;
    }

    .report-share-track {
        min-width: 24px;
    }


    .report-print-only {
        display: inline;
    }

    .report-header,
    .report-card,
    .report-kpi {
        box-shadow: none !important;
        border: 1px solid #ddd !important;
    }

    /* the page break properties are ignored in flex containers, so uses block layout when printing */
    .report-page,
    .report-section {
        display: block;
    }

    .report-page > *,
    .report-section > * {
        margin-bottom: 12px;
    }

    .report-card,
    .report-kpi-grid,
    .report-stat-grid,
    .report-table tr {
        break-inside: avoid;
    }

    .report-section-title {
        break-after: avoid;
    }

    .report-two-columns {
        grid-template-columns: 1fr 1fr;
    }

    .report-chart {
        overflow: hidden;
    }
}
</style>
