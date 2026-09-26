<template>
    <verify-email-page v-bind="pageProps" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import VerifyEmailPage from '@/views/desktop/VerifyEmailPage.vue';

import { getRouteQueryValue } from '@/lib/route.ts';

const route = useRoute();

const pageProps = computed(() => ({
    email: getRouteQueryValue(route, 'email'),
    token: getRouteQueryValue(route, 'token'),
    hasValidEmailVerifyToken: route.query['emailSent'] === 'true'
}));
</script>
