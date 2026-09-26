import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { MaximumTransactionAmount, MinimumTransactionAmount, TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_MODIFY_BALANCE, TRANSACTION_TYPE_TRANSFER } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { parseFromLongDateFirstTime } from '../utils/datetimes';
import { decodeWithBOMOverride } from '../utils/encodings';
import { readAllGoCsv } from '../utils/gocsv';
import { createNewImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TAGS,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataRow,
    type TransactionDataRowIterator,
    type TransactionDataTable,
    type TransactionDataTableColumn,
} from './datatable';

// ---------------------------------------------------------------------------
// data

const beancountEquityAccountNameOpeningBalance = 'Opening-Balances';

const enum BeancountAccountType {
    Unknown = 0,
    Assets = 1,
    Liabilities = 2,
    Equity = 3,
    Income = 4,
    Expenses = 5,
}

interface BeancountAccount {
    name: string;
    accountType: BeancountAccountType;
    openDate: string;
    closeDate: string;
}

interface BeancountTransactionEntry {
    date: string;
    directive: string;
    payee: string;
    narration: string;
    postings: BeancountPosting[];
    tags: string[];
    links: string[];
    metadata: Map<string, string>;
}

interface BeancountPosting {
    account: string;
    amount: string;
    originalAmount: string;
    commodity: string;
    totalCost: string;
    totalCostCommodity: string;
    price: string;
    priceCommodity: string;
    metadata: Map<string, string>;
}

interface BeancountData {
    accounts: Map<string, BeancountAccount>;
    transactions: BeancountTransactionEntry[];
}

function isOpeningBalanceEquityAccount(account: BeancountAccount): boolean {
    if (account.accountType !== BeancountAccountType.Equity) {
        return false;
    }

    const nameItems = account.name.split(beancountMetadataKeySuffix);

    if (nameItems.length !== 2) {
        return false;
    }

    return nameItems[1] === beancountEquityAccountNameOpeningBalance;
}

function isAssetsOrLiabilities(account: BeancountAccount): boolean {
    return account.accountType === BeancountAccountType.Assets || account.accountType === BeancountAccountType.Liabilities;
}

function isEquityOrIncome(account: BeancountAccount): boolean {
    return account.accountType === BeancountAccountType.Equity || account.accountType === BeancountAccountType.Income;
}

// ---------------------------------------------------------------------------
// amount expression evaluator (big.Rat emulation)

interface Rat {
    num: bigint;
    den: bigint;
}

function bigAbs(v: bigint): bigint {
    return v < 0n ? -v : v;
}

function bigGcd(a: bigint, b: bigint): bigint {
    a = bigAbs(a);
    b = bigAbs(b);

    while (b !== 0n) {
        [a, b] = [b, a % b];
    }

    return a;
}

function newRat(num: bigint, den: bigint): Rat {
    if (den < 0n) {
        num = -num;
        den = -den;
    }

    const g = bigGcd(num, den);
    return g > 1n ? { num: num / g, den: den / g } : { num, den };
}

function ratCmp(a: Rat, b: Rat): number {
    const l = a.num * b.den;
    const r = b.num * a.den;
    return l < r ? -1 : (l > r ? 1 : 0);
}

const minAllowedAmount = newRat(BigInt(MinimumTransactionAmount), 100n);
const maxAllowedAmount = newRat(BigInt(MaximumTransactionAmount), 100n);

const operatorPriority: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

// tokens only contain digits, '.' and a leading '-', so big.Rat.SetString only accepts plain decimal numbers
const decimalNumberRegex = /^(-?)(?:(\d+)\.?(\d*)|\.(\d+))$/;

function parseNumber(textualNumber: string): Rat {
    const match = decimalNumberRegex.exec(textualNumber);

    if (!match) {
        throw errs.ErrAmountInvalid;
    }

    const intPart = match[2] ?? '';
    const fracPart = match[3] ?? match[4] ?? '';
    let num = BigInt((intPart || '0') + fracPart);

    if (match[1] === '-') {
        num = -num;
    }

    const result = newRat(num, 10n ** BigInt(fracPart.length));

    if (ratCmp(result, minAllowedAmount) < 0 || ratCmp(result, maxAllowedAmount) > 0) {
        throw errs.ErrNumericOverflow;
    }

    return result;
}

function numberToTextualAmount(num: Rat): string {
    if (ratCmp(num, minAllowedAmount) < 0 || ratCmp(num, maxAllowedAmount) > 0) {
        throw errs.ErrNumericOverflow;
    }

    const amount = newRat(num.num * 100n, num.den);
    return formatAmount(BigInt.asIntN(64, amount.num / amount.den));
}

function isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
}

function toPostfixExprTokens(ctx: Context, expr: string): string[] {
    const finalTokens: string[] = [];
    const operatorStack: string[] = [];
    let currentNumber = '';
    let isLastTokenOperator = true;

    expr = expr.replaceAll(' ', '');

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i] as string;

        if (isDigit(ch) || ch === '.') {
            currentNumber += ch;
            continue;
        } else if (ch === '-' && i + 1 < expr.length && isDigit(expr[i + 1]) && currentNumber.length === 0 && isLastTokenOperator) {
            currentNumber += ch;
            continue;
        }

        if (currentNumber.length > 0) {
            finalTokens.push(currentNumber);
            currentNumber = '';
            isLastTokenOperator = false;
        }

        switch (ch) {
            case '+':
            case '-':
            case '*':
            case '/':
                if (ch === '-' && isLastTokenOperator) {
                    currentNumber += ch;
                    continue;
                }

                while (operatorStack.length > 0) {
                    const topOperator = operatorStack[operatorStack.length - 1] as string;

                    if (topOperator === '(') {
                        break;
                    }

                    if ((operatorPriority[topOperator] ?? 0) >= (operatorPriority[ch] ?? 0)) {
                        finalTokens.push(topOperator);
                        operatorStack.pop();
                    } else {
                        break;
                    }
                }

                operatorStack.push(ch);
                isLastTokenOperator = true;
                break;
            case '(':
                operatorStack.push(ch);
                isLastTokenOperator = true;
                break;
            case ')': {
                let hasLeftParenthesis = false;

                while (operatorStack.length > 0) {
                    const topOperator = operatorStack.pop() as string;

                    if (topOperator === '(') {
                        hasLeftParenthesis = true;
                        break;
                    }

                    finalTokens.push(topOperator);
                }

                if (!hasLeftParenthesis) {
                    log.warnf(ctx, `[beancount_amount_expression_evaluator.toPostfixExprTokens] cannot parse expression "${expr}", because missing left parenthesis`);
                    throw errs.ErrInvalidAmountExpression;
                }

                isLastTokenOperator = false;
                break;
            }
            default:
                log.warnf(ctx, `[beancount_amount_expression_evaluator.toPostfixExprTokens] cannot parse expression "${expr}", because containing unknown token "${ch}"`);
                throw errs.ErrInvalidAmountExpression;
        }
    }

    if (currentNumber.length > 0) {
        finalTokens.push(currentNumber);
    }

    while (operatorStack.length > 0) {
        const topOperator = operatorStack.pop() as string;

        if (topOperator === '(') {
            log.warnf(ctx, `[beancount_amount_expression_evaluator.toPostfixExprTokens] cannot parse expression "${expr}", because missing right parenthesis`);
            throw errs.ErrInvalidAmountExpression;
        }

        finalTokens.push(topOperator);
    }

    return finalTokens;
}

function evaluatePostfixExpr(ctx: Context, tokens: string[]): Rat {
    const stack: Rat[] = [];

    for (const token of tokens) {
        switch (token) {
            case '+':
            case '-':
            case '*':
            case '/': {
                if (stack.length < 2) {
                    log.warnf(ctx, `[beancount_amount_expression_evaluator.evaluatePostfixExpr] cannot evaluate expression "${tokens.join(' ')}", because not enough operands`);
                    throw errs.ErrInvalidAmountExpression;
                }

                const b = stack.pop() as Rat;
                const a = stack.pop() as Rat;
                let result: Rat;

                switch (token) {
                    case '+':
                        result = newRat(a.num * b.den + b.num * a.den, a.den * b.den);
                        break;
                    case '-':
                        result = newRat(a.num * b.den - b.num * a.den, a.den * b.den);
                        break;
                    case '*':
                        result = newRat(a.num * b.num, a.den * b.den);
                        break;
                    default:
                        if (b.num === 0n) {
                            log.warnf(ctx, `[beancount_amount_expression_evaluator.evaluatePostfixExpr] cannot evaluate expression "${tokens.join(' ')}", because division by zero`);
                            throw errs.ErrInvalidAmountExpression;
                        }

                        result = newRat(a.num * b.den, a.den * b.num);
                        break;
                }

                stack.push(result);
                break;
            }
            default: {
                let num: Rat;

                try {
                    num = parseNumber(token);
                } catch (err) {
                    if (err === errs.ErrNumericOverflow) {
                        log.warnf(ctx, `[beancount_amount_expression_evaluator.evaluatePostfixExpr] cannot evaluate expression "${tokens.join(' ')}", because numeric overflow`);
                        throw err;
                    }

                    log.warnf(ctx, `[beancount_amount_expression_evaluator.evaluatePostfixExpr] cannot evaluate expression "${tokens.join(' ')}", because containing invalid number`);
                    throw errs.ErrInvalidAmountExpression;
                }

                stack.push(num);
            }
        }
    }

    if (stack.length !== 1) {
        log.warnf(ctx, `[beancount_amount_expression_evaluator.evaluatePostfixExpr] cannot evaluate expression "${tokens.join(' ')}", because missing operator`);
        throw errs.ErrInvalidAmountExpression;
    }

    return stack[0] as Rat;
}

