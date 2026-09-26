import { AccountCurrencyNotSetValue, ICON_TYPE_USER_CUSTOM, isValidIconType } from '../core/types';
import { DUPLICATE_CHECKER_TYPE_NEW_ACCOUNT, DUPLICATE_CHECKER_TYPE_NEW_SUBACCOUNT } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    type Account,
    ACCOUNT_CATEGORY_CASH,
    ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT,
    ACCOUNT_CATEGORY_CREDIT_CARD,
    ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS,
    ACCOUNT_TYPE_SINGLE_ACCOUNT,
    type AccountCreateRequest,
    type AccountExtend,
    type AccountInfoResponse,
    type AccountModifyRequest,
    type AccountType,
    LevelOneAccountParentId,
    newAccount,
    sortAccountInfoResponses,
    toAccountInfoResponse,
    type User,
} from '../models/index';
import { Accounts } from '../services/accounts';
import { UserCustomIcons } from '../services/user_custom_icons';
import { Users } from '../services/users';
import { stringToInt64 } from '../utils/converter';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery, currentConfig, errMsg, getClientTimezoneOrThrow, getSubmissionRemark, setSubmissionRemarkIfEnable } from './base';
import { callOrFail } from './common';
import { AccountCreateRequestSchema, AccountListRequestSchema, AccountModifyRequestSchema, AccountUpdateLastReconciledTimeRequestSchema, IdDeleteRequestSchema, IdHideRequestSchema, IdQueryRequestSchema, MoveRequestSchema } from './schemas';

const P = 'accounts';

function tryStringToInt64(s: string): bigint | null {
    try {
        return stringToInt64(s);
    } catch {
        return null;
    }
}

function appendSubAccount(parent: AccountInfoResponse, child: AccountInfoResponse): void {
    if (!parent.subAccounts) {
        parent.subAccounts = [];
    }

    parent.subAccounts.push(child);
}

function sortSubAccounts(account: AccountInfoResponse): void {
    if (account.subAccounts) {
        sortAccountInfoResponses(account.subAccounts);
    }
}

async function getCurrentUserOrNotFound(c: WebContext, handler: string): Promise<User> {
    try {
        return await Users.getUserById(c, c.getCurrentUid());
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${P}.${handler}] failed to get user, because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }
}

// getExistedAccountResponse returns the account response of the account created by previous duplicate submission
async function getExistedAccountResponse(c: WebContext, uid: bigint, accountId: bigint, handler: string): Promise<AccountInfoResponse> {
    const accountAndSubAccounts = await callOrFail(c, () => Accounts.getAccountAndSubAccountsByAccountId(c, uid, accountId), () => `[${P}.${handler}] failed to get existed account "id:${accountId}" for user "uid:${uid}"`);
    const accountMap = Accounts.getAccountMapByList(accountAndSubAccounts);
    const mainAccount = accountMap.get(accountId);

    if (!mainAccount) {
        throw errs.ErrOperationFailed;
    }

    const accountInfoResp = toAccountInfoResponse(mainAccount);

    for (const account of accountAndSubAccounts) {
        if (account.parentAccountId === mainAccount.accountId) {
            appendSubAccount(accountInfoResp, toAccountInfoResponse(account));
        }
    }

    return accountInfoResp;
}

// accountListHandler returns accounts list of current user
export async function accountListHandler(c: WebContext): Promise<unknown> {
    const req = bindQuery<{ visibleOnly: boolean }>(c, AccountListRequestSchema, `${P}.AccountListHandler`);
    const uid = c.getCurrentUid();
    const accounts = await callOrFail(c, () => Accounts.getAllAccountsByUid(c, uid), () => `[${P}.AccountListHandler] failed to get all accounts for user "uid:${uid}"`);

    const userAllAccountResps = accounts.map(toAccountInfoResponse);
    const userAllAccountRespMap = new Map<bigint, AccountInfoResponse>();

    for (const resp of userAllAccountResps) {
        userAllAccountRespMap.set(resp.id, resp);
    }

    for (const userAccountResp of userAllAccountResps) {
        if (req.visibleOnly && userAccountResp.hidden) {
            continue;
        }

        if (userAccountResp.parentId <= LevelOneAccountParentId) {
            continue;
        }

        const parentAccount = userAllAccountRespMap.get(userAccountResp.parentId);

        if (!parentAccount) {
            continue;
        }

        appendSubAccount(parentAccount, userAccountResp);
    }

    const userFinalAccountResps: AccountInfoResponse[] = [];

    for (const resp of userAllAccountResps) {
        if (resp.parentId === LevelOneAccountParentId && (!req.visibleOnly || !resp.hidden)) {
            sortSubAccounts(resp);
            userFinalAccountResps.push(resp);
        }
    }

    return sortAccountInfoResponses(userFinalAccountResps);
}

