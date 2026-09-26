import { buildInfo } from '../core/types';
import type { WebContext } from '../web/context';

// healthStatusHandler returns the health status of current service
export async function healthStatusHandler(_c: WebContext): Promise<unknown> {
    return {
        commit: buildInfo.commitHash,
        status: 'ok',
        version: buildInfo.version,
    };
}