export function evaluateBeancountAmountExpression(ctx: Context, expr: string): string {
    if (expr === '') {
        return '';
    }

    return numberToTextualAmount(evaluatePostfixExpr(ctx, toPostfixExprTokens(ctx, expr)));
}

// ---------------------------------------------------------------------------
// reader

const beancountOptionAccountTypeNames: Record<string, BeancountAccountType> = {
    name_assets: BeancountAccountType.Assets,
    name_liabilities: BeancountAccountType.Liabilities,
    name_equity: BeancountAccountType.Equity,
    name_income: BeancountAccountType.Income,
    name_expenses: BeancountAccountType.Expenses,
};

const beancountCommentPrefix = ';';
const beancountAccountNameItemsSeparator = ':';
const beancountMetadataKeySuffix = ':';
const beancountPricePrefix = '@';
const beancountLinkPrefix = '^';
const beancountTagPrefix = '#';

const skippedDirectives = new Set(['commodity', 'price', 'note', 'document', 'event', 'balance', 'pad', 'query', 'custom']);
const transactionDirectives = new Set(['txn', '*', '!', 'P']);

// goToUpper emulates strings.ToUpper, which only uses simple (1:1) case mappings
function goToUpper(s: string): string {
    let result = '';

    for (const ch of s) {
        const upper = ch.toUpperCase();
        result += [...upper].length === 1 ? upper : ch;
    }

    return result;
}

function getNotEmptyItemAndIndexByIndex(items: string[], index: number): [string, number] {
    let count = -1;

    for (let i = 0; i < items.length; i++) {
        if ((items[i] as string).length === 0) {
            continue;
        }

        count++;

        if (count === index) {
            return [items[i] as string, i];
        }
    }

    return ['', -1];
}

function getNotEmptyItemByIndex(items: string[], index: number): string {
    return getNotEmptyItemAndIndexByIndex(items, index)[0];
}

function getNotEmptyItemAndIndexFromIndex(items: string[], startIndex: number): [string, number] {
    for (let i = startIndex; i < items.length; i++) {
        if ((items[i] as string).length > 0) {
            return [items[i] as string, i];
        }
    }

    return ['', -1];
}

function getNotEmptyItemsCount(items: string[]): number {
    return items.filter(item => item.length > 0).length;
}

function getOriginalAmountAndLastIndexFromIndex(items: string[], startIndex: number): [string, number] {
    const parts: string[] = [];
    let lastIndex = -1;

    for (let i = startIndex; i < items.length; i++) {
        const item = items[i] as string;

        if (item.length === 0) {
            continue;
        }

        // The Amount in "Postings" can also be an arithmetic expression using ( ) * / - +
        if (!/^[0-9.()*/\-+]*$/.test(item)) {
            break;
        }

        parts.push(item);
        lastIndex = i;
    }

    return [parts.join(' '), lastIndex];
}

class BeancountDataReader {
    private readonly accountTypeNameMap = new Map<string, BeancountAccountType>([
        ['Assets', BeancountAccountType.Assets],
        ['Liabilities', BeancountAccountType.Liabilities],
        ['Equity', BeancountAccountType.Equity],
        ['Income', BeancountAccountType.Income],
        ['Expenses', BeancountAccountType.Expenses],
    ]);

    private readonly accountTypeNameReversedMap = new Map<BeancountAccountType, string>([
        [BeancountAccountType.Assets, 'Assets'],
        [BeancountAccountType.Liabilities, 'Liabilities'],
        [BeancountAccountType.Equity, 'Equity'],
        [BeancountAccountType.Income, 'Income'],
        [BeancountAccountType.Expenses, 'Expenses'],
    ]);

    public constructor(private readonly allData: string[][]) {
    }