// accountGetHandler returns one specific account of current user
export async function accountGetHandler(c: WebContext): Promise<unknown> {
    const req = bindQuery<{ id: bigint }>(c, IdQueryRequestSchema, `${P}.AccountGetHandler`);
    const uid = c.getCurrentUid();
    const accountAndSubAccounts = await callOrFail(c, () => Accounts.getAccountAndSubAccountsByAccountId(c, uid, req.id), () => `[${P}.AccountGetHandler] failed to get account "id:${req.id}" for user "uid:${uid}"`);

    const accountRespMap = new Map<bigint, AccountInfoResponse>();

    for (const account of accountAndSubAccounts) {
        const resp = toAccountInfoResponse(account);
        accountRespMap.set(resp.id, resp);
    }

    const accountResp = accountRespMap.get(req.id);

    if (!accountResp) {
        throw errs.ErrAccountNotFound;
    }

    for (const account of accountAndSubAccounts) {
        if (account.parentAccountId === accountResp.id) {
            appendSubAccount(accountResp, toAccountInfoResponse(account));
        }
    }

    sortSubAccounts(accountResp);
    return accountResp;
}

// accountCreateHandler saves a new account by request parameters for current user
export async function accountCreateHandler(c: WebContext): Promise<unknown> {
    const handler = 'AccountCreateHandler';
    const req = await bindJson<AccountCreateRequest>(c, AccountCreateRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const reqSubAccounts = req.subAccounts ?? [];

    let mainAccountBalance = 0n;

    if (req.balance !== '') {
        const balance = tryStringToInt64(req.balance);

        if (balance === null) {
            throw errs.ErrIncompleteOrIncorrectSubmission;
        }

        mainAccountBalance = balance;
    }

    const subAccountBalances: bigint[] = new Array<bigint>(reqSubAccounts.length).fill(0n);

    if (req.category < ACCOUNT_CATEGORY_CASH || req.category > ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT) {
        log.warnf(c, `[${P}.${handler}] account category invalid, category is ${req.category}`);
        throw errs.ErrAccountCategoryInvalid;
    }

    if (req.category !== ACCOUNT_CATEGORY_CREDIT_CARD && req.creditCardStatementDate !== 0) {
        log.warnf(c, `[${P}.${handler}] cannot set statement date with category "${req.category}"`);
        throw errs.ErrCannotSetStatementDateForNonCreditCard;
    }

    if (req.category !== ACCOUNT_CATEGORY_CREDIT_CARD && req.creditCardLimit !== '') {
        log.warnf(c, `[${P}.${handler}] cannot set credit limit with category "${req.category}"`);
        throw errs.ErrCannotSetCreditLimitForNonCreditCardAccount;
    }

    let creditLimitForCreditCard = 0n;

    if (req.creditCardLimit !== '') {
        const limit = tryStringToInt64(req.creditCardLimit);

        if (limit === null || limit <= 0n) {
            throw errs.ErrIncompleteOrIncorrectSubmission;
        }

        creditLimitForCreditCard = limit;
    }

    if (req.type === ACCOUNT_TYPE_SINGLE_ACCOUNT) {
        if (reqSubAccounts.length > 0) {
            log.warnf(c, `[${P}.${handler}] account cannot have any sub-accounts`);
            throw errs.ErrAccountCannotHaveSubAccounts;
        }

        if (req.currency === AccountCurrencyNotSetValue) {
            log.warnf(c, `[${P}.${handler}] account must set currency`);
            throw errs.ErrAccountCurrencyInvalid;
        }

        if (mainAccountBalance !== 0n && req.balanceTime <= 0) {
            log.warnf(c, `[${P}.${handler}] account balance time is not set`);
            throw errs.ErrAccountBalanceTimeNotSet;
        }
    } else if (req.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
        if (reqSubAccounts.length < 1) {
            log.warnf(c, `[${P}.${handler}] account does not have any sub-accounts`);
            throw errs.ErrAccountHaveNoSubAccount;
        }

        if (req.category === ACCOUNT_CATEGORY_CREDIT_CARD) {
            if (req.currency === AccountCurrencyNotSetValue && creditLimitForCreditCard > 0n) {
                log.warnf(c, `[${P}.${handler}] parent account must set currency when set credit limit`);
                throw errs.ErrMustSetParentAccountCurrencyWhenSetCreditLimit;
            }
        } else {
            if (req.currency !== AccountCurrencyNotSetValue) {
                log.warnf(c, `[${P}.${handler}] parent account cannot set currency`);
                throw errs.ErrParentAccountCannotSetCurrency;
            }
        }

        if (mainAccountBalance !== 0n) {
            log.warnf(c, `[${P}.${handler}] parent account cannot set balance`);
            throw errs.ErrParentAccountCannotSetBalance;
        }

        for (let i = 0; i < reqSubAccounts.length; i++) {
            const subAccount = reqSubAccounts[i] as AccountCreateRequest;
            let subAccountBalance = 0n;

            if (subAccount.balance !== '') {
                const balance = tryStringToInt64(subAccount.balance);

                if (balance === null) {
                    throw errs.ErrIncompleteOrIncorrectSubmission;
                }

                subAccountBalance = balance;
            }

            subAccountBalances[i] = subAccountBalance;

            if (subAccount.category !== req.category) {
                log.warnf(c, `[${P}.${handler}] category of sub-account#${i} not equals to parent`);
                throw errs.ErrSubAccountCategoryNotEqualsToParent;
            }

            if (subAccount.type !== ACCOUNT_TYPE_SINGLE_ACCOUNT) {
                log.warnf(c, `[${P}.${handler}] sub-account#${i} type invalid`);
                throw errs.ErrSubAccountTypeInvalid;
            }

            if (subAccount.currency === AccountCurrencyNotSetValue) {
                log.warnf(c, `[${P}.${handler}] sub-account#${i} must set currency`);
                throw errs.ErrAccountCurrencyInvalid;
            }

            if (subAccountBalance !== 0n && subAccount.balanceTime <= 0) {
                log.warnf(c, `[${P}.${handler}] sub-account#${i} balance time is not set`);
                throw errs.ErrAccountBalanceTimeNotSet;
            }

            if (subAccount.creditCardStatementDate !== 0) {
                log.warnf(c, `[${P}.${handler}] sub-account#${i} cannot set statement date`);
                throw errs.ErrCannotSetStatementDateForSubAccount;
            }

            if (subAccount.creditCardLimit !== '') {
                log.warnf(c, `[${P}.${handler}] sub-account#${i} cannot set credit limit`);
                throw errs.ErrCannotSetCreditLimitForSubAccount;
            }
        }
    } else {
        log.warnf(c, `[${P}.${handler}] account type invalid, type is ${req.type}`);
        throw errs.ErrAccountTypeInvalid;
    }

    const uid = c.getCurrentUid();
    const maxOrderId = await callOrFail(c, () => Accounts.getMaxDisplayOrder(c, uid, req.category), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);

    const mainAccount = createNewAccountModel(uid, req, mainAccountBalance, creditLimitForCreditCard, false, maxOrderId + 1);
    const childrenAccounts: Account[] = [];
    const childrenAccountBalanceTimes: number[] = [];

    for (let i = 0; i < reqSubAccounts.length; i++) {
        const subAccount = reqSubAccounts[i] as AccountCreateRequest;
        childrenAccounts.push(createNewAccountModel(uid, subAccount, subAccountBalances[i] as bigint, null, true, i + 1));
        childrenAccountBalanceTimes.push(subAccount.balanceTime);
    }

    if (!await isAccountsIconTypeValid(c, uid, [mainAccount, ...childrenAccounts])) {
        log.warnf(c, `[${P}.${handler}] icon type invalid for user "uid:${uid}"`);
        throw errs.ErrAccountIconInvalid;
    }

    if (currentConfig().enableDuplicateSubmissionsCheck && req.clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_NEW_ACCOUNT, uid, req.clientSessionId);

        if (found) {
            log.infof(c, `[${P}.${handler}] another account "id:${remark}" has been created for user "uid:${uid}"`);
            const accountId = tryStringToInt64(remark);

            if (accountId !== null) {
                return getExistedAccountResponse(c, uid, accountId, handler);
            }
        }
    }

    await callOrFail(c, () => Accounts.createAccounts(c, mainAccount, req.balanceTime, childrenAccounts, childrenAccountBalanceTimes, clientTimezone), () => `[${P}.${handler}] failed to create account "id:${mainAccount.accountId}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has created a new account "id:${mainAccount.accountId}" successfully`);

    setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_NEW_ACCOUNT, uid, req.clientSessionId, mainAccount.accountId.toString());

    const accountInfoResp = toAccountInfoResponse(mainAccount);

    if (childrenAccounts.length > 0) {
        accountInfoResp.subAccounts = childrenAccounts.map(toAccountInfoResponse);
    }

    return accountInfoResp;
}

