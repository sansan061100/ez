import * as userCustomIcons from '~~/server/lib/api/user_custom_icons';
import { bindImage, defineRoute } from '~~/server/lib/web/bind';
import { queryStringTokenGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: queryStringTokenGroup,
    enabled: config => config.enableUserCustomIcon,
    handler: bindImage(userCustomIcons.customIconGetHandler),
});
