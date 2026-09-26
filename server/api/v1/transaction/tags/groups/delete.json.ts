import * as transactionTagGroups from '~~/server/lib/api/transaction_tag_groups';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    handler: bindApi(transactionTagGroups.tagGroupDeleteHandler),
});
