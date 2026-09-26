<template>
    <user-basic-setting-page />
</template>

<script setup lang="ts">
import UserBasicSettingPage from '@/views/desktop/users/UserBasicSettingPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
