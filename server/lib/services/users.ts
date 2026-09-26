import type { Context } from '../core/context';
import {
    CALENDAR_DISPLAY_TYPE_DEFAULT,
    CALENDAR_DISPLAY_TYPE_GREGORAIN_WITH_PERSIAN,
    COORDINATE_DISPLAY_TYPE_DEFAULT,
    COORDINATE_DISPLAY_TYPE_LONGITUDE_LATITUDE_DEGREES_MINUTES_SECONDS,
    CURRENCY_DISPLAY_TYPE_DEFAULT,
    CURRENCY_DISPLAY_TYPE_NAME_AFTER_AMOUNT,
    DATE_DISPLAY_TYPE_DEFAULT,
    DATE_DISPLAY_TYPE_PERSIAN,
    DECIMAL_SEPARATOR_COMMA,
    DECIMAL_SEPARATOR_DEFAULT,
    DIGIT_GROUPING_SYMBOL_APOSTROPHE,
    DIGIT_GROUPING_SYMBOL_DEFAULT,
    DIGIT_GROUPING_TYPE_DEFAULT,
    DIGIT_GROUPING_TYPE_INDIAN_NUMBER_GROUPING,
    FISCAL_YEAR_FORMAT_DEFAULT,
    FISCAL_YEAR_FORMAT_ENDYY,
    LONG_DATE_FORMAT_D_M_YYYY,
    LONG_DATE_FORMAT_DEFAULT,
    LONG_TIME_FORMAT_DEFAULT,
    LONG_TIME_FORMAT_HH_MM_SS_A,
    NUMERAL_SYSTEM_DEFAULT,
    NUMERAL_SYSTEM_DEVANAGARI_NUMERALS,
    SHORT_DATE_FORMAT_D_M_YYYY,
    SHORT_DATE_FORMAT_DEFAULT,
    SHORT_TIME_FORMAT_DEFAULT,
    SHORT_TIME_FORMAT_HH_MM_A,
    WEEKDAY_SATURDAY,
    WEEKDAY_SUNDAY,
} from '../core/types';
import { FISCAL_YEAR_START_MAX, FISCAL_YEAR_START_MIN } from '../core/fiscalyear';
import * as errs from '../errs/index';
import { getLocaleTextItems } from '../locales/index';
import * as log from '../log/index';
import {
    AMOUNT_COLOR_TYPE_BLACK_OR_WHITE,
    AMOUNT_COLOR_TYPE_DEFAULT,
    TRANSACTION_EDIT_SCOPE_LAST_RECONCILED_TIME_OR_LATER,
    TRANSACTION_EDIT_SCOPE_NONE,
    type User,
    UserTable,
} from '../models/index';
import { getTemplate, TEMPLATE_VERIFY_EMAIL } from '../templates/index';
import { encodePassword, getRandomString, goSprintf } from '../utils/strings';
import { isValidEmail, isValidUsername } from '../utils/validators';
import { UUID_TYPE_USER } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

const verifyEmailUrlFormat = '%sdesktop/verify_email?token=%s';

