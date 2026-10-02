import type { VersionInfo } from '@/core/version.ts';

import { getUiModeBasePath } from './web.ts';

const clientVersionHolder: VersionInfo = {
    version: __EZBOOKKEEPING_VERSION__,
    commitHash: __EZBOOKKEEPING_BUILD_COMMIT_HASH__,
    buildTime: __EZBOOKKEEPING_BUILD_UNIX_TIME__
};

export function formatDisplayVersion(versionInfo: VersionInfo): string {
    const isRelease = !versionInfo.buildTime;
    const commitHash = versionInfo.commitHash;
    let version = versionInfo.version;

    if (version && (!isRelease || !isProduction())) {
        version += '-dev';
    }

    if (!version) {
        version = 'unknown';
    } else {
        version = 'v' + version;
    }

    if (commitHash) {
        version += ` (${commitHash.substring(0, Math.min(7, commitHash.length))})`;
    }

    return version;
}

export function isProduction(): boolean {
    return import.meta.env.PROD;
}

export function getClientVersionInfo(): VersionInfo {
    return clientVersionHolder;
}

export function getClientDisplayVersion(): string {
    return formatDisplayVersion(clientVersionHolder);
}

export function getClientBuildTime(): string {
    return clientVersionHolder.buildTime || '';
}

export function getDesktopVersionPath(): string {
    return getUiModeBasePath('desktop') + '/';
}
