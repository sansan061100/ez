<template>
    <two-factor-auth-page />
</template>

<script setup lang="ts">
import TwoFactorAuthPage from '@/views/desktop/users/TwoFactorAuthPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
