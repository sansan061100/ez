import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_IMAGE_RECOGNITION, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_TEXT_RECOGNITION } from '../core/feature_restriction';
import * as errs from '../errs/index';
import { Container as LLMContainer, LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL, LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_TEXT, type LargeLanguageModelRequest } from '../llm/index';
import * as log from '../log/index';
import {
    type Account,
    ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS,
    CATEGORY_TYPE_EXPENSE,
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    LevelOneTransactionCategoryParentId,
    type RecognizedTransactionResult,
    type TransactionCategory,
    type TransactionTag,
    type TransactionTextRecognitionRequest,
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_TRANSFER,
} from '../models/index';
import { Accounts } from '../services/accounts';
import { nowUnix } from '../services/base';
import { TransactionCategories } from '../services/transaction_categories';
import { TransactionTags } from '../services/transaction_tags';
import { getTemplate, SYSTEM_PROMPT_RECEIPT_IMAGE_RECOGNITION, SYSTEM_PROMPT_TRANSACTION_TEXT_RECOGNITION } from '../templates/index';
import { parseAmount } from '../utils/converter';
import { formatUnixTimeToLongDateTime, parseFromLongDateTimeInTimeZone, type Timezone } from '../utils/datetimes';
import { goJsonString, goJsonStringArray, goJsonUnmarshalObject } from '../utils/gojson';
import { getFileNameExtension, getImageContentType } from '../utils/io';
import { isValidLongDateFormat, isValidLongDateTimeFormat, isValidLongDateTimeWithoutSecondFormat } from '../utils/validators';
import type { WebContext } from '../web/context';
import { bindJson, currentConfig, errMsg, getClientTimezoneOrThrow } from './base';
import { getCurrentUserWarnWithUid } from './common';
import { TransactionTextRecognitionRequestSchema } from './schemas';

const P = 'large_language_models';

export interface UserEssentialData {
    accountNames: string[];
    accountMap: Map<string, Account>;
    incomeCategoryNames: string[];
    expenseCategoryNames: string[];
    transferCategoryNames: string[];
    incomeCategoryMap: Map<string, TransactionCategory>;
    expenseCategoryMap: Map<string, TransactionCategory>;
    transferCategoryMap: Map<string, TransactionCategory>;
    tagNames: string[];
    tagMap: Map<string, TransactionTag>;
}

