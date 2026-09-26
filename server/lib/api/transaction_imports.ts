import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_IMAGE_RECOGNITION, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_TEXT_RECOGNITION, USER_FEATURE_RESTRICTION_TYPE_IMPORT_TRANSACTION } from '../core/feature_restriction';
import { parseImporterOptions, type TransactionDataImporter } from '../converters/converter';
import type { TransactionDataTableColumn } from '../converters/datatable';
import { createNewCustomFileFormatTransactionDataParser, createNewCustomTransactionDataImporter, getTransactionDataImporter, isCustomFileFormatFileType } from '../converters/index';
import { DUPLICATE_CHECKER_TYPE_IMPORT_TRANSACTIONS } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    canEditTransactionByTransactionTime,
    importedTransactionsToResponseList,
    type ImportTransactionResponsePageWrapper,
    MaximumTagsCountOfTransaction,
    type Transaction,
    TRANSACTION_TYPE_MODIFY_BALANCE,
    TRANSACTION_TYPE_TRANSFER,
    type TransactionImportProcessRequest,
    type TransactionImportRequest,
    type TransactionType,
} from '../models/index';
import { Accounts } from '../services/accounts';
import { TransactionCategories } from '../services/transaction_categories';
import { TransactionTags } from '../services/transaction_tags';
import { Transactions } from '../services/transactions';
import { stringArrayToInt64Array, stringToFloat64, stringToInt } from '../utils/converter';
import { getFileNameExtension, getImageContentType } from '../utils/io';
import type { WebContext } from '../web/context';
import { bindJson, bindQuery, currentConfig, errMsg, getClientTimezoneOrThrow, getSubmissionRemark, removeSubmissionRemarkIfEnable, setSubmissionRemarkIfEnable } from './base';
import { callOrFail } from './common';
import { TransactionImportProcessRequestSchema, TransactionImportRequestSchema } from './schemas';
import { createNewTransactionModel, getTransactionUsedAccountsOrFail, getUserOrNotFound } from './transactions';

const P = 'transactions';

type MultipartForm = Awaited<ReturnType<WebContext['multipartForm']>>;

