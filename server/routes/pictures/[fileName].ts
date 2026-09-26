import * as transactionPictures from '~~/server/lib/api/transaction_pictures';
import { bindImage, defineRoute } from '~~/server/lib/web/bind';
import { queryStringTokenGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: queryStringTokenGroup,
    enabled: config => config.enableTransactionPictures,
    handler: bindImage(transactionPictures.transactionPictureGetHandler),
});
