import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import vuetify from 'vite-plugin-vuetify';

import packageFile from './package.json';
import contributorsFile from './contributors.json';
import thirdPartyLicenseFile from './third-party-dependencies.json';

const licenseContent = fs.readFileSync('./LICENSE', { encoding: 'utf-8' });
const buildUnixTime = process.env['buildUnixTime'] || '';
const baseURL = process.env['NUXT_APP_BASE_URL'] || '/';

const commitHash = ((): string => {
    try {
        return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '';
    }
})();

// [device width, device height, device pixel ratio, file name prefix] of the apple touch startup images
const appleTouchStartupImages: [number, number, number, string][] = [
    [440, 956, 3, 'iPhone_17_Pro_Max__iPhone_16_Pro_Max'],
    [402, 874, 3, 'iPhone_17_Pro__iPhone_17__iPhone_16_Pro'],
    [430, 932, 3, 'iPhone_17_Air__iPhone_16_Plus__iPhone_15_Pro_Max__iPhone_15_Plus__iPhone_14_Pro_Max'],
    [393, 852, 3, 'iPhone_16__iPhone_15_Pro__iPhone_15__iPhone_14_Pro'],
    [428, 926, 3, 'iPhone_14_Plus__iPhone_13_Pro_Max__iPhone_12_Pro_Max'],
    [390, 844, 3, 'iPhone_16e__iPhone_14__iPhone_13_Pro__iPhone_13__iPhone_12_Pro__iPhone_12'],
    [375, 812, 3, 'iPhone_13_mini__iPhone_12_mini__iPhone_11_Pro__iPhone_XS__iPhone_X'],
    [414, 896, 3, 'iPhone_11_Pro_Max__iPhone_XS_Max'],
    [414, 896, 2, 'iPhone_11__iPhone_XR'],
    [414, 736, 3, 'iPhone_8_Plus__iPhone_7_Plus__iPhone_6s_Plus__iPhone_6_Plus'],
    [375, 667, 2, 'iPhone_8__iPhone_7__iPhone_6s__iPhone_6__4.7__iPhone_SE'],
    [320, 568, 2, '4__iPhone_SE__iPod_touch_5th_generation_and_later'],
    [1032, 1376, 2, '13__iPad_Pro_M4'],
    [1024, 1366, 2, '12.9__iPad_Pro'],
    [834, 1210, 2, '11__iPad_Pro_M4'],
    [834, 1194, 2, '11__iPad_Pro__10.5__iPad_Pro'],
    [820, 1180, 2, '10.9__iPad_Air'],
    [834, 1112, 2, '10.5__iPad_Air'],
    [810, 1080, 2, '10.2__iPad'],
    [768, 1024, 2, '9.7__iPad_Pro__7.9__iPad_mini__9.7__iPad_Air__9.7__iPad'],
    [744, 1133, 2, '8.3__iPad_Mini']
];