async function getMultipartFormOrThrow(c: WebContext, handler: string): Promise<MultipartForm> {
    try {
        return await c.multipartForm();
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get multi-part form data for user "uid:${c.getCurrentUid()}", because ${errMsg(err)}`);
        throw errs.ErrParameterInvalid;
    }
}

function firstFormValue(form: MultipartForm, key: string): string {
    return form.values[key]?.[0] ?? '';
}

// parseGoIntegerMapJson emulates json.Unmarshal into map[K]V where both K and V are integer kinds (or K is string when keyMax is null)
function parseGoIntegerMapJson(text: string, keyMax: number | null, valueMin: number, valueMax: number): Map<string, number> {
    const result = new Map<string, number>();
    const parsed = JSON.parse(text, function (this: unknown, _key: string, value: unknown, context?: { source?: string }) {
        if (typeof value === 'number' && context?.source !== undefined) {
            if (!/^-?\d+$/.test(context.source)) {
                throw new Error(`json: cannot unmarshal number ${context.source} into Go value of integer type`);
            }
        }

        return value;
    }) as unknown;

    if (parsed === null) {
        return result;
    }

    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('json: cannot unmarshal into Go value of type map');
    }

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (keyMax !== null && (!/^\d+$/.test(key) || Number(key) > keyMax)) {
            throw new Error(`json: cannot unmarshal number ${key} into Go value of type map key`);
        }

        if (value === null) {
            result.set(key, 0);
            continue;
        }

        if (typeof value !== 'number' || value < valueMin || value > valueMax) {
            throw new Error(`json: cannot unmarshal ${JSON.stringify(value)} into Go value of integer type`);
        }

        result.set(key, value);
    }

    return result;
}

function isTextRecognitionDisabled(): boolean {
    const config = currentConfig();
    return !config.textRecognitionLLMConfig || config.textRecognitionLLMConfig.llmProvider === '' || !config.transactionFromAITextRecognition;
}

function isImageRecognitionDisabled(): boolean {
    const config = currentConfig();
    return !config.receiptImageRecognitionLLMConfig || config.receiptImageRecognitionLLMConfig.llmProvider === '' || !config.transactionFromAIImageRecognition;
}

// transactionParseImportCustomFileDataHandler returns the parsed file data by request parameters for current user
export async function transactionParseImportCustomFileDataHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionParseImportCustomFileDataHandler';
    const uid = c.getCurrentUid();
    const form = await getMultipartFormOrThrow(c, handler);
    const fileType = firstFormValue(form, 'fileType');

    if (fileType === '') {
        throw errs.ErrImportFileTypeIsEmpty;
    }

    if (!isCustomFileFormatFileType(fileType)) {
        throw errs.ErrImportFileTypeNotSupported;
    }

    const fileEncoding = firstFormValue(form, 'fileEncoding');
    let dataParser;

    try {
        dataParser = createNewCustomFileFormatTransactionDataParser(fileType, fileEncoding);
    } catch (err) {
        throw errs.or(err, errs.ErrImportFileTypeNotSupported);
    }

    const importFile = form.files['file']?.[0];

    if (!importFile) {
        log.warnf(c, `[${P}.${handler}] there is no import file in request for user "uid:${uid}"`);
        throw errs.ErrNoFilesUpload;
    }

    if (importFile.size < 1) {
        log.warnf(c, `[${P}.${handler}] the size of import file in request is zero for user "uid:${uid}"`);
        throw errs.ErrUploadedFileEmpty;
    }

    if (importFile.size > currentConfig().maxImportFileSize) {
        log.warnf(c, `[${P}.${handler}] the upload file size "${importFile.size}" exceeds the maximum size "${currentConfig().maxImportFileSize}" of import file for user "uid:${uid}"`);
        throw errs.ErrExceedMaxUploadFileSize;
    }

    try {
        return dataParser.parseDataLines(c, importFile.data);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to parse import file data for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// transactionParseImportFileHandler returns the parsed transaction data by request parameters for current user
export async function transactionParseImportFileHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionParseImportFileHandler';
    const uid = c.getCurrentUid();
    const form = await getMultipartFormOrThrow(c, handler);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const fileType = firstFormValue(form, 'fileType');

    if (fileType === '') {
        throw errs.ErrImportFileTypeIsEmpty;
    }

    let additionalOptions = parseImporterOptions(currentConfig(), firstFormValue(form, 'options'));

    if (fileType === 'ai_txt' || fileType === 'ai_image') {
        const aiAdditionalPrompts = form.values['aiPrompt'];

        if (aiAdditionalPrompts && aiAdditionalPrompts.length > 0) {
            additionalOptions = additionalOptions.withAIAdditionalPrompt(aiAdditionalPrompts[0] as string);
        }
    }

    let dataImporter: TransactionDataImporter;

    try {
        if (isCustomFileFormatFileType(fileType)) {
            const fileEncoding = firstFormValue(form, 'fileEncoding');
            const columnMapping = firstFormValue(form, 'columnMapping');

            if (columnMapping === '') {
                throw errs.ErrImportFileColumnMappingInvalid;
            }

            const columnIndexMapping = new Map<TransactionDataTableColumn, number>();

            try {
                for (const [key, value] of parseGoIntegerMapJson(columnMapping, 255, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) {
                    columnIndexMapping.set(Number(key) as TransactionDataTableColumn, value);
                }
            } catch (err) {
                log.errorf(c, `[${P}.${handler}] failed to parse column mapping for user "uid:${uid}", because ${errMsg(err)}`);
                throw errs.ErrImportFileColumnMappingInvalid;
            }

            const transactionTypeMapping = firstFormValue(form, 'transactionTypeMapping');

            if (transactionTypeMapping === '') {
                throw errs.ErrImportFileTransactionTypeMappingInvalid;
            }

            let transactionTypeNameMapping: Map<string, TransactionType>;

            try {
                transactionTypeNameMapping = parseGoIntegerMapJson(transactionTypeMapping, null, 0, 255) as Map<string, TransactionType>;
            } catch (err) {
                log.errorf(c, `[${P}.${handler}] failed to parse transaction type mapping for user "uid:${uid}", because ${errMsg(err)}`);
                throw errs.ErrImportFileTransactionTypeMappingInvalid;
            }

            const hasHeaderLine = firstFormValue(form, 'hasHeaderLine') === 'true';
            const timeFormat = firstFormValue(form, 'timeFormat');

            if (timeFormat === '') {
                throw errs.ErrImportFileTransactionTimeFormatInvalid;
            }

            dataImporter = createNewCustomTransactionDataImporter(
                fileType,
                fileEncoding,
                columnIndexMapping,
                transactionTypeNameMapping,
                hasHeaderLine,
                timeFormat,
                firstFormValue(form, 'timezoneFormat'),
                firstFormValue(form, 'amountDecimalSeparator'),
                firstFormValue(form, 'amountDigitGroupingSymbol'),
                firstFormValue(form, 'geoSeparator'),
                firstFormValue(form, 'geoOrder'),
                firstFormValue(form, 'tagSeparator'),
            );
        } else {
            dataImporter = getTransactionDataImporter(fileType);
        }
    } catch (err) {
        throw errs.or(err, errs.ErrImportFileTypeNotSupported);
    }

    if (fileType === 'ai_txt' && isTextRecognitionDisabled()) {
        throw errs.ErrLargeLanguageModelProviderNotEnabled;
    }

    if (fileType === 'ai_image' && isImageRecognitionDisabled()) {
        throw errs.ErrLargeLanguageModelProviderNotEnabled;
    }

    const importFile = form.files['file']?.[0];

    if (!importFile) {
        log.warnf(c, `[${P}.${handler}] there is no import file in request for user "uid:${uid}"`);
        throw errs.ErrNoFilesUpload;
    }

    if (importFile.size < 1) {
        log.warnf(c, `[${P}.${handler}] the size of import file in request is zero for user "uid:${uid}"`);
        throw errs.ErrUploadedFileEmpty;
    }

    const maxImportFileSize = fileType === 'ai_image' ? currentConfig().maxAIRecognitionPictureFileSize : currentConfig().maxImportFileSize;

    if (importFile.size > maxImportFileSize) {
        log.warnf(c, `[${P}.${handler}] the upload file size "${importFile.size}" exceeds the maximum size "${maxImportFileSize}" of import file for user "uid:${uid}"`);
        throw errs.ErrExceedMaxUploadFileSize;
    }

    if (fileType === 'ai_image') {
        const fileExtension = getFileNameExtension(importFile.name);
        const contentType = getImageContentType(fileExtension);

        if (contentType === '') {
            log.warnf(c, `[${P}.${handler}] the file extension "${fileExtension}" of image in request is not supported for user "uid:${uid}"`);
            throw errs.ErrImageTypeNotSupported;
        }

        additionalOptions = additionalOptions.withAIImageContentType(contentType);
    }

    const user = await getUserOrNotFound(c, handler);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_IMPORT_TRANSACTION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (fileType === 'ai_txt' && containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_TEXT_RECOGNITION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (fileType === 'ai_image' && containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_IMAGE_RECOGNITION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    const accounts = await callOrFail(c, () => Accounts.getAllAccountsByUid(c, user.uid), () => `[${P}.${handler}] failed to get accounts for user "uid:${user.uid}"`);
    const accountMap = Accounts.getVisibleAccountNameMapByList(accounts);

    const categories = await callOrFail(c, () => TransactionCategories.getAllCategoriesByUid(c, user.uid, 0, -1n), () => `[${P}.${handler}] failed to get categories for user "uid:${user.uid}"`);
    const [expenseCategoryMap, incomeCategoryMap, transferCategoryMap] = TransactionCategories.getVisibleSubCategoryNameMapByList(categories);

    const tags = await callOrFail(c, () => TransactionTags.getAllTagsByUid(c, user.uid), () => `[${P}.${handler}] failed to get tags for user "uid:${user.uid}"`);
    const tagMap = TransactionTags.getVisibleTagNameMapByList(tags);

    const [parsedTransactions] = await callOrFail(
        c,
        () => dataImporter.parseImportedData(c, user, importFile.data, clientTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap),
        () => `[${P}.${handler}] failed to parse imported data for user "uid:${user.uid}"`,
    );

    const parsedTransactionRespsList = importedTransactionsToResponseList(parsedTransactions);

    if (parsedTransactionRespsList.length < 1) {
        throw errs.ErrNoDataToImport;
    }

    const parsedTransactionResps: ImportTransactionResponsePageWrapper = {
        items: parsedTransactionRespsList,
        totalCount: parsedTransactionRespsList.length,
    };

    return parsedTransactionResps;
}

// transactionImportHandler imports transactions by request parameters for current user
export async function transactionImportHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionImportHandler';
    const req = await bindJson<TransactionImportRequest>(c, TransactionImportRequestSchema, `${P}.${handler}`);
    const clientTimezone = getClientTimezoneOrThrow(c, `${P}.${handler}`);
    const uid = c.getCurrentUid();

    if (currentConfig().enableDuplicateSubmissionsCheck && req.clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_IMPORT_TRANSACTIONS, uid, req.clientSessionId);

        if (found) {
            const items = remark.split(':');

            if (items.length >= 2) {
                if (items[0] === 'finished') {
                    log.infof(c, `[${P}.${handler}] another "${items[1]}" transactions has been imported for user "uid:${uid}"`);

                    try {
                        return stringToInt(items[1] as string);
                    } catch {
                        // continue importing
                    }
                } else if (items[0] === 'processing') {
                    throw errs.ErrRepeatedRequest;
                }
            } else {
                log.warnf(c, `[${P}.${handler}] another transaction import task may be executing, but remark "${remark}" is invalid`);
            }
        }
    }

    const reqTransactions = req.transactions ?? [];
    const newTransactionTagIdsMap = new Map<number, bigint[]>();

    for (let i = 0; i < reqTransactions.length; i++) {
        const transactionCreateReq = reqTransactions[i]!;
        let tagIds: bigint[];

        try {
            tagIds = stringArrayToInt64Array(transactionCreateReq.tagIds ?? []);
        } catch (err) {
            log.warnf(c, `[${P}.${handler}] parse tag ids failed of transaction "index:${i}", because ${errMsg(err)}`);
            throw errs.ErrTransactionTagIdInvalid;
        }

        if (tagIds.length > MaximumTagsCountOfTransaction) {
            throw errs.ErrTransactionHasTooManyTags;
        }

        if (transactionCreateReq.type < TRANSACTION_TYPE_MODIFY_BALANCE || transactionCreateReq.type > TRANSACTION_TYPE_TRANSFER) {
            log.warnf(c, `[${P}.${handler}] transaction type of transaction "index:${i}" is invalid`);
            throw errs.ErrTransactionTypeInvalid;
        }

        if (transactionCreateReq.type === TRANSACTION_TYPE_MODIFY_BALANCE && transactionCreateReq.categoryId !== 0n) {
            log.warnf(c, `[${P}.${handler}] balance modification transaction "index:${i}" cannot set category id`);
            throw errs.ErrBalanceModificationTransactionCannotSetCategory;
        }

        if (transactionCreateReq.type !== TRANSACTION_TYPE_TRANSFER && transactionCreateReq.destinationAccountId !== 0n) {
            log.warnf(c, `[${P}.${handler}] non-transfer transaction "index:${i}" destination account cannot be set`);
            throw errs.ErrTransactionDestinationAccountCannotBeSet;
        } else if (transactionCreateReq.type === TRANSACTION_TYPE_TRANSFER && transactionCreateReq.sourceAccountId === transactionCreateReq.destinationAccountId) {
            log.warnf(c, `[${P}.${handler}] transfer transaction "index:${i}" source account must not be destination account`);
            throw errs.ErrTransactionSourceAndDestinationIdCannotBeEqual;
        }

        if (transactionCreateReq.type !== TRANSACTION_TYPE_TRANSFER && transactionCreateReq.destinationAmount !== 0) {
            log.warnf(c, `[${P}.${handler}] non-transfer transaction "index:${i}" destination amount cannot be set`);
            throw errs.ErrTransactionDestinationAmountCannotBeSet;
        }

        newTransactionTagIdsMap.set(i, tagIds);
    }

    const user = await getUserOrNotFound(c, handler);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_IMPORT_TRANSACTION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    const newTransactions: Transaction[] = reqTransactions.map(transactionCreateReq => createNewTransactionModel(uid, transactionCreateReq, c.clientIP()));
    const allUsedAccounts = await getTransactionUsedAccountsOrFail(c, uid, newTransactions, handler);

    for (let i = 0; i < newTransactions.length; i++) {
        const transaction = newTransactions[i]!;
        const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, clientTimezone, allUsedAccounts.get(transaction.accountId) ?? null, allUsedAccounts.get(transaction.relatedAccountId) ?? null);

        if (!transactionEditable) {
            log.warnf(c, `[${P}.${handler}] transaction "index:${i}" is not editable for user "uid:${uid}"`);
            throw errs.ErrCannotCreateTransactionWithThisTransactionTime;
        }
    }

    const count = newTransactions.length;

    try {
        await Transactions.batchCreateTransactions(c, user.uid, newTransactions, newTransactionTagIdsMap, (currentProcess: number) => {
            setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_IMPORT_TRANSACTIONS, uid, req.clientSessionId, `processing:${currentProcess.toFixed(2)}`);
        });
    } catch (err) {
        removeSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_IMPORT_TRANSACTIONS, uid, req.clientSessionId);
        log.errorf(c, `[${P}.${handler}] failed to import ${count} transactions for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has imported ${count} transactions successfully`);
    setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_IMPORT_TRANSACTIONS, uid, req.clientSessionId, `finished:${count}`);

    return count;
}

// transactionImportProcessHandler returns the process of specified transaction import task by request parameters for current user
export async function transactionImportProcessHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionImportProcessHandler';
    const req = await bindQuery<TransactionImportProcessRequest>(c, TransactionImportProcessRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();

    if (!currentConfig().enableDuplicateSubmissionsCheck) {
        return null;
    }

    const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_IMPORT_TRANSACTIONS, uid, req.clientSessionId);

    if (!found) {
        return null;
    }

    const items = remark.split(':');

    if (items.length < 2) {
        return null;
    }

    if (items[0] === 'finished') {
        return 100;
    } else if (items[0] !== 'processing') {
        return null;
    }

    let process: number;

    try {
        process = stringToFloat64(items[1] as string);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] parse process failed, because ${errMsg(err)}`);
        return null;
    }

    if (process < 0) {
        return null;
    } else if (process >= 100) {
        process = 100;
    }

    return process;
}
