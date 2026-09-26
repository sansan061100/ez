import * as qrcodes from '~~/server/lib/api/qrcodes';
import { bindCachedImage, defineRoute } from '~~/server/lib/web/bind';
import { requestIdGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: requestIdGroup,
    handler: bindCachedImage(qrcodes.mobileUrlQrCodeHandler),
});
