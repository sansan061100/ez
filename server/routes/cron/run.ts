import * as crons from '~~/server/lib/api/crons';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';

export default defineRoute({
    methods: ['GET'],
    handler: bindApi(crons.runCronJobsHandler),
});
