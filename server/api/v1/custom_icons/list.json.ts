import * as userCustomIcons from '~~/server/lib/api/user_custom_icons';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: apiV1Group,
    enabled: config => config.enableUserCustomIcon,
    handler: bindApi(userCustomIcons.customIconListHandler),
});
