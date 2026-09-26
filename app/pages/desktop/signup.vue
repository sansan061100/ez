<template>
    <sign-up-page />
</template>

<script setup lang="ts">
import SignUpPage from '@/views/desktop/SignupPage.vue';

definePageMeta({
    middleware: 'desktop-require-not-login'
});
</script>
