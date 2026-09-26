import * as healths from '~~/server/lib/api/healths';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';

export default defineRoute({
    methods: ['GET'],
    handler: bindApi(healths.healthStatusHandler),
});
