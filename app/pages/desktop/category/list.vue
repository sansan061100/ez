<template>
    <transaction-category-list-page />
</template>

<script setup lang="ts">
import TransactionCategoryListPage from '@/views/desktop/categories/ListPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
