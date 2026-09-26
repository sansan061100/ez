<template>
    <exchange-rates-list-page />
</template>

<script setup lang="ts">
import ExchangeRatesListPage from '@/views/desktop/exchangerates/ListPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
