import * as transactionPictures from '~~/server/lib/api/transaction_pictures';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    enabled: config => config.enableTransactionPictures,
    handler: bindApi(transactionPictures.transactionPictureUploadHandler),
});