function getAppleTouchStartupImageLinks(): { rel: 'apple-touch-startup-image', media: string, href: string }[] {
    const links: { rel: 'apple-touch-startup-image', media: string, href: string }[] = [];

    for (const orientation of ['landscape', 'portrait']) {
        for (const [width, height, ratio, fileNamePrefix] of appleTouchStartupImages) {
            links.push({
                rel: 'apple-touch-startup-image',
                media: `screen and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
                href: `${baseURL}img/splash_screens/${fileNamePrefix}_${orientation}.png`
            });
        }
    }

    return links;
}

const framework7Components = [
    'accordion', 'actions', 'card', 'checkbox', 'chip', 'color-picker', 'dialog', 'fab', 'form', 'grid', 'infinite-scroll',
    'input', 'login-screen', 'notification', 'photo-browser', 'picker', 'popover', 'popup', 'preloader', 'progressbar',
    'pull-to-refresh', 'radio', 'range', 'searchbar', 'sheet', 'skeleton', 'sortable', 'swipeout', 'swiper', 'toast',
    'toggle', 'tooltip', 'treeview', 'typography', 'virtual-list'
];

const vuetifyComponents = [
    'VAlert', 'VApp', 'VAutocomplete', 'VAvatar', 'VBadge', 'VBtn', 'VBtnGroup', 'VBtnToggle', 'VCard', 'VCheckbox', 'VChip',
    'VColorPicker', 'VDataTable', 'VDialog', 'VDivider', 'VExpansionPanel', 'VForm', 'VGrid', 'VIcon', 'VImg', 'VInput',
    'VLabel', 'VLayout', 'VList', 'VMain', 'VMenu', 'VNavigationDrawer', 'VOverlay', 'VPagination', 'VProgressCircular',
    'VProgressLinear', 'VSelect', 'VSkeletonLoader', 'VSlideGroup', 'VSnackbar', 'VSwitch', 'VTable', 'VTabs', 'VTextarea',
    'VTextField', 'VToolbar', 'VTooltip', 'VWindow'
];

const optimizedDependencies = [
    '@mdi/js',
    '@vuepic/vue-datepicker',
    'axios',
    'cbor-js',
    'clipboard',
    'crypto-js',
    'decimal.js',
    'echarts/charts',
    'echarts/components',
    'echarts/core',
    'echarts/renderers',
    'framework7/lite',
    ...framework7Components.map(name => `framework7/components/${name}`),
    'framework7-vue',
    'framework7-vue/bundle',
    'jalaali-js',
    'leaflet/dist/leaflet-src.esm.js',
    'moment/moment',
    'moment-timezone',
    'moment-timezone/moment-timezone-utils',
    'register-service-worker',
    'ua-parser-js',
    'vue-echarts',
    'vue-i18n',
    'vuedraggable',
    'vuetify',
    ...vuetifyComponents.map(name => `vuetify/components/${name}`),
    'vuetify/iconsets/mdi-svg'
];

export default defineNuxtConfig({
    compatibilityDate: '2026-09-01',
    ssr: false,
    devtools: {
        enabled: false
    },
    telemetry: false,
    modules: [
        '@pinia/nuxt',
        '@vite-pwa/nuxt'
    ],
    // the components and composables of the application are imported explicitly
    components: {
        dirs: []
    },
    imports: {
        scan: false
    },
    app: {
        baseURL: baseURL,
        head: {
            title: 'ezBookkeeping',
            htmlAttrs: {},
            meta: [
                { charset: 'utf-8' },
                { 'http-equiv': 'Content-Type', content: 'text/html;charset=utf-8' },
                { 'http-equiv': 'X-UA-Compatible', content: 'IE=edge' },
                { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, minimal-ui, viewport-fit=cover' },
                { name: 'mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-title', content: 'ezBookkeeping' },
                { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
                { name: 'theme-color', content: '#faf8f4' },
                { name: 'format-detection', content: 'telephone=no' },
                { name: 'description', content: 'ezBookkeeping is an open source, powerful, self-hosted personal finance app that is easy to use.' }
            ],
            link: [
                { rel: 'shortcut icon', type: 'image/x-icon', href: `${baseURL}favicon.ico` },
                { rel: 'apple-touch-icon', href: `${baseURL}touchicon.png` },
                ...getAppleTouchStartupImageLinks(),
                { rel: 'manifest', href: `${baseURL}manifest.json` }
            ],
            script: [
                // the server settings must be loaded before the application scripts
                { src: `${baseURL}server_settings.js`, tagPosition: 'head', tagPriority: 'critical' }
            ],
            noscript: [
                { innerHTML: '<strong>We\'re sorry but ezBookkeeping doesn\'t work properly without JavaScript enabled. Please enable it to continue.</strong>' }
            ]
        }
    },
    vue: {
        compilerOptions: {
            isCustomElement: (tag: string) => tag.includes('swiper-')
        }
    },
    typescript: {
        tsConfig: {
            compilerOptions: {
                allowImportingTsExtensions: true,
                noImplicitReturns: true,
                noImplicitOverride: true,
                noFallthroughCasesInSwitch: true,
                noPropertyAccessFromIndexSignature: true,
                noUncheckedIndexedAccess: true
            }
        },
        nodeTsConfig: {
            compilerOptions: {
                resolveJsonModule: true
            }
        }
    },
    vite: {
        define: {
            __EZBOOKKEEPING_VERSION__: JSON.stringify(packageFile.version),
            __EZBOOKKEEPING_BUILD_UNIX_TIME__: JSON.stringify(buildUnixTime),
            __EZBOOKKEEPING_BUILD_COMMIT_HASH__: JSON.stringify(commitHash),
            __EZBOOKKEEPING_CONTRIBUTORS__: JSON.stringify(contributorsFile),
            __EZBOOKKEEPING_LICENSE__: JSON.stringify(licenseContent),
            __EZBOOKKEEPING_THIRD_PARTY_LICENSES__: JSON.stringify(thirdPartyLicenseFile)
        },
        plugins: [
            vuetify({
                styles: {
                    configFile: fileURLToPath(new URL('./app/styles/desktop/settings.scss', import.meta.url))
                }
            })
        ],
        // the dependencies which are imported by the dynamically imported modules or by the transformed components
        // (e.g. vuetify components), declares them to avoid reloading the page when they are discovered in development mode
        optimizeDeps: {
            include: optimizedDependencies
        },
        build: {
            target: [
                'chrome119',
                'edge119',
                'firefox128',
                'safari16.4'
            ],
            assetsInlineLimit: 0
        }
    },
    nitro: {
        replace: {
            __EZBOOKKEEPING_SERVER_BUILD_INFO__: JSON.stringify({
                version: packageFile.version,
                commitHash: commitHash,
                buildTime: buildUnixTime
            })
        }
    },
    pwa: {
        strategies: 'injectManifest',
        srcDir: './',
        filename: 'sw.ts',
        injectRegister: false,
        manifestFilename: 'manifest.json',
        manifest: {
            name: 'ezBookkeeping',
            short_name: 'ezBookkeeping',
            description: 'An open source, powerful, self-hosted personal finance app that is easy to use.',
            theme_color: '#C67E48',
            background_color: '#F6F7F8',
            start_url: baseURL,
            scope: baseURL,
            display: 'standalone',
            related_applications: [],
            prefer_related_applications: false,
            icons: [
                {
                    src: `${baseURL}img/ezbookkeeping-192.png`,
                    sizes: '192x192',
                    type: 'image/png'
                },
                {
                    src: `${baseURL}img/ezbookkeeping-512.png`,
                    sizes: '512x512',
                    type: 'image/png'
                }
            ],
            share_target: {
                action: `${baseURL}__share__image__`,
                method: 'POST',
                enctype: 'multipart/form-data',
                params: {
                    files: [
                        {
                            name: 'image',
                            accept: ['image/*']
                        }
                    ]
                }
            }
        },
        injectManifest: {
            globPatterns: ['**/*.{js,css,html,ico,png,jpg,jpeg,gif,tiff,bmp,ttf,woff,woff2,svg,eot}'],
            globIgnores: [
                '**/*.html',
                'robots.txt',
                'img/desktop/*',
                '**/*.eot',
                '**/*.ttf',
                '**/*.svg',
                '**/*.woff',
                '_nuxt/**/*.css',
                '_nuxt/**/*.js'
            ],
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 // 5 MB
        },
        devOptions: {
            enabled: false
        }
    }
});
