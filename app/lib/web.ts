export type UiMode = 'index' | 'desktop' | 'mobile';

type NuxtWindow = typeof window & {
    __NUXT__?: {
        config?: {
            app?: {
                baseURL?: string;
            };
        };
    };
};

// getBasePath returns the base path of the application (without the trailing slash, e.g. "" or "/ezbookkeeping")
export function getBasePath(): string {
    const baseURL = (window as NuxtWindow).__NUXT__?.config?.app?.baseURL || '/';
    return baseURL.endsWith('/') ? baseURL.substring(0, baseURL.length - 1) : baseURL;
}

// getUiMode returns which version of the application (desktop or mobile) the current page is,
// switching between the versions always reloads the whole page, so it does not change in the page lifetime
export function getUiMode(): UiMode {
    const path = window.location.pathname.substring(getBasePath().length);

    if (path === '/desktop' || path.startsWith('/desktop/')) {
        return 'desktop';
    } else if (path === '/mobile' || path.startsWith('/mobile/')) {
        return 'mobile';
    } else {
        return 'index';
    }
}

// getUiModeBasePath returns the base path of the routes of the specified version
export function getUiModeBasePath(type: 'desktop' | 'mobile'): string {
    return `${getBasePath()}/${type}`;
}

export function navigateToHomePage(type: 'desktop' | 'mobile'): void {
    if (type === 'desktop') {
        window.location.replace(`${getUiModeBasePath(type)}/`);
    } else {
        window.location.replace(getUiModeBasePath(type));
    }
}
