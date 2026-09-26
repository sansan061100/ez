import * as users from '~~/server/lib/api/users';
import { USER_AVATAR_PROVIDER_INTERNAL } from '~~/server/lib/core/types';
import { bindImage, defineRoute } from '~~/server/lib/web/bind';
import { queryStringTokenGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: queryStringTokenGroup,
    enabled: config => config.avatarProvider === USER_AVATAR_PROVIDER_INTERNAL,
    handler: bindImage(users.userGetAvatarHandler),
});