// getUserEssentialData returns the accounts, categories and tags names of user for large language model prompt
export async function getUserEssentialData(c: WebContext, uid: bigint, logPrefix: string = `${P}.getUserEssentialData`): Promise<UserEssentialData> {
    let accounts: Account[];

    try {
        accounts = await Accounts.getAllAccountsByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get all accounts for user "uid:${uid}", because ${errMsg(err)}`);
        throw err;
    }

    const accountMap = Accounts.getVisibleAccountNameMapByList(accounts);
    const accountNames = accounts.filter(account => !account.hidden && account.type !== ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS).map(account => account.name);

    let categories: TransactionCategory[];

    try {
        categories = await TransactionCategories.getAllCategoriesByUid(c, uid, 0, -1n);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get categories for user "uid:${uid}", because ${errMsg(err)}`);
        throw err;
    }

    const data: UserEssentialData = {
        accountNames: accountNames,
        accountMap: accountMap,
        incomeCategoryNames: [],
        expenseCategoryNames: [],
        transferCategoryNames: [],
        incomeCategoryMap: new Map(),
        expenseCategoryMap: new Map(),
        transferCategoryMap: new Map(),
        tagNames: [],
        tagMap: new Map(),
    };

    for (const category of categories) {
        if (category.hidden || category.parentCategoryId === LevelOneTransactionCategoryParentId) {
            continue;
        }

        if (category.type === CATEGORY_TYPE_INCOME) {
            data.incomeCategoryMap.set(category.name, category);
            data.incomeCategoryNames.push(category.name);
        } else if (category.type === CATEGORY_TYPE_EXPENSE) {
            data.expenseCategoryMap.set(category.name, category);
            data.expenseCategoryNames.push(category.name);
        } else if (category.type === CATEGORY_TYPE_TRANSFER) {
            data.transferCategoryMap.set(category.name, category);
            data.transferCategoryNames.push(category.name);
        }
    }

    let tags: TransactionTag[];

    try {
        tags = await TransactionTags.getAllTagsByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get tags for user "uid:${uid}", because ${errMsg(err)}`);
        throw err;
    }

    data.tagMap = TransactionTags.getVisibleTagNameMapByList(tags);
    data.tagNames = tags.filter(tag => !tag.hidden).map(tag => tag.name);

    return data;
}

// getSystemPromptParams returns the params of system prompt template
export function getSystemPromptParams(clientTimezone: Timezone, data: UserEssentialData, additionalNotes: string | null): Record<string, string> {
    const params: Record<string, string> = {
        CurrentDateTime: formatUnixTimeToLongDateTime(nowUnix(), clientTimezone),
        AllExpenseCategoryNames: data.expenseCategoryNames.join('\n'),
        AllIncomeCategoryNames: data.incomeCategoryNames.join('\n'),
        AllTransferCategoryNames: data.transferCategoryNames.join('\n'),
        AllAccountNames: data.accountNames.join('\n'),
        AllTagNames: data.tagNames.join('\n'),
    };

    if (additionalNotes !== null) {
        params['AdditionalNotes'] = additionalNotes;
    }

    return params;
}

// parseRecognizedTransactionResult parses the llm response content to recognized transaction result (null means json null)
export function parseRecognizedTransactionResult(content: string): RecognizedTransactionResult | null {
    const obj = goJsonUnmarshalObject(content, 'models.RecognizedTransactionResult');

    if (!obj) {
        return null;
    }

    const result: RecognizedTransactionResult = {
        type: goJsonString(obj, 'type'),
        time: goJsonString(obj, 'time'),
        amount: goJsonString(obj, 'amount'),
        account: goJsonString(obj, 'account'),
        category: goJsonString(obj, 'category'),
        description: goJsonString(obj, 'description'),
        destination_amount: goJsonString(obj, 'destination_amount'),
        destination_account: goJsonString(obj, 'destination_account'),
    };

    const tags = goJsonStringArray(obj, 'tags');

    if (tags) {
        result.tags = tags;
    }

    return result;
}

function getLongDateTime(dateTime: string): string {
    if (isValidLongDateTimeFormat(dateTime)) {
        return dateTime;
    }

    if (isValidLongDateTimeWithoutSecondFormat(dateTime)) {
        return dateTime + ':00';
    }

    if (isValidLongDateFormat(dateTime)) {
        return dateTime + ' 00:00:00';
    }

    return dateTime;
}

// parseRecognizedTransactionResponse converts the recognized result to the response
export function parseRecognizedTransactionResponse(c: WebContext, clientTimezone: Timezone, result: RecognizedTransactionResult | null, data: UserEssentialData): Record<string, unknown> {
    const prefix = `${P}.parseRecognizedTransactionResponse`;

    if (!result) {
        log.errorf(c, `[${prefix}] recoginzed result is null`);
        throw errs.ErrNoTransactionInformation;
    }

    let type = TRANSACTION_TYPE_EXPENSE;
    let categoryId = 0n;
    let categoryMap: Map<string, TransactionCategory>;
    const resultType = result.type ?? '';
    const categoryName = result.category ?? '';

    if (resultType === 'income') {
        type = TRANSACTION_TYPE_INCOME;
        categoryMap = data.incomeCategoryMap;
    } else if (resultType === 'expense') {
        type = TRANSACTION_TYPE_EXPENSE;
        categoryMap = data.expenseCategoryMap;
    } else if (resultType === 'transfer') {
        type = TRANSACTION_TYPE_TRANSFER;
        categoryMap = data.transferCategoryMap;
    } else if (resultType.length === 0) {
        throw errs.ErrNoTransactionInformation;
    } else {
        log.errorf(c, `[${prefix}] recoginzed transaction type "${resultType}" is invalid`);
        throw errs.ErrOperationFailed;
    }

    if (categoryName.length > 0) {
        const category = categoryMap.get(categoryName);

        if (category) {
            categoryId = category.categoryId;
        }
    }

    let time = 0;

    if (result.time.length > 0) {
        try {
            time = Math.floor(parseFromLongDateTimeInTimeZone(getLongDateTime(result.time), clientTimezone).toSeconds());
        } catch {
            log.warnf(c, `[${prefix}] recoginzed time "${result.time}" is invalid`);
        }
    }

    let sourceAmount = 0;
    let destinationAmount = 0;
    const amountText = result.amount ?? '';

    if (amountText.length > 0) {
        try {
            sourceAmount = parseAmount(amountText);
        } catch {
            log.errorf(c, `[${prefix}] recoginzed amount "${amountText}" is invalid`);
            throw errs.ErrOperationFailed;
        }

        const destinationAmountText = result.destination_amount ?? '';

        if (type === TRANSACTION_TYPE_TRANSFER && destinationAmountText.length > 0) {
            try {
                destinationAmount = parseAmount(destinationAmountText);
            } catch {
                log.errorf(c, `[${prefix}] recoginzed destination amount "${destinationAmountText}" is invalid`);
                throw errs.ErrOperationFailed;
            }
        }
    }

    let sourceAccountId = 0n;
    let destinationAccountId = 0n;

    if ((result.account ?? '').length > 0) {
        sourceAccountId = data.accountMap.get(result.account as string)?.accountId ?? 0n;
    }

    if ((result.destination_account ?? '').length > 0) {
        destinationAccountId = data.accountMap.get(result.destination_account as string)?.accountId ?? 0n;
    }

    const tagIds: string[] = [];

    for (const tagName of result.tags ?? []) {
        const tag = data.tagMap.get(tagName);

        if (tag) {
            tagIds.push(tag.tagId.toString());
        }
    }

    const response: Record<string, unknown> = { type: type };

    if (time !== 0) {
        response['time'] = time;
    }

    if (categoryId !== 0n) {
        response['categoryId'] = categoryId;
    }

    if (sourceAccountId !== 0n) {
        response['sourceAccountId'] = sourceAccountId;
    }

    if (destinationAccountId !== 0n) {
        response['destinationAccountId'] = destinationAccountId;
    }

    if (sourceAmount !== 0) {
        response['sourceAmount'] = sourceAmount;
    }

    if (destinationAmount !== 0) {
        response['destinationAmount'] = destinationAmount;
    }

    if (tagIds.length > 0) {
        response['tagIds'] = tagIds;
    }

    if ((result.description ?? '').length > 0) {
        response['comment'] = result.description;
    }

    return response;
}

async function getRecognizedResponse(c: WebContext, handler: string, clientTimezone: Timezone, data: UserEssentialData, content: string | null, resultName: string): Promise<unknown> {
    const uid = c.getCurrentUid();

    if (content === null || content.length === 0 || content.startsWith('{}')) {
        throw errs.ErrNoTransactionInformation;
    }

    let result: RecognizedTransactionResult | null;

    try {
        result = parseRecognizedTransactionResult(content);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to unmarshal ${resultName} result from llm response "${content}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return parseRecognizedTransactionResponse(c, clientTimezone, result, data);
}

// recognizeTransactionTextHandler returns the recognized transaction from the text
export async function recognizeTransactionTextHandler(c: WebContext): Promise<unknown> {
    const handler = 'RecognizeTransactionTextHandler';
    const config = currentConfig();

    if (!config.textRecognitionLLMConfig || config.textRecognitionLLMConfig.llmProvider === '' || !config.transactionFromAITextRecognition) {
        throw errs.ErrLargeLanguageModelProviderNotEnabled;
    }

    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getCurrentUserWarnWithUid(c, `${P}.${handler}`);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_TEXT_RECOGNITION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    const req = await bindJson<TransactionTextRecognitionRequest>(c, TransactionTextRecognitionRequestSchema, `${P}.${handler}`);

    if (req.text.length === 0) {
        log.warnf(c, `[${P}.${handler}] there is no text in request for user "uid:${uid}"`);
        throw errs.ErrNoAIRecognitionText;
    }

    const text = req.text.trim();

    if (text.length === 0) {
        log.warnf(c, `[${P}.${handler}] the text in request is empty for user "uid:${uid}"`);
        throw errs.ErrAIRecognitionTextIsEmpty;
    }

    let data: UserEssentialData;

    try {
        data = await getUserEssentialData(c, uid);
    } catch (err) {
        throw errs.or(err, errs.ErrOperationFailed);
    }

    let systemPrompt: string;

    try {
        systemPrompt = getTemplate(SYSTEM_PROMPT_TRANSACTION_TEXT_RECOGNITION).execute(getSystemPromptParams(clientTimezone, data, null));
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get system prompt template for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const llmRequest: LargeLanguageModelRequest = {
        stream: false,
        systemPrompt: systemPrompt.replaceAll('\r\n', '\n'),
        userPrompt: Buffer.from(text, 'utf8'),
        userPromptType: LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_TEXT,
        userPromptContentType: '',
        responseJsonSchema: null,
    };

    let content: string;

    try {
        content = (await LLMContainer.getJsonResponseByTextRecognitionModel(c, uid, config, llmRequest)).content;
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get llm response user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return getRecognizedResponse(c, handler, clientTimezone, data, content, 'recognized transaction text');
}

// recognizeReceiptImageHandler returns the recognized transaction from the receipt image
export async function recognizeReceiptImageHandler(c: WebContext): Promise<unknown> {
    const handler = 'RecognizeReceiptImageHandler';
    const config = currentConfig();

    if (!config.receiptImageRecognitionLLMConfig || config.receiptImageRecognitionLLMConfig.llmProvider === '' || !config.transactionFromAIImageRecognition) {
        throw errs.ErrLargeLanguageModelProviderNotEnabled;
    }

    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();
    const user = await getCurrentUserWarnWithUid(c, `${P}.${handler}`);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_IMAGE_RECOGNITION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    let form;

    try {
        form = await c.multipartForm();
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get multi-part form data for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.ErrParameterInvalid;
    }

    const imageFile = form.files['image']?.[0];

    if (!imageFile) {
        log.warnf(c, `[${P}.${handler}] there is no image in request for user "uid:${uid}"`);
        throw errs.ErrNoAIRecognitionImage;
    }

    if (imageFile.size < 1) {
        log.warnf(c, `[${P}.${handler}] the size of image in request is zero for user "uid:${uid}"`);
        throw errs.ErrAIRecognitionImageIsEmpty;
    }

    if (imageFile.size > config.maxAIRecognitionPictureFileSize) {
        log.warnf(c, `[${P}.${handler}] the upload file size "${imageFile.size}" exceeds the maximum size "${config.maxAIRecognitionPictureFileSize}" of image for user "uid:${uid}"`);
        throw errs.ErrExceedMaxAIRecognitionImageFileSize;
    }

    const fileExtension = getFileNameExtension(imageFile.name);
    const contentType = getImageContentType(fileExtension);

    if (contentType === '') {
        log.warnf(c, `[${P}.${handler}] the file extension "${fileExtension}" of image in request is not supported for user "uid:${uid}"`);
        throw errs.ErrImageTypeNotSupported;
    }

    let data: UserEssentialData;

    try {
        data = await getUserEssentialData(c, uid);
    } catch (err) {
        throw errs.or(err, errs.ErrOperationFailed);
    }

    let systemPrompt: string;

    try {
        systemPrompt = getTemplate(SYSTEM_PROMPT_RECEIPT_IMAGE_RECOGNITION).execute(getSystemPromptParams(clientTimezone, data, ''));
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get system prompt template for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const llmRequest: LargeLanguageModelRequest = {
        stream: false,
        systemPrompt: systemPrompt.replaceAll('\r\n', '\n'),
        userPrompt: imageFile.data,
        userPromptType: LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL,
        userPromptContentType: contentType,
        responseJsonSchema: null,
    };

    let content: string;

    try {
        content = (await LLMContainer.getJsonResponseByReceiptImageRecognitionModel(c, uid, config, llmRequest)).content;
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get llm response user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return getRecognizedResponse(c, handler, clientTimezone, data, content, 'recognized receipt image');
}
