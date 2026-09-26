<template>
    <report-page />
</template>

<script setup lang="ts">
import ReportPage from '@/views/desktop/reports/ReportPage.vue';

definePageMeta({
    middleware: 'desktop-require-login'
});
</script>
