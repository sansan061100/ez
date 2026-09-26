<template>
    <data-management-page />
</template>

<script setup lang="ts">
import DataManagementPage from '@/views/desktop/users/DataManagementPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