    // read returns the imported Beancount data
    // Reference: https://beancount.github.io/docs/beancount_language_syntax.html
    public read(ctx: Context): BeancountData {
        if (this.allData.length < 1) {
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        const data: BeancountData = {
            accounts: new Map(),
            transactions: [],
        };

        let currentTransactionEntry: BeancountTransactionEntry | null = null;
        let currentTransactionPosting: BeancountPosting | null = null;
        let currentTags: string[] = [];

        const updateCurrentState = (): void => {
            if (currentTransactionEntry !== null) {
                if (currentTransactionPosting !== null) {
                    currentTransactionEntry.postings.push(currentTransactionPosting);
                }

                data.transactions.push(currentTransactionEntry);
                currentTransactionEntry = null;
                currentTransactionPosting = null;
            }
        };

        for (let i = 0; i < this.allData.length; i++) {
            const items = this.allData[i] as string[];
            const firstNotEmptyItem = getNotEmptyItemByIndex(items, 0);

            if (items.length === 0 || (items.length === 1 && (items[0] as string).length === 0) || (firstNotEmptyItem.length > 0 && firstNotEmptyItem[0] === beancountCommentPrefix)) { // skip empty or comment lines
                continue;
            }

            if (getNotEmptyItemsCount(items) < 2) {
                log.warnf(ctx, `[beancount_data_reader.read] cannot parse line#${i} "${items.join(' ')}", because not enough items in line`);
                continue;
            }

            const firstItem = items[0] as string;

            if (firstItem === 'include') { // not support include directive
                throw errs.ErrBeancountFileNotSupportInclude;
            } else if (firstItem === 'plugin') { // skip plugin directive lines
                updateCurrentState();
                continue;
            } else if (firstItem === 'option') {
                updateCurrentState();
                this.readAndSetOption(ctx, i, items);
                continue;
            } else if (firstItem === 'pushtag') {
                updateCurrentState();
                currentTags = this.readAndSetTags(ctx, i, items, currentTags, true);
                continue;
            } else if (firstItem === 'poptag') {
                updateCurrentState();
                currentTags = this.readAndSetTags(ctx, i, items, currentTags, false);
                continue;
            }

            if (firstItem.length === 0) { // original line has space prefix, maybe transaction posting or metadata line
                const actualFirstItem = firstNotEmptyItem;

                if (actualFirstItem.length === 0) { // skip empty lines
                    continue;
                }

                const firstChar = actualFirstItem[0] as string;

                if (('A' <= firstChar && firstChar <= 'Z') || firstChar === '!') { // transaction posting
                    if (currentTransactionEntry !== null && currentTransactionPosting !== null) {
                        (currentTransactionEntry as BeancountTransactionEntry).postings.push(currentTransactionPosting);
                        currentTransactionPosting = null;
                    }

                    currentTransactionPosting = this.readTransactionPostingLine(ctx, i, items, data, firstChar === '!');
                } else if ('a' <= firstChar && firstChar <= 'z') { // metadata
                    const metadata = this.readTransactionMetadataLine(ctx, i, items);

                    if (metadata === null) {
                        continue;
                    }

                    const [metadataKey, metadataValue] = metadata;
                    const target: { metadata: Map<string, string> } | null = currentTransactionPosting ?? currentTransactionEntry;

                    if (target !== null && !target.metadata.has(metadataKey)) {
                        target.metadata.set(metadataKey, metadataValue);
                    }
                } else {
                    log.warnf(ctx, `[beancount_data_reader.read] cannot parse line#${i} "${items.join(' ')}", because line prefix is invalid`);
                    updateCurrentState();
                    continue;
                }
            } else if (isValidLongDate(firstItem)) { // original line has date as first item
                updateCurrentState();

                const directive = getNotEmptyItemByIndex(items, 1);

                if (directive === 'open' || directive === 'close') {
                    this.readAccountLine(ctx, i, items, firstItem, directive, data);
                } else if (transactionDirectives.has(directive)) {
                    currentTransactionEntry = this.readTransactionLine(items, firstItem, directive, currentTags);
                } else if (skippedDirectives.has(directive)) { // skip commodity / price / note / document / event / balance / pad / query / custom lines
                    continue;
                } else {
                    log.warnf(ctx, `[beancount_data_reader.read] cannot parse line#${i} "${items.join(' ')}", because directive is unknown`);
                    continue;
                }
            } else { // first item not start with date or space
                updateCurrentState();
                continue;
            }
        }

        updateCurrentState();

        return data;
    }

    private readAndSetOption(ctx: Context, lineIndex: number, items: string[]): void {
        if (getNotEmptyItemsCount(items) !== 3) {
            log.warnf(ctx, `[beancount_data_reader.readAndSetOption] cannot parse account type name option line#${lineIndex} "${items.join(' ')}", because items count in line not correct`);
            return;
        }

        const optionName = getNotEmptyItemByIndex(items, 1);
        const optionValue = getNotEmptyItemByIndex(items, 2);

        if (Object.hasOwn(beancountOptionAccountTypeNames, optionName)) {
            const accountType = beancountOptionAccountTypeNames[optionName] as BeancountAccountType;
            this.accountTypeNameMap.delete(this.accountTypeNameReversedMap.get(accountType) ?? '');
            this.accountTypeNameMap.set(optionValue, accountType);
            this.accountTypeNameReversedMap.set(accountType, optionValue);
        } else {
            log.warnf(ctx, `[beancount_data_reader.readAndSetOption] skip option line#${lineIndex} "${items.join(' ')}"`);
        }
    }

    private readAndSetTags(ctx: Context, lineIndex: number, items: string[], currentTags: string[], pushTag: boolean): string[] {
        if (getNotEmptyItemsCount(items) !== 2) {
            log.warnf(ctx, `[beancount_data_reader.readAndSetTags] cannot parse push/pop tag line#${lineIndex} "${items.join(' ')}", because items count in line not correct`);
            return currentTags;
        }

        let tag = getNotEmptyItemByIndex(items, 1);

        if (tag.length < 2 || tag[0] !== beancountTagPrefix) {
            log.warnf(ctx, `[beancount_data_reader.readAndSetTags] cannot parse push/pop tag line#${lineIndex} "${items.join(' ')}", because tag is invalid`);
            return currentTags;
        }

        tag = tag.substring(1);

        if (pushTag) {
            return currentTags.includes(tag) ? currentTags : [...currentTags, tag];
        }

        const index = currentTags.indexOf(tag);
        return index >= 0 ? [...currentTags.slice(0, index), ...currentTags.slice(index + 1)] : currentTags;
    }

    private readAccountLine(ctx: Context, lineIndex: number, items: string[], date: string, directive: string, data: BeancountData): void {
        if (getNotEmptyItemsCount(items) < 3) {
            log.warnf(ctx, `[beancount_data_reader.parseAccount] cannot parse account line#${lineIndex} "${items.join(' ')}", because items count in line not correct`);
            return;
        }

        const accountName = getNotEmptyItemByIndex(items, 2);
        const account = data.accounts.get(accountName) ?? this.createAccount(ctx, data, accountName);

        if (directive === 'open') {
            account.openDate = date;
        } else {
            account.closeDate = date;
        }
    }

    private createAccount(ctx: Context, data: BeancountData, accountName: string): BeancountAccount {
        const account: BeancountAccount = {
            name: accountName,
            accountType: BeancountAccountType.Unknown,
            openDate: '',
            closeDate: '',
        };

        const accountNameItems = accountName.split(beancountAccountNameItemsSeparator);

        if (accountNameItems.length > 1) {
            const accountType = this.accountTypeNameMap.get(accountNameItems[0] as string);

            if (accountType !== undefined) {
                account.accountType = accountType;
            } else {
                log.warnf(ctx, `[beancount_data_reader.createAccount] cannot parse account "${accountName}", because account type "${accountNameItems[0]}" is invalid`);
                throw errs.ErrInvalidBeancountFile;
            }
        }

        data.accounts.set(accountName, account);
        return account;
    }

    private readTransactionLine(items: string[], date: string, directive: string, tags: string[]): BeancountTransactionEntry {
        const transactionEntry: BeancountTransactionEntry = {
            date: date,
            directive: directive,
            payee: '',
            narration: '',
            postings: [],
            tags: [...tags],
            links: [],
            metadata: new Map(),
        };

        const allTags = new Set(transactionEntry.tags);

        // YYYY-MM-DD [txn|Flag] [[Payee] Narration] [#tag] [ˆlink]
        const payeeNarrationFirstIndex = 2;
        let payeeNarrationLastIndex = items.length - 1;

        for (let i = payeeNarrationFirstIndex; i < items.length; i++) {
            const item = items[i] as string;

            if (item.length === 0) {
                continue;
            }

            if (item[0] === beancountCommentPrefix) { // ; comment
                if (i - 1 < payeeNarrationLastIndex) {
                    payeeNarrationLastIndex = i - 1;
                }

                break;
            }

            if (item[0] === beancountTagPrefix) { // [#tag]
                const tagName = item.substring(1);

                if (!allTags.has(tagName)) {
                    transactionEntry.tags.push(tagName);
                    allTags.add(tagName);
                }

                if (i - 1 < payeeNarrationLastIndex) {
                    payeeNarrationLastIndex = i - 1;
                }
            } else if (item[0] === beancountLinkPrefix) { // [ˆlink]
                transactionEntry.links.push(item.substring(1));

                if (i - 1 < payeeNarrationLastIndex) {
                    payeeNarrationLastIndex = i - 1;
                }
            }
        }

        if (payeeNarrationLastIndex - payeeNarrationFirstIndex >= 1) {
            transactionEntry.payee = items[payeeNarrationFirstIndex] as string;
            transactionEntry.narration = items[payeeNarrationFirstIndex + 1] as string;
        } else if (payeeNarrationLastIndex - payeeNarrationFirstIndex >= 0) {
            transactionEntry.narration = items[payeeNarrationFirstIndex] as string;
        }

        return transactionEntry;
    }

    private readTransactionPostingLine(ctx: Context, lineIndex: number, items: string[], data: BeancountData, hasFlag: boolean): BeancountPosting | null {
        // [Flag] Account Amount [{Cost}] [@ Price]
        const accountNameExpectedIndex = hasFlag ? 1 : 0;

        if (getNotEmptyItemsCount(items) <= accountNameExpectedIndex) {
            log.warnf(ctx, `[beancount_data_reader.readTransactionPostingLine] cannot parse transaction posting line#${lineIndex} "${items.join(' ')}", because items count in line not correct`);
            return null;
        }

        const [accountName, accountNameActualIndex] = getNotEmptyItemAndIndexByIndex(items, accountNameExpectedIndex);

        if (accountName === '' || accountNameActualIndex < 0) {
            log.warnf(ctx, `[beancount_data_reader.readTransactionPostingLine] cannot parse transaction posting line#${lineIndex} "${items.join(' ')}", because missing account name`);
            throw errs.ErrMissingAccountData;
        }

        const posting: BeancountPosting = {
            account: accountName,
            amount: '',
            originalAmount: '',
            commodity: '',
            totalCost: '',
            totalCostCommodity: '',
            price: '',
            priceCommodity: '',
            metadata: new Map(),
        };

        const [originalAmount, amountActualLastIndex] = getOriginalAmountAndLastIndexFromIndex(items, accountNameActualIndex + 1);
        posting.originalAmount = originalAmount;

        if (posting.originalAmount === '' || amountActualLastIndex < 0) {
            log.warnf(ctx, `[beancount_data_reader.readTransactionPostingLine] cannot parse transaction posting line#${lineIndex} "${items.join(' ')}", because missing amount`);
            throw errs.ErrAmountInvalid;
        }

        try {
            posting.amount = evaluateBeancountAmountExpression(ctx, posting.originalAmount);
        } catch (err) {
            log.warnf(ctx, `[beancount_data_reader.readTransactionPostingLine] cannot evaluate amount expression in line#${lineIndex} "${items.join(' ')}", because ${(err as Error).message}`);
            throw err === errs.ErrNumericOverflow ? err : errs.ErrAmountInvalid;
        }

        const [commodity, commodityActualIndex] = getNotEmptyItemAndIndexFromIndex(items, amountActualLastIndex + 1);
        posting.commodity = commodity;

        if (posting.commodity === '' || commodityActualIndex < 0) {
            log.warnf(ctx, `[beancount_data_reader.readTransactionPostingLine] cannot parse transaction posting line#${lineIndex} "${items.join(' ')}", because missing commodity`);
            throw errs.ErrInvalidBeancountFile;
        }

        if (goToUpper(posting.commodity) !== posting.commodity) { // The syntax for a currency is a word all in capital letters
            log.warnf(ctx, `[beancount_data_reader.readTransactionPostingLine] cannot parse transaction posting line#${lineIndex} "${items.join(' ')}", because commodity name is not capital letters`);
            throw errs.ErrInvalidBeancountFile;
        }

        // parse remain items
        if (commodityActualIndex > 0) {
            for (let i = commodityActualIndex + 1; i < items.length; i++) {
                const item = items[i] as string;

                if (item.length === 0) {
                    continue;
                }

                if (item[0] === beancountCommentPrefix) { // ; comment
                    break;
                }

                if (item === beancountPricePrefix + beancountPricePrefix) { // [@@ TotalCost]
                    const [totalCost, totalCostActualIndex] = getNotEmptyItemAndIndexFromIndex(items, i + 1);

                    if (totalCostActualIndex > 0) {
                        posting.totalCost = totalCost;
                        i = totalCostActualIndex;

                        const [totalCostCommodity, totalCostCommodityActualIndex] = getNotEmptyItemAndIndexFromIndex(items, totalCostActualIndex + 1);

                        if (totalCostCommodityActualIndex > 0) {
                            posting.totalCostCommodity = totalCostCommodity;
                            i = totalCostCommodityActualIndex;
                        }
                    }
                } else if (item === beancountPricePrefix) { // [@ Price]
                    const [price, priceActualIndex] = getNotEmptyItemAndIndexFromIndex(items, i + 1);

                    if (priceActualIndex > 0) {
                        posting.price = price;
                        i = priceActualIndex;

                        const [priceCommodity, priceCommodityActualIndex] = getNotEmptyItemAndIndexFromIndex(items, priceActualIndex + 1);

                        if (priceCommodityActualIndex > 0) {
                            posting.priceCommodity = priceCommodity;
                            i = priceCommodityActualIndex;
                        }
                    }
                }
            }
        }

        if (posting.account !== '' && !data.accounts.has(posting.account)) {
            this.createAccount(ctx, data, posting.account);
        }

        return posting;
    }

    private readTransactionMetadataLine(ctx: Context, lineIndex: number, items: string[]): [string, string] | null {
        let key = getNotEmptyItemByIndex(items, 0);
        const value = getNotEmptyItemByIndex(items, 1);

        if (key === '' || value === '') {
            log.warnf(ctx, `[beancount_data_reader.readTransactionMetadataLine] cannot parse metadata line#${lineIndex} "${items.join(' ')}", because key or value is empty`);
            return null;
        }

        if (key[key.length - 1] !== beancountMetadataKeySuffix) {
            log.warnf(ctx, `[beancount_data_reader.readTransactionMetadataLine] cannot parse metadata line#${lineIndex} "${items.join(' ')}", because key is invalid correct`);
            return null;
        }

        key = key.substring(0, key.length - 1);
        return [key, value];
    }
}

function isValidLongDate(value: string): boolean {
    try {
        parseFromLongDateFirstTime(value, 0);
        return true;
    } catch {
        return false;
    }
}

function createNewBeancountDataReader(ctx: Context, data: Buffer): BeancountDataReader {
    let allData: string[][];

    try {
        allData = readAllGoCsv(decodeWithBOMOverride(data), { comma: ' ' });
    } catch (err) {
        log.errorf(ctx, `[beancount_data_reader.createNewBeancountDataReader] cannot parse data, because ${(err as Error).message}`);
        throw errs.ErrInvalidBeancountFile;
    }

    return new BeancountDataReader(allData);
}

// ---------------------------------------------------------------------------
// transaction data table

const beancountTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

export const BEANCOUNT_TRANSACTION_TAG_SEPARATOR = '#';

function parseBeancountTransaction(ctx: Context, accountMap: Map<string, BeancountAccount>, entry: BeancountTransactionEntry): RowData {
    const prefix = 'beancount_transaction_data_table.parseTransaction';
    const data: RowData = new Map();

    if (entry.date === '') {
        throw errs.ErrMissingTransactionTime;
    }

    // Beancount supports the international ISO 8601 standard format for dates, with dashes or the same ordering with slashes
    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, entry.date.replaceAll('/', '-') + ' 00:00:00');