// accountModifyHandler saves an existed account by request parameters for current user
export async function accountModifyHandler(c: WebContext): Promise<unknown> {
    const handler = 'AccountModifyHandler';
    const req = await bindJson<AccountModifyRequest>(c, AccountModifyRequestSchema, `${P}.${handler}`);
    const reqSubAccounts = req.subAccounts ?? [];

    if (req.id <= 0n) {
        throw errs.ErrAccountIdInvalid;
    }

    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);

    if (req.category < ACCOUNT_CATEGORY_CASH || req.category > ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT) {
        log.warnf(c, `[${P}.${handler}] account category invalid, category is ${req.category}`);
        throw errs.ErrAccountCategoryInvalid;
    }

    if (req.category !== ACCOUNT_CATEGORY_CREDIT_CARD && req.creditCardStatementDate !== 0) {
        log.warnf(c, `[${P}.${handler}] cannot set statement date with category "${req.category}"`);
        throw errs.ErrCannotSetStatementDateForNonCreditCard;
    }

    if (req.category !== ACCOUNT_CATEGORY_CREDIT_CARD && req.creditCardLimit !== '') {
        log.warnf(c, `[${P}.${handler}] cannot set credit limit with category "${req.category}"`);
        throw errs.ErrCannotSetCreditLimitForNonCreditCardAccount;
    }

    let creditLimitForCreditCard = 0n;

    if (req.creditCardLimit !== '') {
        const limit = tryStringToInt64(req.creditCardLimit);

        if (limit === null || limit <= 0n) {
            throw errs.ErrIncompleteOrIncorrectSubmission;
        }

        creditLimitForCreditCard = limit;
    }

    const uid = c.getCurrentUid();
    const user = await getCurrentUserOrNotFound(c, handler);
    const accountAndSubAccounts = await callOrFail(c, () => Accounts.getAccountAndSubAccountsByAccountId(c, uid, req.id), () => `[${P}.${handler}] failed to get account "id:${req.id}" for user "uid:${uid}"`);
    const accountMap = Accounts.getAccountMapByList(accountAndSubAccounts);
    const mainAccount = accountMap.get(req.id);
    const subAccountBalances: bigint[] = new Array<bigint>(reqSubAccounts.length).fill(0n);

    if (!mainAccount) {
        throw errs.ErrAccountNotFound;
    }

    if (req.balance !== null) {
        throw errs.ErrNotSupportedChangeBalance;
    }

    if (req.balanceTime !== null) {
        throw errs.ErrNotSupportedChangeBalanceTime;
    }

    let updateMainAccountCurrency = false;

    if (mainAccount.type === ACCOUNT_TYPE_SINGLE_ACCOUNT) {
        if (reqSubAccounts.length > 0) {
            log.warnf(c, `[${P}.${handler}] account cannot have any sub-accounts`);
            throw errs.ErrAccountCannotHaveSubAccounts;
        }

        if (req.currency !== null && mainAccount.currency !== req.currency) {
            throw errs.ErrNotSupportedChangeCurrency;
        }
    } else if (mainAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
        if (reqSubAccounts.length < 1) {
            log.warnf(c, `[${P}.${handler}] account does not have any sub-accounts`);
            throw errs.ErrAccountHaveNoSubAccount;
        }

        if (req.category === ACCOUNT_CATEGORY_CREDIT_CARD) {
            if (((req.currency === null && mainAccount.currency === AccountCurrencyNotSetValue) || (req.currency !== null && req.currency === AccountCurrencyNotSetValue)) && creditLimitForCreditCard > 0n) {
                log.warnf(c, `[${P}.${handler}] parent account must set currency when set credit limit`);
                throw errs.ErrMustSetParentAccountCurrencyWhenSetCreditLimit;
            } else if (req.currency !== null && mainAccount.currency !== req.currency) {
                log.infof(c, `[${P}.${handler}] will change parent account curreny from ${mainAccount.currency} to ${req.currency}`);
                updateMainAccountCurrency = true;
            }
        } else {
            if (req.currency !== null && mainAccount.currency !== req.currency) {
                throw errs.ErrNotSupportedChangeCurrency;
            }
        }

        for (let i = 0; i < reqSubAccounts.length; i++) {
            const subAccountReq = reqSubAccounts[i] as AccountModifyRequest;
            subAccountBalances[i] = 0n;

            if (subAccountReq.category !== req.category) {
                log.warnf(c, `[${P}.${handler}] category of sub-account#${i} not equals to parent`);
                throw errs.ErrSubAccountCategoryNotEqualsToParent;
            }

            if (subAccountReq.id === 0n) { // create new sub-account
                if (subAccountReq.currency === null) {
                    log.warnf(c, `[${P}.${handler}] sub-account#${i} not set currency`);
                    throw errs.ErrAccountCurrencyInvalid;
                } else if (subAccountReq.currency === AccountCurrencyNotSetValue) {
                    log.warnf(c, `[${P}.${handler}] sub-account#${i} must set currency`);
                    throw errs.ErrAccountCurrencyInvalid;
                }

                let subAccountBalance = 0n;

                if (subAccountReq.balance !== null && subAccountReq.balance !== '') {
                    const balance = tryStringToInt64(subAccountReq.balance);

                    if (balance === null) {
                        throw errs.ErrIncompleteOrIncorrectSubmission;
                    }

                    subAccountBalance = balance;
                }

                subAccountBalances[i] = subAccountBalance;

                if (subAccountBalance === 0n) {
                    subAccountReq.balanceTime = 0;
                }

                if (subAccountBalance !== 0n && (subAccountReq.balanceTime === null || subAccountReq.balanceTime <= 0)) {
                    log.warnf(c, `[${P}.${handler}] sub-account#${i} balance time is not set`);
                    throw errs.ErrAccountBalanceTimeNotSet;
                }
            } else { // modify existed sub-account
                const subAccount = accountMap.get(subAccountReq.id);

                if (!subAccount) {
                    throw errs.ErrAccountNotFound;
                }

                if (subAccountReq.currency !== null && subAccount.currency !== subAccountReq.currency) {
                    throw errs.ErrNotSupportedChangeCurrency;
                }

                if (subAccountReq.balance !== null) {
                    throw errs.ErrNotSupportedChangeBalance;
                }

                if (subAccountReq.balanceTime !== null) {
                    throw errs.ErrNotSupportedChangeBalanceTime;
                }
            }

            if (subAccountReq.creditCardStatementDate !== 0) {
                log.warnf(c, `[${P}.${handler}] sub-account#${i} cannot set statement date`);
                throw errs.ErrCannotSetStatementDateForSubAccount;
            }

            if (subAccountReq.creditCardLimit !== '') {
                log.warnf(c, `[${P}.${handler}] sub-account#${i} cannot set credit limit`);
                throw errs.ErrCannotSetCreditLimitForSubAccount;
            }
        }
    }

    let anythingUpdate = false;
    const toUpdateAccounts: Account[] = [];
    const toAddAccounts: Account[] = [];
    const toAddAccountBalanceTimes: number[] = [];

    const toUpdateAccount = getToUpdateAccount(user, req, creditLimitForCreditCard, mainAccount, false);

    if (toUpdateAccount) {
        if (toUpdateAccount.category !== mainAccount.category) {
            const maxOrderId = await callOrFail(c, () => Accounts.getMaxDisplayOrder(c, uid, toUpdateAccount.category), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);
            toUpdateAccount.displayOrder = maxOrderId + 1;
        }

        anythingUpdate = true;
        toUpdateAccounts.push(toUpdateAccount);
    }

    const toDeleteAccountIds = getToDeleteSubAccountIds(reqSubAccounts, mainAccount, accountAndSubAccounts);

    if (toDeleteAccountIds.length > 0) {
        anythingUpdate = true;
    }

    let maxOrderId = 0;

    for (const account of accountAndSubAccounts) {
        if (account.accountId !== mainAccount.accountId && account.displayOrder > maxOrderId) {
            maxOrderId = account.displayOrder;
        }
    }

    for (let i = 0; i < reqSubAccounts.length; i++) {
        const subAccountReq = reqSubAccounts[i] as AccountModifyRequest;
        const existedSubAccount = accountMap.get(subAccountReq.id);

        if (!existedSubAccount) {
            anythingUpdate = true;
            maxOrderId = maxOrderId + 1;
            toAddAccounts.push(createNewSubAccountModelForModify(uid, mainAccount.type, subAccountReq, subAccountBalances[i] as bigint, maxOrderId));
            toAddAccountBalanceTimes.push(subAccountReq.balanceTime ?? 0);
        } else {
            const toUpdateSubAccount = getToUpdateAccount(user, subAccountReq, null, existedSubAccount, true);

            if (toUpdateSubAccount) {
                anythingUpdate = true;
                toUpdateAccounts.push(toUpdateSubAccount);
            }
        }
    }

    if (!anythingUpdate) {
        throw errs.ErrNothingWillBeUpdated;
    }

    if (!await isAccountsIconTypeValid(c, uid, [...toAddAccounts, ...toUpdateAccounts])) {
        log.warnf(c, `[${P}.${handler}] icon type invalid for user "uid:${uid}"`);
        throw errs.ErrAccountIconInvalid;
    }

    if (toAddAccounts.length > 0 && currentConfig().enableDuplicateSubmissionsCheck && req.clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_NEW_SUBACCOUNT, uid, req.clientSessionId);

        if (found) {
            log.infof(c, `[${P}.${handler}] another account "id:${remark}" modification has been created for user "uid:${uid}"`);
            const accountId = tryStringToInt64(remark);

            if (accountId !== null) {
                return getExistedAccountResponse(c, uid, accountId, handler);
            }
        }
    }

    await callOrFail(c, () => Accounts.modifyAccounts(c, mainAccount, toUpdateAccounts, toAddAccounts, toAddAccountBalanceTimes, toDeleteAccountIds, updateMainAccountCurrency, clientTimezone), () => `[${P}.${handler}] failed to update account "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has updated account "id:${req.id}" successfully`);

    if (toAddAccounts.length > 0) {
        setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_NEW_SUBACCOUNT, uid, req.clientSessionId, mainAccount.accountId.toString());
    }

    const accountRespMap = new Map<bigint, AccountInfoResponse>();

    for (const account of toUpdateAccounts) {
        const oldAccount = accountMap.get(account.accountId) as Account;
        account.type = oldAccount.type;
        account.parentAccountId = oldAccount.parentAccountId;
        account.balance = oldAccount.balance;
        const resp = toAccountInfoResponse(account);
        accountRespMap.set(resp.id, resp);
    }

    for (const account of toAddAccounts) {
        const resp = toAccountInfoResponse(account);
        accountRespMap.set(resp.id, resp);
    }

    const deletedAccountIds = new Set<bigint>(toDeleteAccountIds);

    for (const oldAccount of accountAndSubAccounts) {
        if (!accountRespMap.has(oldAccount.accountId) && !deletedAccountIds.has(oldAccount.accountId)) {
            const resp = toAccountInfoResponse(oldAccount);
            accountRespMap.set(resp.id, resp);
        }
    }

    const accountResp = accountRespMap.get(req.id) as AccountInfoResponse;

    for (const account of accountAndSubAccounts) {
        if (account.parentAccountId === accountResp.id && !deletedAccountIds.has(account.accountId)) {
            appendSubAccount(accountResp, accountRespMap.get(account.accountId) as AccountInfoResponse);
        }
    }

    for (const account of toAddAccounts) {
        if (account.parentAccountId === accountResp.id) {
            appendSubAccount(accountResp, accountRespMap.get(account.accountId) as AccountInfoResponse);
        }
    }

    sortSubAccounts(accountResp);
    return accountResp;
}

