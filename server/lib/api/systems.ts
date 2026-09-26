import { buildInfo } from '../core/types';
import type { WebContext } from '../web/context';

// versionHandler returns the server version and commit hash
export async function versionHandler(_c: WebContext): Promise<unknown> {
    const result: Record<string, string> = {};

    if (buildInfo.buildTime !== '') {
        result['buildTime'] = buildInfo.buildTime;
    }

    result['commitHash'] = buildInfo.commitHash;
    result['version'] = buildInfo.version;

    return result;
}
