import type { RouterConfig } from 'nuxt/schema';
import type { RouteRecordRaw } from 'vue-router';
import { createWebHistory } from 'vue-router';

import { getUiMode, getUiModeBasePath } from '@/lib/web.ts';

// The pages of the application are in "pages/desktop", and the routes are mounted at the base path "/desktop"
// (e.g. "pages/desktop/transaction/list.vue" is "/transaction/list" in the router whose base path is "/desktop"),
// so the pages and the components can use the route paths relative to it.

function removeRoutePathPrefix(routes: readonly RouteRecordRaw[], prefix: string): RouteRecordRaw[] {
    const result: RouteRecordRaw[] = [
        // nuxt resolves the initial route by the url path without the base path of the version (e.g. "/desktop/transaction/list"),
        // so redirects it to the route path relative to the version (e.g. "/transaction/list")
        {
            path: `${prefix}/:pathMatch(.*)*`,
            redirect: to => ({
                path: '/' + ([] as string[]).concat(to.params['pathMatch'] ?? []).join('/'),
                query: to.query,
                hash: to.hash
            })
        },
        {
            path: prefix,
            redirect: to => ({
                path: '/',
                query: to.query,
                hash: to.hash
            })
        }
    ];

    for (const route of routes) {
        if (route.path !== prefix && !route.path.startsWith(prefix + '/')) {
            continue;
        }

        result.push({
            ...route,
            path: route.path.substring(prefix.length) || '/'
        } as RouteRecordRaw);
    }

    return result;
}

export default {
    routes: (routes): RouteRecordRaw[] => {
        const uiMode = getUiMode();

        if (uiMode === 'desktop') {
            return removeRoutePathPrefix(routes, '/desktop');
        } else {
            return routes.filter(route => route.path !== '/desktop' && !route.path.startsWith('/desktop/'));
        }
    },
    history: () => {
        const uiMode = getUiMode();

        if (uiMode === 'desktop') {
            const basePath = getUiModeBasePath('desktop');

            // redirects the url of the old hash mode desktop version (e.g. "/desktop#/transaction/list") to the current url
            if (window.location.hash.startsWith('#/')) {
                window.history.replaceState(null, '', basePath + window.location.hash.substring(1));
            }

            return createWebHistory(basePath);
        } else {
            return undefined;
        }
    }
} satisfies RouterConfig;
