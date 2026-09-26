<template>
    <account-list-page />
</template>

<script setup lang="ts">
import AccountListPage from '@/views/desktop/accounts/ListPage.vue';

definePageMeta({
    middleware: 'desktop-require-login'
});
</script>