// accountUpdateLastReconciledTimeHandler updates the last reconciled time of an existed account by request parameters for current user
export async function accountUpdateLastReconciledTimeHandler(c: WebContext): Promise<unknown> {
    const handler = 'AccountUpdateLastReconciledTimeHandler';
    const req = await bindJson<{ id: bigint; lastReconciledTime: number }>(c, AccountUpdateLastReconciledTimeRequestSchema, `${P}.${handler}`);

    if (req.id <= 0n) {
        throw errs.ErrAccountIdInvalid;
    }

    const uid = c.getCurrentUid();
    const user = await getCurrentUserOrNotFound(c, handler);

    if (!user.useLastReconciledTime) {
        throw errs.ErrLastReconciledTimeIsNotEnabled;
    }

    const account = await callOrFail(c, () => Accounts.getAccountByAccountId(c, uid, req.id), () => `[${P}.${handler}] failed to get account "id:${req.id}" for user "uid:${uid}"`);

    if (account.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
        throw errs.ErrParentAccountCannotSetLastReconciledTime;
    }

    if (!account.extend) {
        account.extend = {};
    }

    const currentLastReconciledTime = account.extend.lastReconciledTime ?? null;

    if (currentLastReconciledTime !== null && req.lastReconciledTime < currentLastReconciledTime) {
        throw errs.ErrCannotSetLastReconciledTimeBeforeCurrent;
    } else if (currentLastReconciledTime !== null && req.lastReconciledTime === currentLastReconciledTime) {
        throw errs.ErrNothingWillBeUpdated;
    }

    account.extend.lastReconciledTime = req.lastReconciledTime;

    await callOrFail(c, () => Accounts.updateAccountExtend(c, uid, account), () => `[${P}.${handler}] failed to update last reconciled time for account "id:${account.accountId}" of user "uid:${uid}"`);
    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has updated last reconciled time "${req.lastReconciledTime}" for account "id:${account.accountId}"`);
    return true;
}

// accountHideHandler hides an existed account by request parameters for current user
export async function accountHideHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint; hidden: boolean }>(c, IdHideRequestSchema, `${P}.AccountHideHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => Accounts.hideAccount(c, uid, [req.id], req.hidden), () => `[${P}.AccountHideHandler] failed to hide account "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.AccountHideHandler] user "uid:${uid}" has hidden account "id:${req.id}"`);
    return true;
}