    if (entry.postings.length === 2) {
        const splitData1 = entry.postings[0] as BeancountPosting;
        const splitData2 = entry.postings[1] as BeancountPosting;
        const account1 = accountMap.get(splitData1.account);
        const account2 = accountMap.get(splitData2.account);

        if (!account1 || !account2) {
            throw errs.ErrMissingAccountData;
        }

        const parsePostingAmount = (amount: string): number => {
            try {
                return parseAmount(amount);
            } catch (err) {
                log.errorf(ctx, `[${prefix}] cannot parse amount "${amount}", because ${(err as Error).message}`);
                throw errs.ErrAmountInvalid;
            }
        };

        const amount1 = parsePostingAmount(splitData1.amount);
        const amount2 = parsePostingAmount(splitData2.amount);

        if ((isEquityOrIncome(account1) && isAssetsOrLiabilities(account2)) || (isEquityOrIncome(account2) && isAssetsOrLiabilities(account1))) { // income
            let fromAccount = account1;
            let toAccount = account2;
            let toCurrency = splitData2.commodity;
            let toAmount = amount2;

            if (isEquityOrIncome(account2) && isAssetsOrLiabilities(account1)) {
                fromAccount = account2;
                toAccount = account1;
                toCurrency = splitData1.commodity;
                toAmount = amount1;
            }

            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(isOpeningBalanceEquityAccount(fromAccount) ? TRANSACTION_TYPE_MODIFY_BALANCE : TRANSACTION_TYPE_INCOME));
            data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, fromAccount.name);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, toAccount.name);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, toCurrency);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(toAmount));
        } else if ((account1.accountType === BeancountAccountType.Expenses && isAssetsOrLiabilities(account2)) || (account2.accountType === BeancountAccountType.Expenses && isAssetsOrLiabilities(account1))) { // expense
            let fromAccount = account1;
            let fromCurrency = splitData1.commodity;
            let fromAmount = amount1;
            let toAccount = account2;

            if (account1.accountType === BeancountAccountType.Expenses && isAssetsOrLiabilities(account2)) {
                fromAccount = account2;
                fromCurrency = splitData2.commodity;
                fromAmount = amount2;
                toAccount = account1;
            }

            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_EXPENSE));
            data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, toAccount.name);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, fromAccount.name);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, fromCurrency);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-fromAmount));
        } else if (isAssetsOrLiabilities(account1) && isAssetsOrLiabilities(account2)) {
            let fromAccount: BeancountAccount;
            let toAccount: BeancountAccount;
            let fromAmount: number;
            let toAmount: number;
            let fromCurrency: string;
            let toCurrency: string;

            if (amount1 < 0) {
                fromAccount = account1;
                fromCurrency = splitData1.commodity;
                fromAmount = -amount1;
                toAccount = account2;
                toCurrency = splitData2.commodity;
                toAmount = amount2;
            } else if (amount2 < 0) {
                fromAccount = account2;
                fromCurrency = splitData2.commodity;
                fromAmount = -amount2;
                toAccount = account1;
                toCurrency = splitData1.commodity;
                toAmount = amount1;
            } else {
                log.errorf(ctx, `[${prefix}] cannot parse transfer transaction, because unexcepted account amounts "${amount1}" and "${amount2}"`);
                throw errs.ErrInvalidBeancountFile;
            }

            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_TRANSFER));
            data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, '');
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, fromAccount.name);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, fromCurrency);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(fromAmount));
            data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, toAccount.name);
            data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, toCurrency);
            data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, formatAmount(toAmount));
        } else {
            log.errorf(ctx, `[${prefix}] cannot parse transaction, because unexcepted account types "${account1.accountType}" and "${account2.accountType}"`);
            throw errs.ErrThereAreNotSupportedTransactionType;
        }
    } else if (entry.postings.length <= 1) {
        log.errorf(ctx, `[${prefix}] cannot parse transaction, because postings count is ${entry.postings.length}`);
        throw errs.ErrInvalidBeancountFile;
    } else {
        log.errorf(ctx, `[${prefix}] cannot parse split transaction, because postings count is ${entry.postings.length}`);
        throw errs.ErrNotSupportedSplitTransactions;
    }

    // tags column is not in the supported columns, so it will not be returned (same as the original implementation)
    data.set(TRANSACTION_DATA_TABLE_TAGS, entry.tags.join(BEANCOUNT_TRANSACTION_TAG_SEPARATOR));
    data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, entry.narration);

    return data;
}

