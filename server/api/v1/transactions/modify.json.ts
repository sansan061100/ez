import * as transactions from '~~/server/lib/api/transactions';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    handler: bindApi(transactions.transactionModifyHandler),
});
