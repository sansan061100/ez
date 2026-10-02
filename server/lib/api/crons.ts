import { timingSafeEqual } from 'node:crypto';

import { Container as CronContainer } from '../cron/index';
import * as errs from '../errs/index';
import type { WebContext } from '../web/context';

// runCronJobsHandler runs all the enabled cron jobs once for an external scheduler (e.g. Vercel Cron),
// the request must carry "Authorization: Bearer <CRON_SECRET>", and it is disabled when CRON_SECRET is not set
export async function runCronJobsHandler(c: WebContext): Promise<unknown> {
    const secret = process.env['CRON_SECRET'];

    if (!secret) {
        throw errs.ErrApiNotFound;
    }

    const actual = Buffer.from(c.getHeader('Authorization'));
    const expected = Buffer.from(`Bearer ${secret}`);

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw errs.ErrUnauthorizedAccess;
    }

    await CronContainer.runAllJobsByExternalScheduler();

    return true;
}
