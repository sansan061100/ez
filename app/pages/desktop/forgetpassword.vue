<template>
    <forget-password-page />
</template>

<script setup lang="ts">
import ForgetPasswordPage from '@/views/desktop/ForgetPasswordPage.vue';

definePageMeta({
    middleware: 'desktop-require-not-login'
});
</script>
