<template>
    <transaction-tag-list-page />
</template>

<script setup lang="ts">
import TransactionTagListPage from '@/views/desktop/tags/ListPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
