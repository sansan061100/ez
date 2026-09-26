<template>
    <application-lock-page />
</template>

<script setup lang="ts">
import ApplicationLockPage from '@/views/desktop/settings/ApplicationLockPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
