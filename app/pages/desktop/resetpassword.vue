<template>
    <reset-password-page v-bind="pageProps" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import ResetPasswordPage from '@/views/desktop/ResetPasswordPage.vue';

import { getRouteQueryValue } from '@/lib/route.ts';

const route = useRoute();

const pageProps = computed(() => ({
    token: getRouteQueryValue(route, 'token')
}));
</script>