// accountMoveHandler moves display order of existed accounts by request parameters for current user
export async function accountMoveHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ newDisplayOrders: { id: bigint; displayOrder: number }[] }>(c, MoveRequestSchema, `${P}.AccountMoveHandler`);
    const uid = c.getCurrentUid();
    const accounts = req.newDisplayOrders.map(item => newAccount({ uid: uid, accountId: item.id, displayOrder: item.displayOrder }));

    await callOrFail(c, () => Accounts.modifyAccountDisplayOrders(c, uid, accounts), () => `[${P}.AccountMoveHandler] failed to move accounts for user "uid:${uid}"`);
    log.infof(c, `[${P}.AccountMoveHandler] user "uid:${uid}" has moved accounts`);
    return true;
}

// accountDeleteHandler deletes an existed account by request parameters for current user
export async function accountDeleteHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.AccountDeleteHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => Accounts.deleteAccount(c, uid, req.id), () => `[${P}.AccountDeleteHandler] failed to delete account "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.AccountDeleteHandler] user "uid:${uid}" has deleted account "id:${req.id}"`);
    return true;
}

// subAccountDeleteHandler deletes an existed sub-account by request parameters for current user
export async function subAccountDeleteHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.SubAccountDeleteHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => Accounts.deleteSubAccount(c, uid, req.id), () => `[${P}.SubAccountDeleteHandler] failed to delete sub-account "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.SubAccountDeleteHandler] user "uid:${uid}" has deleted sub-account "id:${req.id}"`);
    return true;
}

