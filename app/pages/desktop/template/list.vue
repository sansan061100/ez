<template>
    <transaction-template-list-page :init-type="TemplateType.Normal.type" />
</template>

<script setup lang="ts">
import TransactionTemplateListPage from '@/views/desktop/templates/ListPage.vue';

import { TemplateType } from '@/core/template.ts';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>
