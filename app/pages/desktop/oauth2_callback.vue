<template>
    <o-auth2-callback-page v-bind="pageProps" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import OAuth2CallbackPage from '@/views/desktop/OAuth2CallbackPage.vue';

import { getRouteQueryValue } from '@/lib/route.ts';

const route = useRoute();

const pageProps = computed(() => ({
    token: getRouteQueryValue(route, 'token'),
    provider: getRouteQueryValue(route, 'provider'),
    platform: getRouteQueryValue(route, 'platform'),
    userName: getRouteQueryValue(route, 'userName'),
    errorCode: getRouteQueryValue(route, 'errorCode'),
    errorMessage: getRouteQueryValue(route, 'errorMessage')
}));
</script>