function createNewAccountModel(uid: bigint, req: AccountCreateRequest, balance: bigint, creditLimitForCreditCard: bigint | null, isSubAccount: boolean, order: number): Account {
    const accountExtend: AccountExtend = {};

    if (!isSubAccount && req.category === ACCOUNT_CATEGORY_CREDIT_CARD) {
        accountExtend.creditCardStatementDate = req.creditCardStatementDate;
        accountExtend.creditCardLimit = creditLimitForCreditCard;
    }

    return newAccount({
        uid: uid,
        name: req.name,
        displayOrder: order,
        category: req.category,
        type: req.type,
        icon: req.icon,
        iconType: req.iconType,
        color: req.color,
        currency: req.currency,
        balance: Number(balance),
        comment: req.comment,
        extend: accountExtend,
    });
}

function createNewSubAccountModelForModify(uid: bigint, accountType: AccountType, req: AccountModifyRequest, balance: bigint, order: number): Account {
    return newAccount({
        uid: uid,
        name: req.name,
        displayOrder: order,
        category: req.category,
        type: accountType,
        icon: req.icon,
        iconType: req.iconType,
        color: req.color,
        currency: req.currency as string,
        balance: Number(balance),
        comment: req.comment,
        extend: {},
    });
}

function optionalChanged<T>(newValue: T | null | undefined, oldValue: T | null | undefined): boolean {
    const n = newValue ?? null;
    const o = oldValue ?? null;
    return (n !== null && o === null) || (n === null && o !== null) || (n !== null && o !== null && n !== o);
}

