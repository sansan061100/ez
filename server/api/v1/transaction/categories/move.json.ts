import * as transactionCategories from '~~/server/lib/api/transaction_categories';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    handler: bindApi(transactionCategories.categoryMoveHandler),
});
