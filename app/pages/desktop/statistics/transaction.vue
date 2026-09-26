<template>
    <statistics-transaction-page v-bind="pageProps" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import StatisticsTransactionPage from '@/views/desktop/statistics/TransactionPage.vue';

import type { TextualYearMonth } from '@/core/datetime.ts';

import { getRouteQueryValue } from '@/lib/route.ts';

definePageMeta({
    middleware: 'desktop-require-login'
});

const route = useRoute();

const pageProps = computed(() => ({
    initAnalysisType: getRouteQueryValue(route, 'analysisType'),
    initChartDataType: getRouteQueryValue(route, 'chartDataType'),
    initChartType: getRouteQueryValue(route, 'chartType'),
    initChartDateType: getRouteQueryValue(route, 'chartDateType'),
    initStartTime: getRouteQueryValue<TextualYearMonth>(route, 'startTime'),
    initEndTime: getRouteQueryValue<TextualYearMonth>(route, 'endTime'),
    initFilterAccountIds: getRouteQueryValue(route, 'filterAccountIds'),
    initFilterCategoryIds: getRouteQueryValue(route, 'filterCategoryIds'),
    initTagFilter: getRouteQueryValue(route, 'tagFilter'),
    initKeyword: getRouteQueryValue(route, 'keyword'),
    initMatchMode: getRouteQueryValue(route, 'matchMode'),
    initSortingType: getRouteQueryValue(route, 'sortingType'),
    initTrendDateAggregationType: getRouteQueryValue(route, 'trendDateAggregationType'),
    initAssetTrendsDateAggregationType: getRouteQueryValue(route, 'assetTrendsDateAggregationType')
}));
</script>
