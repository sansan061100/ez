import { type I18n, createI18n } from 'vue-i18n';

import { getI18nOptions } from '@/locales/helpers.ts';
import { getUiMode } from '@/lib/web.ts';

function setMetaContent(name: string, content: string): void {
    document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content);
}

// installs the i18n and the ui framework of current version (desktop or mobile) before the application is mounted
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
        } else if (uiMode === 'mobile') {
            const html = document.documentElement;
            html.setAttribute('data-dir-mode', 'static');

            setMetaContent('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover');
            setMetaContent('apple-mobile-web-app-status-bar-style', 'black-translucent');
            setMetaContent('theme-color', '#f6f6f8');

            // the framework7 styles must be loaded before the styles of the application
            if (window.location.search.includes('rtl')) {
                html.setAttribute('dir', 'rtl');
                await import('@/mobile-rtl.scss');
            } else {
                html.removeAttribute('dir');
                await import('@/mobile-ltr.scss');
            }

            const { setupMobileApp } = await import('@/setup/mobile.ts');
            setupMobileApp(nuxtApp.vueApp);
        }
    }
});
