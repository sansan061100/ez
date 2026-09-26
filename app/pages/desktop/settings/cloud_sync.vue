<template>
    <application-cloud-sync-settings-page />
</template>

<script setup lang="ts">
import ApplicationCloudSyncSettingsPage from '@/views/desktop/settings/ApplicationCloudSyncSettingsPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
