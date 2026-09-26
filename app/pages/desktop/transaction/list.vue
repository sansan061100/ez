<template>
    <transaction-list-page v-bind="pageProps" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import TransactionListPage from '@/views/desktop/transactions/ListPage.vue';

import { getRouteQueryValue } from '@/lib/route.ts';

definePageMeta({
    middleware: 'desktop-require-login'
});

const route = useRoute();

const pageProps = computed(() => ({
    initPageType: getRouteQueryValue(route, 'pageType'),
    initDateType: getRouteQueryValue(route, 'dateType'),
    initMaxTime: getRouteQueryValue(route, 'maxTime'),
    initMinTime: getRouteQueryValue(route, 'minTime'),
    initType: getRouteQueryValue(route, 'type'),
    initCategoryIds: getRouteQueryValue(route, 'categoryIds'),
    initAccountIds: getRouteQueryValue(route, 'accountIds'),
    initTagFilter: getRouteQueryValue(route, 'tagFilter'),
    initAmountFilter: getRouteQueryValue(route, 'amountFilter'),
    initKeyword: getRouteQueryValue(route, 'keyword'),
    initMatchMode: getRouteQueryValue(route, 'matchMode')
}));
</script>
