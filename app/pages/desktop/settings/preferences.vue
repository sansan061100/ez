<template>
    <preferences-settings-page />
</template>

<script setup lang="ts">
import PreferencesSettingsPage from '@/views/desktop/settings/PreferencesSettingsPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
