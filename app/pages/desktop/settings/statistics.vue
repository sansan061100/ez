<template>
    <statistics-setting-page />
</template>

<script setup lang="ts">
import StatisticsSettingPage from '@/views/desktop/settings/StatisticsSettingPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
