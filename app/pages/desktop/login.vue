<template>
    <login-page />
</template>

<script setup lang="ts">
import LoginPage from '@/views/desktop/LoginPage.vue';

definePageMeta({
    middleware: 'desktop-require-not-login'
});
</script>