function getToUpdateAccount(user: User, req: AccountModifyRequest, creditLimitForCreditCard: bigint | null, oldAccount: Account, isSubAccount: boolean): Account | null {
    const newAccountExtend: AccountExtend = {
        lastReconciledTime: req.lastReconciledTime,
    };

    if (!isSubAccount && req.category === ACCOUNT_CATEGORY_CREDIT_CARD) {
        newAccountExtend.creditCardStatementDate = req.creditCardStatementDate;
        newAccountExtend.creditCardLimit = creditLimitForCreditCard;
    }

    const newAcc = newAccount({
        accountId: oldAccount.accountId,
        uid: user.uid,
        name: req.name,
        displayOrder: oldAccount.displayOrder,
        category: req.category,
        icon: req.icon,
        iconType: req.iconType,
        color: req.color,
        currency: oldAccount.currency,
        comment: req.comment,
        extend: newAccountExtend,
        hidden: req.hidden,
    });

    if (!isSubAccount && req.currency !== null) {
        newAcc.currency = req.currency;
    }

    if (newAcc.name !== oldAccount.name ||
        newAcc.category !== oldAccount.category ||
        newAcc.icon !== oldAccount.icon ||
        newAcc.iconType !== oldAccount.iconType ||
        newAcc.color !== oldAccount.color ||
        newAcc.currency !== oldAccount.currency ||
        newAcc.comment !== oldAccount.comment ||
        newAcc.hidden !== oldAccount.hidden) {
        return newAcc;
    }

    const oldAccountExtend = oldAccount.extend;

    if (optionalChanged(newAccountExtend.lastReconciledTime, oldAccountExtend?.lastReconciledTime)) {
        if (!user.useLastReconciledTime) {
            throw errs.ErrLastReconciledTimeIsNotEnabled;
        }

        return newAcc;
    }

    if (optionalChanged(newAccountExtend.creditCardStatementDate, oldAccountExtend?.creditCardStatementDate)) {
        return newAcc;
    }

    if (optionalChanged(newAccountExtend.creditCardLimit, oldAccountExtend?.creditCardLimit)) {
        return newAcc;
    }

    return null;
}

