<template>
    <v-app>
        <slot />
    </v-app>
    <v-snackbar class="cursor-pointer" color="notification-background" location="top"
                :multi-line="true" :timeout="-1" :close-on-content-click="true" v-model="showNotification">
        <v-tooltip activator="parent">{{ tt('Click to close') }}</v-tooltip>
        <div class="d-inline-flex">
            <img alt="logo" class="notification-logo" :src="APPLICATION_LOGO_PATH" />
            <span class="ms-2">{{ tt('global.app.title') }}</span>
        </div>
        <div>
            {{ currentNotificationContent }}
        </div>
    </v-snackbar>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

import { useTheme } from 'vuetify';
import { register } from 'register-service-worker';

import { useI18n } from '@/locales/helpers.ts';

import { useRootStore } from '@/stores/index.ts';
import { useSettingsStore } from '@/stores/setting.ts';
import { useUserStore } from '@/stores/user.ts';
import { useTokensStore } from '@/stores/token.ts';
import { useExchangeRatesStore } from '@/stores/exchangeRates.ts';

import { APPLICATION_LOGO_PATH } from '@/consts/asset.ts';
import { ThemeType, isKnownTheme } from '@/core/theme.ts';
import { isProduction } from '@/lib/version.ts';
import { getBasePath, getUiModeBasePath } from '@/lib/web.ts';
import { initMapProvider } from '@/lib/map/index.ts';
import { isUserLogined, isUserUnlocked } from '@/lib/userstate.ts';
import { updateMapCacheExpiration } from '@/lib/cache.ts';
import { getSystemTheme, setExpenseAndIncomeAmountColor } from '@/lib/ui/common.ts';

const { tt, getCurrentLanguageInfo, setLanguage, initLocale } = useI18n();

const theme = useTheme();

const rootStore = useRootStore();
const settingsStore = useSettingsStore();
const userStore = useUserStore();
const tokensStore = useTokensStore();
const exchangeRatesStore = useExchangeRatesStore();

const initialRoutePath: string = window.location.pathname.substring(getUiModeBasePath('desktop').length) || '/';

const showNotification = ref<boolean>(false);

const currentNotificationContent = computed<string | null>(() => rootStore.currentNotification);

onMounted(() => {
    const initMap = () => {
        const languageInfo = getCurrentLanguageInfo();
        initMapProvider(languageInfo?.alternativeLanguageTag);
    };

    // the application may be mounted after the document is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMap);
    } else {
        initMap();
    }
});

watch(currentNotificationContent, (newValue) => {
    showNotification.value = !!newValue;
});

theme.change(isKnownTheme(settingsStore.appSettings.theme) ? settingsStore.appSettings.theme : getSystemTheme());

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (settingsStore.appSettings.theme === 'auto') {
        if (e.matches) {
            theme.change(ThemeType.Dark);
        } else {
            theme.change(ThemeType.Light);
        }
    }
});

let localeDefaultSettings = initLocale(userStore.currentUserLanguage, settingsStore.appSettings.timeZone);
settingsStore.updateLocalizedDefaultSettings(localeDefaultSettings);

setExpenseAndIncomeAmountColor(userStore.currentUserExpenseAmountColor, userStore.currentUserIncomeAmountColor);

if (isUserLogined() && initialRoutePath !== '/verify_email' && initialRoutePath !== '/resetpassword' && initialRoutePath !== '/oauth2_callback') {
    if (!settingsStore.appSettings.applicationLock || isUserUnlocked()) {
        // refresh token if user is logined
        tokensStore.refreshTokenAndRevokeOldToken().then(response => {
            if (response.user) {
                localeDefaultSettings = setLanguage(response.user.language);
                settingsStore.updateLocalizedDefaultSettings(localeDefaultSettings);

                setExpenseAndIncomeAmountColor(response.user.expenseAmountColor, response.user.incomeAmountColor);

                if (response.notificationContent) {
                    rootStore.setNotificationContent(response.notificationContent);
                }
            }

            updateMapCacheExpiration(settingsStore.appSettings.mapCacheExpiration);
            exchangeRatesStore.removeExpiredExchangeRates(true);
            exchangeRatesStore.autoUpdateExchangeRatesData();
        });
    }
}

if (isProduction()) {
    register(`${getBasePath()}/sw.js`, {
        registrationOptions: {
            scope: `${getBasePath()}/`
        }
    });
}
</script>

<style>
.notification-logo {
    width: 1.2rem;
    height: 1.2rem;
}
</style>
