import * as transactionImports from '~~/server/lib/api/transaction_imports';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    enabled: config => config.enableDataImport,
    handler: bindApi(transactionImports.transactionImportHandler),
});