class BeancountTransactionDataTable implements TransactionDataTable {
    public constructor(private readonly allData: BeancountTransactionEntry[], private readonly accountMap: Map<string, BeancountAccount>) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return beancountTransactionSupportedColumns.has(column);
    }

    public transactionRowCount(): number {
        return this.allData.length;
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        let currentIndex = -1;

        return {
            hasNext: () => currentIndex + 1 < this.allData.length,
            next: async (ctx: Context): Promise<TransactionDataRow | null> => {
                if (currentIndex + 1 >= this.allData.length) {
                    return null;
                }

                currentIndex++;
                const rowItems = parseBeancountTransaction(ctx, this.accountMap, this.allData[currentIndex] as BeancountTransactionEntry);

                return {
                    isValid: () => true,
                    getData: (column: TransactionDataTableColumn) => (beancountTransactionSupportedColumns.has(column) ? rowItems.get(column) ?? '' : ''),
                };
            },
        };
    }
}

const beancountTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, String(TRANSACTION_TYPE_MODIFY_BALANCE)],
    [TRANSACTION_TYPE_INCOME, String(TRANSACTION_TYPE_INCOME)],
    [TRANSACTION_TYPE_EXPENSE, String(TRANSACTION_TYPE_EXPENSE)],
    [TRANSACTION_TYPE_TRANSFER, String(TRANSACTION_TYPE_TRANSFER)],
]);

export const BeancountTransactionDataImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const reader = createNewBeancountDataReader(ctx, data);
        const beancountData = reader.read(ctx);
        const transactionDataTable = new BeancountTransactionDataTable(beancountData.transactions, beancountData.accounts);
        const dataTableImporter = createNewImporterWithTypeNameMapping(beancountTransactionTypeNameMapping, '', '', BEANCOUNT_TRANSACTION_TAG_SEPARATOR);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