function getToDeleteSubAccountIds(reqSubAccounts: AccountModifyRequest[], mainAccount: Account, accountAndSubAccounts: Account[]): bigint[] {
    const newSubAccountIds = new Set<bigint>(reqSubAccounts.map(subAccount => subAccount.id));
    const toDeleteAccountIds: bigint[] = [];

    for (const subAccount of accountAndSubAccounts) {
        if (subAccount.accountId === mainAccount.accountId) {
            continue;
        }

        if (!newSubAccountIds.has(subAccount.accountId)) {
            toDeleteAccountIds.push(subAccount.accountId);
        }
    }

    return toDeleteAccountIds;
}

async function isAccountsIconTypeValid(c: WebContext, uid: bigint, accounts: Account[]): Promise<boolean> {
    const iconIds: bigint[] = [];

    for (const account of accounts) {
        if (!isValidIconType(account.iconType)) {
            return false;
        }

        if (account.iconType === ICON_TYPE_USER_CUSTOM) {
            iconIds.push(account.icon);
        }
    }

    if (iconIds.length < 1) {
        return true;
    }

    try {
        return await UserCustomIcons.existsCustomIcons(c, uid, iconIds);
    } catch (err) {
        log.errorf(c, `[${P}.isAccountsIconTypeValid] failed to check custom icons for user "uid:${uid}", because ${errMsg(err)}`);
        return false;
    }
}
