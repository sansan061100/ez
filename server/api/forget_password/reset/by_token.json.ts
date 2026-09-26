import * as forgetPasswords from '~~/server/lib/api/forget_passwords';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { resetPasswordApiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: resetPasswordApiGroup,
    enabled: config => config.enableInternalAuth && config.enableUserForgetPassword,
    handler: bindApi(forgetPasswords.userResetPasswordHandler),
});
