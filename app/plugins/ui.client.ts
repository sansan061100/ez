import { type I18n, createI18n } from 'vue-i18n';

import { getI18nOptions } from '@/locales/helpers.ts';
import { getUiMode } from '@/lib/web.ts';

// installs the i18n and the ui framework before the application is mounted
export default defineNuxtPlugin({
    name: 'ezbookkeeping-ui',
    dependsOn: ['pinia'],
    async setup(nuxtApp) {
        const uiMode = getUiMode();

        if (uiMode === 'index') {
            return;
        }

        const i18n = createI18n(getI18nOptions()) as I18n<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, string, false>;
        nuxtApp.vueApp.use(i18n);

        if (uiMode === 'desktop') {
            const { setupDesktopApp } = await import('@/setup/desktop.ts');
            setupDesktopApp(nuxtApp.vueApp, i18n);
        }
    }
});