// goQueryEscape escapes the string like go url.QueryEscape
export function goQueryEscape(s: string): string {
    return encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

// UserService represents user service
export class UserService extends ServiceBase {
    // getUserByUsernameOrEmailAndPassword returns the user model according to login name and password, and the uid if user exists
    public async getUserByUsernameOrEmailAndPassword(c: Context, loginname: string, password: string): Promise<[User | null, bigint, unknown]> {
        let user: User;

        try {
            if (isValidUsername(loginname)) {
                user = await this.getUserByUsername(c, loginname);
            } else if (isValidEmail(loginname)) {
                user = await this.getUserByEmail(c, loginname);
            } else {
                throw errs.ErrLoginNameInvalid;
            }
        } catch (err) {
            return [null, 0n, err];
        }

        if (!this.isPasswordEqualsUserPassword(password, user)) {
            return [null, user.uid, errs.ErrUserPasswordWrong];
        }

        return [user, user.uid, null];
    }

    // getUserById returns the user model according to user uid
    public async getUserById(c: Context, uid: bigint): Promise<User> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const user = await this.userDB().newSession(c).id(uid).where('deleted=?', false).get(UserTable);

        if (!user) {
            throw errs.ErrUserNotFound;
        }

        return user;
    }

    // getUserByUsername returns the user model according to user name
    public async getUserByUsername(c: Context, username: string): Promise<User> {
        if (username === '') {
            throw errs.ErrUsernameIsEmpty;
        }

        const user = await this.userDB().newSession(c).where('username=? AND deleted=?', username, false).get(UserTable);

        if (!user) {
            throw errs.ErrUserNotFound;
        }

        return user;
    }

    // getUserByEmail returns the user model according to user email
    public async getUserByEmail(c: Context, email: string): Promise<User> {
        if (email === '') {
            throw errs.ErrEmailIsEmpty;
        }

        const user = await this.userDB().newSession(c).where('email=? AND deleted=?', email, false).get(UserTable);

        if (!user) {
            throw errs.ErrUserNotFound;
        }

        return user;
    }

    // getUserAvatar returns the user avatar image data according to user uid
    public async getUserAvatar(c: Context, uid: bigint, fileExtension: string): Promise<Buffer> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const user = await this.userDB().newSession(c).id(uid).cols('uid', 'deleted', 'custom_avatar_type').where('deleted=?', false).get(UserTable);

        if (!user) {
            throw errs.ErrUserNotFound;
        }

        if (user.customAvatarType === '') {
            throw errs.ErrUserAvatarNotSet;
        }

        if (user.customAvatarType !== fileExtension) {
            throw errs.ErrUserAvatarExtensionInvalid;
        }

        const avatarData = await this.readAvatar(c, user.uid, user.customAvatarType);

        if (!avatarData) {
            throw errs.ErrUserAvatarNoExists;
        }

        return avatarData;
    }

    // createUser saves a new user model to database
    public async createUser(c: Context, user: User, noPassword: boolean): Promise<void> {
        if (await this.existsUsername(c, user.username)) {
            throw errs.ErrUsernameAlreadyExists;
        }

        if (await this.existsEmail(c, user.email)) {
            throw errs.ErrUserEmailAlreadyExists;
        }

        if (!noPassword && user.password === '') {
            throw errs.ErrPasswordIsEmpty;
        }

        user.salt = getRandomString(10);
        user.uid = this.generateUuid(UUID_TYPE_USER);

        if (user.uid < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        if (!noPassword) {
            user.password = encodePassword(user.password, user.salt);
        } else {
            user.password = '';
        }

        user.deleted = false;
        user.createdUnixTime = nowUnix();
        user.updatedUnixTime = nowUnix();
        user.lastLoginUnixTime = nowUnix();

        await this.userDB().doTransaction(c, async sess => {
            await sess.insert(UserTable, user);
        });
    }

    // updateUser saves an existed user model to database, returns [keyProfileUpdated, emailSetToUnverified]
    public async updateUser(c: Context, user: User, modifyUserLanguage: boolean, modifyUseLastReconciledTime: boolean): Promise<[boolean, boolean]> {
        if (user.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateCols: string[] = [];
        const now = nowUnix();
        let keyProfileUpdated = false;
        let emailSetToUnverified = false;

        if (user.email !== '') {
            if (await this.existsEmail(c, user.email)) {
                throw errs.ErrUserEmailAlreadyExists;
            }

            user.emailVerified = false;
            updateCols.push('email');
            updateCols.push('email_verified');
            emailSetToUnverified = true;
        }

        if (user.password !== '') {
            user.password = encodePassword(user.password, user.salt);
            keyProfileUpdated = true;
            updateCols.push('password');
        }

        if (user.nickname !== '') {
            updateCols.push('nickname');
        }

        if (user.defaultAccountId > 0n) {
            updateCols.push('default_account_id');
        }

        if (modifyUseLastReconciledTime) {
            updateCols.push('use_last_reconciled_time');
        }

        if (TRANSACTION_EDIT_SCOPE_NONE <= user.transactionEditScope && user.transactionEditScope <= TRANSACTION_EDIT_SCOPE_LAST_RECONCILED_TIME_OR_LATER) {
            updateCols.push('transaction_edit_scope');
        }

        if (modifyUserLanguage || user.language !== '') {
            updateCols.push('language');
        }

        if (user.defaultCurrency !== '') {
            updateCols.push('default_currency');
        }

        if (WEEKDAY_SUNDAY <= user.firstDayOfWeek && user.firstDayOfWeek <= WEEKDAY_SATURDAY) {
            updateCols.push('first_day_of_week');
        }

        if (FISCAL_YEAR_START_MIN <= user.fiscalYearStart && user.fiscalYearStart <= FISCAL_YEAR_START_MAX) {
            updateCols.push('fiscal_year_start');
        }

        if (CALENDAR_DISPLAY_TYPE_DEFAULT <= user.calendarDisplayType && user.calendarDisplayType <= CALENDAR_DISPLAY_TYPE_GREGORAIN_WITH_PERSIAN) {
            updateCols.push('calendar_display_type');
        }

        if (DATE_DISPLAY_TYPE_DEFAULT <= user.dateDisplayType && user.dateDisplayType <= DATE_DISPLAY_TYPE_PERSIAN) {
            updateCols.push('date_display_type');
        }

        if (LONG_DATE_FORMAT_DEFAULT <= user.longDateFormat && user.longDateFormat <= LONG_DATE_FORMAT_D_M_YYYY) {
            updateCols.push('long_date_format');
        }

        if (SHORT_DATE_FORMAT_DEFAULT <= user.shortDateFormat && user.shortDateFormat <= SHORT_DATE_FORMAT_D_M_YYYY) {
            updateCols.push('short_date_format');
        }

        if (LONG_TIME_FORMAT_DEFAULT <= user.longTimeFormat && user.longTimeFormat <= LONG_TIME_FORMAT_HH_MM_SS_A) {
            updateCols.push('long_time_format');
        }

        if (SHORT_TIME_FORMAT_DEFAULT <= user.shortTimeFormat && user.shortTimeFormat <= SHORT_TIME_FORMAT_HH_MM_A) {
            updateCols.push('short_time_format');
        }

        if (FISCAL_YEAR_FORMAT_DEFAULT <= user.fiscalYearFormat && user.fiscalYearFormat <= FISCAL_YEAR_FORMAT_ENDYY) {
            updateCols.push('fiscal_year_format');
        }

        if (CURRENCY_DISPLAY_TYPE_DEFAULT <= user.currencyDisplayType && user.currencyDisplayType <= CURRENCY_DISPLAY_TYPE_NAME_AFTER_AMOUNT) {
            updateCols.push('currency_display_type');
        }

        if (NUMERAL_SYSTEM_DEFAULT <= user.numeralSystem && user.numeralSystem <= NUMERAL_SYSTEM_DEVANAGARI_NUMERALS) {
            updateCols.push('numeral_system');
        }

        if (DECIMAL_SEPARATOR_DEFAULT <= user.decimalSeparator && user.decimalSeparator <= DECIMAL_SEPARATOR_COMMA) {
            updateCols.push('decimal_separator');
        }

        if (DIGIT_GROUPING_SYMBOL_DEFAULT <= user.digitGroupingSymbol && user.digitGroupingSymbol <= DIGIT_GROUPING_SYMBOL_APOSTROPHE) {
            updateCols.push('digit_grouping_symbol');
        }

        if (DIGIT_GROUPING_TYPE_DEFAULT <= user.digitGrouping && user.digitGrouping <= DIGIT_GROUPING_TYPE_INDIAN_NUMBER_GROUPING) {
            updateCols.push('digit_grouping');
        }

        if (COORDINATE_DISPLAY_TYPE_DEFAULT <= user.coordinateDisplayType && user.coordinateDisplayType <= COORDINATE_DISPLAY_TYPE_LONGITUDE_LATITUDE_DEGREES_MINUTES_SECONDS) {
            updateCols.push('coordinate_display_type');
        }

        if (AMOUNT_COLOR_TYPE_DEFAULT <= user.expenseAmountColor && user.expenseAmountColor <= AMOUNT_COLOR_TYPE_BLACK_OR_WHITE) {
            updateCols.push('expense_amount_color');
        }

        if (AMOUNT_COLOR_TYPE_DEFAULT <= user.incomeAmountColor && user.incomeAmountColor <= AMOUNT_COLOR_TYPE_BLACK_OR_WHITE) {
            updateCols.push('income_amount_color');
        }

        user.updatedUnixTime = now;
        updateCols.push('updated_unix_time');

        await this.userDB().doTransaction(c, async sess => {
            const updatedRows = await sess.id(user.uid).cols(...updateCols).where('deleted=?', false).update(UserTable, user);

            if (updatedRows < 1) {
                throw errs.ErrUserNotFound;
            }
        });

        return [keyProfileUpdated, emailSetToUnverified];
    }

    // updateUserPassword updates the password of an existed user
    public async updateUserPassword(c: Context, user: User): Promise<void> {
        if (user.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (user.password === '') {
            throw errs.ErrPasswordIsEmpty;
        }

        user.password = encodePassword(user.password, user.salt);
        user.updatedUnixTime = nowUnix();

        await this.userDB().doTransaction(c, async sess => {
            const updatedRows = await sess.id(user.uid).cols('password', 'updated_unix_time').where('deleted=?', false).update(UserTable, user);

            if (updatedRows < 1) {
                throw errs.ErrUserNotFound;
            }
        });
    }

    // updateUserAvatar updates the custom avatar type of specified user
    public async updateUserAvatar(c: Context, uid: bigint, avatarFile: Buffer, fileExtension: string, oldFileExtension: string): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.saveAvatar(c, uid, avatarFile, fileExtension);

        const updateModel: Partial<User> = {
            customAvatarType: fileExtension,
            updatedUnixTime: nowUnix(),
        };

        await this.userDB().doTransaction(c, async sess => {
            await sess.id(uid).cols('custom_avatar_type', 'updated_unix_time').where('deleted=?', false).update(UserTable, updateModel);
        });

        if (fileExtension !== oldFileExtension && oldFileExtension !== '') {
            try {
                await this.deleteAvatar(c, uid, oldFileExtension);
            } catch (err) {
                log.warnf(c, `[users.UpdateUserAvatar] failed to delete old avatar with extension "${oldFileExtension}" for user "uid:${uid}", because ${(err as Error).message}`);
            }
        }
    }

    // removeUserAvatar removes the custom avatar type of specified user
    public async removeUserAvatar(c: Context, uid: bigint, fileExtension: string): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.deleteAvatar(c, uid, fileExtension);

        const updateModel: Partial<User> = {
            customAvatarType: '',
            updatedUnixTime: nowUnix(),
        };

        await this.userDB().doTransaction(c, async sess => {
            await sess.id(uid).cols('custom_avatar_type', 'updated_unix_time').where('deleted=?', false).update(UserTable, updateModel);
        });
    }

    // updateUserLastLoginTime updates the last login time field
    public async updateUserLastLoginTime(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.userDB().doTransaction(c, async sess => {
            await sess.id(uid).cols('last_login_unix_time').where('deleted=?', false).update(UserTable, { lastLoginUnixTime: nowUnix() });
        });
    }

    private async updateUserByUsername(c: Context, username: string, cols: string[], updateModel: Partial<User>, setExpr?: [string, string]): Promise<void> {
        if (username === '') {
            throw errs.ErrUsernameIsEmpty;
        }

        let query = this.userDB().newSession(c).cols(...cols);

        if (setExpr) {
            query = query.setExpr(setExpr[0], setExpr[1]);
        }

        const updatedRows = await query.where('username=? AND deleted=?', username, false).update(UserTable, updateModel);

        if (updatedRows < 1) {
            throw errs.ErrUserNotFound;
        }
    }

    // enableUser sets user enabled
    public async enableUser(c: Context, username: string): Promise<void> {
        await this.updateUserByUsername(c, username, ['disabled', 'updated_unix_time'], { disabled: false, updatedUnixTime: nowUnix() });
    }

    // disableUser sets user disabled
    public async disableUser(c: Context, username: string): Promise<void> {
        await this.updateUserByUsername(c, username, ['disabled', 'updated_unix_time'], { disabled: true, updatedUnixTime: nowUnix() });
    }

    // updateUserFeatureRestriction sets user feature restriction
    public async updateUserFeatureRestriction(c: Context, username: string, featureRestriction: number): Promise<void> {
        await this.updateUserByUsername(c, username, ['feature_restriction', 'updated_unix_time'], { featureRestriction: featureRestriction, updatedUnixTime: nowUnix() });
    }

    // addUserFeatureRestriction adds user feature restriction
    public async addUserFeatureRestriction(c: Context, username: string, featureRestriction: number): Promise<void> {
        await this.updateUserByUsername(c, username, ['updated_unix_time'], { updatedUnixTime: nowUnix() }, ['feature_restriction', `feature_restriction|(${BigInt(featureRestriction)})`]);
    }

    // removeUserFeatureRestriction removes user feature restriction
    public async removeUserFeatureRestriction(c: Context, username: string, featureRestriction: number): Promise<void> {
        const mask = ~BigInt(featureRestriction) & 0x7FFFFFFFFFFFFFFFn;
        await this.updateUserByUsername(c, username, ['updated_unix_time'], { updatedUnixTime: nowUnix() }, ['feature_restriction', `feature_restriction&(${mask})`]);
    }

    // setUserEmailVerified sets user email address verified
    public async setUserEmailVerified(c: Context, username: string): Promise<void> {
        await this.updateUserByUsername(c, username, ['email_verified', 'updated_unix_time'], { emailVerified: true, updatedUnixTime: nowUnix() });
    }

    // setUserEmailUnverified sets user email address unverified
    public async setUserEmailUnverified(c: Context, username: string): Promise<void> {
        await this.updateUserByUsername(c, username, ['email_verified', 'updated_unix_time'], { emailVerified: false, updatedUnixTime: nowUnix() });
    }

    // deleteUser deletes an existed user from database
    public async deleteUser(c: Context, username: string): Promise<void> {
        await this.updateUserByUsername(c, username, ['deleted', 'deleted_unix_time'], { deleted: true, deletedUnixTime: nowUnix() });
    }

    // existsUsername returns whether the given user name exists
    public async existsUsername(c: Context, username: string): Promise<boolean> {
        if (username === '') {
            throw errs.ErrUsernameIsEmpty;
        }

        return this.userDB().newSession(c).cols('username').where('username=? AND deleted=?', username, false).exist(UserTable);
    }

    // existsEmail returns whether the given user email exists
    public async existsEmail(c: Context, email: string): Promise<boolean> {
        if (email === '') {
            throw errs.ErrEmailIsEmpty;
        }

        return this.userDB().newSession(c).cols('email').where('email=? AND deleted=?', email, false).exist(UserTable);
    }

    // sendVerifyEmail sends an email for asking user verify email
    public async sendVerifyEmail(user: User, verifyEmailToken: string, backupLocale: string): Promise<void> {
        const config = this.currentConfig();

        if (!config.enableSMTP) {
            throw errs.ErrSMTPServerNotEnabled;
        }

        let locale = user.language;

        if (locale === '') {
            locale = backupLocale;
        }

        const localeTextItems = getLocaleTextItems(locale);
        const verifyEmailTextItems = localeTextItems.verifyEmailTextItems;
        const expireTimeInMinutes = config.emailVerifyTokenExpiredTime / 60;
        const verifyEmailUrl = goSprintf(verifyEmailUrlFormat, config.rootUrl, goQueryEscape(verifyEmailToken));

        const tmpl = getTemplate(TEMPLATE_VERIFY_EMAIL);
        const templateParams = {
            AppName: localeTextItems.globalTextItems.appName,
            VerifyEmail: {
                Title: verifyEmailTextItems.title,
                Salutation: goSprintf(verifyEmailTextItems.salutationFormat, user.nickname),
                DescriptionAboveBtn: verifyEmailTextItems.descriptionAboveBtn,
                VerifyEmailUrl: verifyEmailUrl,
                VerifyEmail: verifyEmailTextItems.verifyEmail,
                DescriptionBelowBtn: goSprintf(verifyEmailTextItems.descriptionBelowBtnFormat, localeTextItems.globalTextItems.appName, expireTimeInMinutes),
            },
        };

        await this.sendMail({
            to: user.email,
            subject: verifyEmailTextItems.title,
            body: tmpl.execute(templateParams),
        });
    }

    // isPasswordEqualsUserPassword returns whether the given password is correct
    public isPasswordEqualsUserPassword(password: string, user: User): boolean {
        return user.password === encodePassword(password, user.salt);
    }
}

export const Users = new UserService();
