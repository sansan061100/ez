<template>
    <insights-explorer-page v-bind="pageProps" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import InsightsExplorerPage from '@/views/desktop/insights/ExplorerPage.vue';

import { getRouteQueryValue } from '@/lib/route.ts';

definePageMeta({
    middleware: 'desktop-require-login'
});

const route = useRoute();

const pageProps = computed(() => ({
    initId: getRouteQueryValue(route, 'id'),
    initActiveTab: getRouteQueryValue(route, 'activeTab'),
    initDateRangeType: getRouteQueryValue(route, 'dateRangeType'),
    initStartTime: getRouteQueryValue(route, 'startTime'),
    initEndTime: getRouteQueryValue(route, 'endTime')
}));
</script>
