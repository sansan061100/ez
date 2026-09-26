import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { getLocaleTextItems } from '../locales/index';
import type { User } from '../models/index';
import { getTemplate, TEMPLATE_PASSWORD_RESET } from '../templates/index';
import { goSprintf } from '../utils/strings';
import { ServiceBase } from './base';
import { goQueryEscape } from './users';

const passwordResetUrlFormat = '%sdesktop/resetpassword?token=%s';

// ForgetPasswordService represents forget password service
export class ForgetPasswordService extends ServiceBase {
    // sendPasswordResetEmail sends password reset email according to specified parameters
    public async sendPasswordResetEmail(_c: Context, user: User, passwordResetToken: string, backupLocale: string): Promise<void> {
        const config = this.currentConfig();

        if (!config.enableSMTP) {
            throw errs.ErrSMTPServerNotEnabled;
        }

        let locale = user.language;

        if (locale === '') {
            locale = backupLocale;
        }

        const localeTextItems = getLocaleTextItems(locale);
        const forgetPasswordTextItems = localeTextItems.forgetPasswordMailTextItems;
        const expireTimeInMinutes = config.passwordResetTokenExpiredTime / 60;
        const passwordResetUrl = goSprintf(passwordResetUrlFormat, config.rootUrl, goQueryEscape(passwordResetToken));

        const tmpl = getTemplate(TEMPLATE_PASSWORD_RESET);
        const templateParams = {
            AppName: localeTextItems.globalTextItems.appName,
            ForgetPasswordMail: {
                Title: forgetPasswordTextItems.title,
                Salutation: goSprintf(forgetPasswordTextItems.salutationFormat, user.nickname),
                DescriptionAboveBtn: forgetPasswordTextItems.descriptionAboveBtn,
                ResetPasswordUrl: passwordResetUrl,
                ResetPassword: forgetPasswordTextItems.resetPassword,
                DescriptionBelowBtn: goSprintf(forgetPasswordTextItems.descriptionBelowBtnFormat, expireTimeInMinutes),
            },
        };

        await this.sendMail({
            to: user.email,
            subject: forgetPasswordTextItems.title,
            body: tmpl.execute(templateParams),
        });
    }
}

export const ForgetPasswords = new ForgetPasswordService();
