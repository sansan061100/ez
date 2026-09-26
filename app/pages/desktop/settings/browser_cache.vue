<template>
    <browser-cache-setting-page />
</template>

<script setup lang="ts">
import BrowserCacheSettingPage from '@/views/desktop/settings/BrowserCacheSettingPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
