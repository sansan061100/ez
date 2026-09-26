<template>
    <user-security-setting-page />
</template>

<script setup lang="ts">
import UserSecuritySettingPage from '@/views/desktop/users/UserSecuritySettingPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
