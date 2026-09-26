// Request binding and validation which is compatible with gin binding and go-playground validator

import { getFiscalYearStartMonthDay } from '../core/fiscalyear';
import { AccountCurrencyNotSetValue } from '../core/types';
import * as errs from '../errs/index';
import { MaximumTransactionAmount, MinimumTransactionAmount, parseTransactionTagFilter, TransactionNoTagFilterValue } from '../models/transaction';
import { getFirstLowerCharString } from '../utils/strings';
import { isValidEmail, isValidHexRGBColor, isValidNickName, isValidUsername } from '../utils/validators';

// ---------- type specs ----------

export type IntKind = 'int8' | 'int16' | 'int32' | 'int64' | 'int' | 'uint8' | 'uint16' | 'uint32' | 'uint64';

export type TypeSpec =
    | { kind: 'string' }
    | { kind: 'bool' }
    | { kind: 'float' }
    | { kind: 'int'; intKind: IntKind }
    | { kind: 'int64str' } // int64 with json ",string" option, bound as bigint
    | { kind: 'array'; of: TypeSpec }
    | { kind: 'object'; schema: Schema }
    | { kind: 'any' }; // map[string]any

export interface FieldSpec {
    goName: string;
    key: string;
    type: TypeSpec;
    ptr: boolean;
    rules: string;
    defaultValue?: string;
    embedded?: Schema;
}

export interface Schema {
    fields: FieldSpec[];
}

interface FieldOptions {
    ptr?: boolean;
    defaultValue?: string;
}

function field(goName: string, key: string, type: TypeSpec, rules: string = '', options: FieldOptions = {}): FieldSpec {
    return { goName: goName, key: key, type: type, ptr: options.ptr ?? false, rules: rules, defaultValue: options.defaultValue };
}

// f is the dsl to define schemas, the first parameter is the go struct field name, and the second parameter is json / form key
export const f = {
    str: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'string' }, rules, options),
    bool: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'bool' }, rules, options),
    float: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'float' }, rules, options),
    int: (goName: string, key: string, intKind: IntKind, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'int', intKind: intKind }, rules, options),
    u8: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'int', intKind: 'uint8' }, rules, options),
    i16: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'int', intKind: 'int16' }, rules, options),
    i32: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'int', intKind: 'int32' }, rules, options),
    i64: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'int', intKind: 'int64' }, rules, options),
    i64s: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'int64str' }, rules, options),
    strArr: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'array', of: { kind: 'string' } }, rules, options),
    arr: (goName: string, key: string, of: TypeSpec, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'array', of: of }, rules, options),
    obj: (goName: string, key: string, schema: Schema, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'object', schema: schema }, rules, options),
    any: (goName: string, key: string, rules?: string, options?: FieldOptions): FieldSpec => field(goName, key, { kind: 'any' }, rules, options),
    embed: (schema: Schema): FieldSpec => ({ goName: '', key: '', type: { kind: 'object', schema: schema }, ptr: false, rules: '', embedded: schema }),
};

export function schema(...fields: FieldSpec[]): Schema {
    return { fields: fields };
}

export function objOf(s: Schema): TypeSpec {
    return { kind: 'object', schema: s };
}

// ---------- errors ----------

// JsonBindingError represents the error when decoding request body or query
export class BindingError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'BindingError';
    }
}

type ValueKind = 'int' | 'string' | 'slice' | 'map' | 'bool' | 'float' | 'struct' | 'other';

// FieldValidationError represents a validation error of a field (like validator.FieldError)
export class FieldValidationError {
    public readonly field: string;
    public readonly tag: string;
    public readonly param: string;
    public readonly kind: ValueKind;

    public constructor(field: string, tag: string, param: string, kind: ValueKind) {
        this.field = field;
        this.tag = tag;
        this.param = param;
        this.kind = kind;
    }

    public get namespaceMessage(): string {
        return `Key: '${this.field}' Error:Field validation for '${this.field}' failed on the '${this.tag}' tag`;
    }
}

// ValidationErrors represents validation errors (like validator.ValidationErrors)
export class ValidationErrors extends Error {
    public readonly errors: FieldValidationError[];

    public constructor(errors: FieldValidationError[]) {
        super(errors.map(e => e.namespaceMessage).join('\n'));
        this.name = 'ValidationErrors';
        this.errors = errors;
    }
}

// getValidationErrorText returns the display text of a validation error
export function getValidationErrorText(err: FieldValidationError): string {
    const fieldName = getFirstLowerCharString(err.field);

    switch (err.tag) {
        case 'required':
            return errs.getParameterIsRequiredMessage(fieldName);
        case 'max':
            if (err.kind === 'int') {
                return errs.getParameterMustLessThanMessage(fieldName, err.param);
            } else if (err.kind === 'string') {
                return errs.getParameterMustLessThanCharsMessage(fieldName, err.param);
            }

            break;
        case 'min':
            if (err.kind === 'int') {
                return errs.getParameterMustMoreThanMessage(fieldName, err.param);
            } else if (err.kind === 'string') {
                return errs.getParameterMustMoreThanCharsMessage(fieldName, err.param);
            }

            break;
        case 'len':
            return errs.getParameterLengthNotEqualMessage(fieldName, err.param);
        case 'notBlank':
            return errs.getParameterNotBeBlankMessage(fieldName);
        case 'validUsername':
            return errs.getParameterInvalidUsernameMessage(fieldName);
        case 'validEmail':
            return errs.getParameterInvalidEmailMessage(fieldName);
        case 'validCurrency':
            return errs.getParameterInvalidCurrencyMessage(fieldName);
        case 'validHexRGBColor':
            return errs.getParameterInvalidHexRGBColorMessage(fieldName);
        case 'validAmountFilter':
            return errs.getParameterInvalidAmountFilterMessage(fieldName);
        case 'validTransactionAmount':
            return errs.getParameterInvalidTransactionAmountMessage(fieldName);
        case 'validTagFilter':
            return errs.getParameterInvalidTagFilterMessage(fieldName);
    }

    return errs.getParameterInvalidMessage(fieldName);
}

// getDisplayErrorMessage returns the display error message of the error
export function getDisplayErrorMessage(err: errs.AppError): string {
    if (err.code === errs.ErrIncompleteOrIncorrectSubmission.code && err.baseError.length > 0) {
        const baseError = err.baseError[0];

        if (baseError instanceof ValidationErrors && baseError.errors.length > 0) {
            return getValidationErrorText(baseError.errors[0]!);
        }
    }

    return err.message;
}

// ---------- json decoding ----------

class JsonNumber {
    public readonly source: string;

    public constructor(source: string) {
        this.source = source;
    }
}

function parseJsonWithNumberSource(text: string): unknown {
    return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
        if (typeof value === 'number') {
            return new JsonNumber(context?.source ?? String(value));
        }

        return value;
    });
}

const intRanges: Record<IntKind, [bigint, bigint]> = {
    int8: [-(2n ** 7n), 2n ** 7n - 1n],
    int16: [-(2n ** 15n), 2n ** 15n - 1n],
    int32: [-(2n ** 31n), 2n ** 31n - 1n],
    int64: [-(2n ** 63n), 2n ** 63n - 1n],
    int: [-(2n ** 63n), 2n ** 63n - 1n],
    uint8: [0n, 2n ** 8n - 1n],
    uint16: [0n, 2n ** 16n - 1n],
    uint32: [0n, 2n ** 32n - 1n],
    uint64: [0n, 2n ** 64n - 1n],
};

function jsonTypeName(value: unknown): string {
    if (value === null) {
        return 'null';
    } else if (Array.isArray(value)) {
        return 'array';
    } else if (value instanceof JsonNumber) {
        return 'number';
    } else if (typeof value === 'object') {
        return 'object';
    }

    return typeof value;
}

function goTypeName(type: TypeSpec): string {
    switch (type.kind) {
        case 'string':
            return 'string';
        case 'bool':
            return 'bool';
        case 'float':
            return 'float64';
        case 'int':
            return type.intKind;
        case 'int64str':
            return 'int64';
        case 'array':
            return '[]' + goTypeName(type.of);
        case 'object':
            return 'struct';
        case 'any':
            return 'map[string]interface {}';
    }
}

function unmarshalTypeError(value: unknown, type: TypeSpec, key: string): BindingError {
    return new BindingError(`json: cannot unmarshal ${jsonTypeName(value)} into Go struct field .${key} of type ${goTypeName(type)}`);
}

function parseIntText(text: string, intKind: IntKind): bigint | null {
    if (!/^-?\d+$/.test(text)) {
        return null;
    }

    const value = BigInt(text);
    const [min, max] = intRanges[intKind];

    if (value < min || value > max) {
        return null;
    }

    return value;
}

function toPlainAny(value: unknown): unknown {
    if (value instanceof JsonNumber) {
        return Number(value.source);
    } else if (Array.isArray(value)) {
        return value.map(toPlainAny);
    } else if (value !== null && typeof value === 'object') {
        const ret: Record<string, unknown> = {};

        for (const [k, v] of Object.entries(value)) {
            ret[k] = toPlainAny(v);
        }

        return ret;
    }

    return value;
}

function zeroOf(type: TypeSpec, ptr: boolean): unknown {
    if (ptr) {
        return null;
    }

    switch (type.kind) {
        case 'string':
            return '';
        case 'bool':
            return false;
        case 'float':
            return 0;
        case 'int':
            return 0;
        case 'int64str':
            return 0n;
        case 'array':
            return null;
        case 'object':
            return emptyObject(type.schema);
        case 'any':
            return null;
    }
}

function emptyObject(s: Schema): Record<string, unknown> {
    const ret: Record<string, unknown> = {};

    for (const fieldSpec of s.fields) {
        if (fieldSpec.embedded) {
            Object.assign(ret, emptyObject(fieldSpec.embedded));
            continue;
        }

        ret[fieldSpec.key] = zeroOf(fieldSpec.type, fieldSpec.ptr);
    }

    return ret;
}

function decodeJsonValue(value: unknown, type: TypeSpec, key: string, stringOption: boolean): unknown {
    switch (type.kind) {
        case 'string':
            if (typeof value !== 'string') {
                throw unmarshalTypeError(value, type, key);
            }

            return value;
        case 'bool':
            if (typeof value !== 'boolean') {
                throw unmarshalTypeError(value, type, key);
            }

            return value;
        case 'float':
            if (!(value instanceof JsonNumber)) {
                throw unmarshalTypeError(value, type, key);
            }

            return Number(value.source);
        case 'int': {
            if (!(value instanceof JsonNumber)) {
                throw unmarshalTypeError(value, type, key);
            }

            const parsed = parseIntText(value.source, type.intKind);

            if (parsed === null) {
                throw new BindingError(`json: cannot unmarshal number ${value.source} into Go struct field .${key} of type ${type.intKind}`);
            }

            return Number(parsed);
        }
        case 'int64str': {
            if (!stringOption) {
                if (!(value instanceof JsonNumber)) {
                    throw unmarshalTypeError(value, type, key);
                }

                const parsed = parseIntText(value.source, 'int64');

                if (parsed === null) {
                    throw new BindingError(`json: cannot unmarshal number ${value.source} into Go struct field .${key} of type int64`);
                }

                return parsed;
            }

            if (typeof value !== 'string') {
                throw new BindingError(`json: invalid use of ,string struct tag, trying to unmarshal unquoted value into int64`);
            }

            const parsed = parseIntText(value, 'int64');

            if (parsed === null) {
                throw new BindingError(`json: invalid use of ,string struct tag, trying to unmarshal ${JSON.stringify(value)} into int64`);
            }

            return parsed;
        }
        case 'array': {
            if (!Array.isArray(value)) {
                throw unmarshalTypeError(value, type, key);
            }

            return value.map(item => (item === null ? zeroOf(type.of, false) : decodeJsonValue(item, type.of, key, false)));
        }
        case 'object': {
            if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) {
                throw unmarshalTypeError(value, type, key);
            }

            return decodeJsonObject(value as Record<string, unknown>, type.schema);
        }
        case 'any': {
            if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) {
                throw unmarshalTypeError(value, type, key);
            }

            return toPlainAny(value);
        }
    }
}

function findJsonKey(data: Record<string, unknown>, key: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
        return key;
    }

    const lowerKey = key.toLowerCase();
    let found: string | undefined;

    for (const k of Object.keys(data)) {
        if (k.toLowerCase() === lowerKey) {
            found = k;
        }
    }

    return found;
}

function decodeJsonObject(data: Record<string, unknown>, s: Schema): Record<string, unknown> {
    const ret: Record<string, unknown> = {};

    for (const fieldSpec of s.fields) {
        if (fieldSpec.embedded) {
            Object.assign(ret, decodeJsonObject(data, fieldSpec.embedded));
            continue;
        }

        const dataKey = findJsonKey(data, fieldSpec.key);
        const value = dataKey !== undefined ? data[dataKey] : undefined;

        if (value === undefined || value === null) {
            ret[fieldSpec.key] = zeroOf(fieldSpec.type, fieldSpec.ptr);
            continue;
        }

        ret[fieldSpec.key] = decodeJsonValue(value, fieldSpec.type, fieldSpec.key, fieldSpec.type.kind === 'int64str');
    }

    return ret;
}

// ---------- form (query string) decoding ----------

function parseGoBool(value: string): boolean | null {
    switch (value) {
        case '1': case 't': case 'T': case 'TRUE': case 'true': case 'True':
            return true;
        case '0': case 'f': case 'F': case 'FALSE': case 'false': case 'False':
            return false;
        default:
            return null;
    }
}

function decodeFormValue(value: string, type: TypeSpec, key: string): unknown {
    switch (type.kind) {
        case 'string':
            return value;
        case 'bool': {
            if (value === '') {
                return false;
            }

            const parsed = parseGoBool(value);

            if (parsed === null) {
                throw new BindingError(`strconv.ParseBool: parsing ${JSON.stringify(value)}: invalid syntax`);
            }

            return parsed;
        }
        case 'float': {
            if (value === '') {
                return 0;
            }

            const parsed = Number(value);

            if (Number.isNaN(parsed) || value.trim() !== value) {
                throw new BindingError(`strconv.ParseFloat: parsing ${JSON.stringify(value)}: invalid syntax`);
            }

            return parsed;
        }
        case 'int':
        case 'int64str': {
            const intKind: IntKind = type.kind === 'int' ? type.intKind : 'int64';

            if (value === '') {
                return type.kind === 'int' ? 0 : 0n;
            }

            if (!/^[+-]?\d+$/.test(value)) {
                throw new BindingError(`strconv.ParseInt: parsing ${JSON.stringify(value)}: invalid syntax`);
            }

            const parsed = parseIntText(value.replace(/^\+/, ''), intKind);

            if (parsed === null) {
                throw new BindingError(`strconv.ParseInt: parsing ${JSON.stringify(value)}: value out of range`);
            }

            return type.kind === 'int' ? Number(parsed) : parsed;
        }
        default:
            throw new BindingError(`unsupported form field type of ${key}`);
    }
}

function decodeFormObject(query: URLSearchParams, s: Schema): Record<string, unknown> {
    const ret: Record<string, unknown> = {};

    for (const fieldSpec of s.fields) {
        if (fieldSpec.embedded) {
            Object.assign(ret, decodeFormObject(query, fieldSpec.embedded));
            continue;
        }

        const prop = getFirstLowerCharString(fieldSpec.goName);

        if (fieldSpec.type.kind === 'array') {
            const values = query.getAll(fieldSpec.key);
            ret[prop] = values.length > 0 ? values.map(v => decodeFormValue(v, (fieldSpec.type as { of: TypeSpec }).of, fieldSpec.key)) : null;
            continue;
        }

        let value = query.has(fieldSpec.key) ? query.get(fieldSpec.key)! : undefined;

        if (value === undefined && fieldSpec.defaultValue !== undefined) {
            value = fieldSpec.defaultValue;
        }

        if (value === undefined) {
            ret[prop] = zeroOf(fieldSpec.type, fieldSpec.ptr);
            continue;
        }

        ret[prop] = decodeFormValue(value, fieldSpec.type, fieldSpec.key);
    }

    return ret;
}

// ---------- validation ----------

export const allCurrencyNames = new Set('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XOF XPF XSU YER ZAR ZMW ZWG ZWL'.split(' '));

export function isValidCurrency(value: string): boolean {
    return value === AccountCurrencyNotSetValue || allCurrencyNames.has(value);
}

function valueKind(type: TypeSpec): ValueKind {
    switch (type.kind) {
        case 'int':
        case 'int64str':
            return 'int';
        case 'string':
            return 'string';
        case 'array':
            return 'slice';
        case 'any':
            return 'map';
        case 'bool':
            return 'bool';
        case 'float':
            return 'float';
        case 'object':
            return 'struct';
    }
}

function isZero(value: unknown, type: TypeSpec): boolean {
    if (value === null || value === undefined) {
        return true;
    }

    switch (type.kind) {
        case 'string':
            return value === '';
        case 'bool':
            return value === false;
        case 'int':
        case 'float':
            return value === 0;
        case 'int64str':
            return value === 0n;
        default:
            return false;
    }
}

function lengthOf(value: unknown, type: TypeSpec): number {
    if (type.kind === 'string') {
        return Array.from(value as string).length;
    } else if (type.kind === 'array') {
        return (value as unknown[] | null)?.length ?? 0;
    } else if (type.kind === 'any') {
        return Object.keys((value as Record<string, unknown> | null) ?? {}).length;
    }

    return 0;
}

function compareNumber(value: unknown, param: string): number {
    const paramValue = Number(param);

    if (typeof value === 'bigint') {
        const bigParam = BigInt(Math.trunc(paramValue));
        return value < bigParam ? -1 : value > bigParam ? 1 : 0;
    }

    const num = value as number;
    return num < paramValue ? -1 : num > paramValue ? 1 : 0;
}

function checkTag(tag: string, param: string, value: unknown, type: TypeSpec): boolean {
    switch (tag) {
        case 'required':
            if (type.kind === 'array' || type.kind === 'any') {
                return value !== null && value !== undefined;
            }

            return !isZero(value, type);
        case 'min':
            if (type.kind === 'string' || type.kind === 'array' || type.kind === 'any') {
                return lengthOf(value, type) >= Number(param);
            }

            return compareNumber(value, param) >= 0;
        case 'max':
            if (type.kind === 'string' || type.kind === 'array' || type.kind === 'any') {
                return lengthOf(value, type) <= Number(param);
            }

            return compareNumber(value, param) <= 0;
        case 'len':
            if (type.kind === 'string' || type.kind === 'array' || type.kind === 'any') {
                return lengthOf(value, type) === Number(param);
            }

            return compareNumber(value, param) === 0;
        case 'notBlank':
            return typeof value === 'string' && value !== '' && value.replace(/^ +| +$/g, '') !== '';
        case 'validUsername':
            return typeof value === 'string' && isValidUsername(value);
        case 'validEmail':
            return typeof value === 'string' && isValidEmail(value);
        case 'validNickname':
            return typeof value === 'string' && isValidNickName(value);
        case 'validCurrency':
            return typeof value === 'string' && isValidCurrency(value);
        case 'validHexRGBColor':
            return typeof value === 'string' && isValidHexRGBColor(value);
        case 'validAmountFilter':
            return typeof value === 'string' && isValidAmountFilter(value);
        case 'validTransactionAmount':
            return isValidTransactionAmount(value);
        case 'validTagFilter':
            return typeof value === 'string' && isValidTagFilter(value);
        case 'validFiscalYearStart':
            try {
                getFiscalYearStartMonthDay(value as number);
                return true;
            } catch {
                return false;
            }
        default:
            return true;
    }
}

function isValidAmountFilter(value: string): boolean {
    if (value === '') {
        return true;
    }

    const amountFilterItems = value.split(':');

    if (amountFilterItems.length < 2) {
        return false;
    }

    const parseInt64 = (text: string): bigint | null => parseIntText(text, 'int64');
    const amount1 = parseInt64(amountFilterItems[1]!);

    if (amount1 === null) {
        return false;
    }

    const filterType = amountFilterItems[0];

    if (filterType === 'gt' || filterType === 'lt' || filterType === 'eq' || filterType === 'ne') {
        if (amountFilterItems.length !== 2) {
            return false;
        }
    } else if (filterType === 'bt' || filterType === 'nb') {
        if (amountFilterItems.length !== 3) {
            return false;
        }

        const amount2 = parseInt64(amountFilterItems[2]!);

        if (amount2 === null) {
            return false;
        }

        if (amount2 < amount1) {
            return false;
        }
    }

    return true;
}

function isValidTransactionAmount(value: unknown): boolean {
    if (typeof value === 'number') {
        return value >= MinimumTransactionAmount && value <= MaximumTransactionAmount;
    }

    if (typeof value === 'string') {
        if (value === '') {
            return true;
        }

        const amount = parseIntText(value, 'int64');

        if (amount === null) {
            return false;
        }

        return amount >= BigInt(MinimumTransactionAmount) && amount <= BigInt(MaximumTransactionAmount);
    }

    return false;
}

function isValidTagFilter(value: string): boolean {
    if (value === '' || value === TransactionNoTagFilterValue) {
        return true;
    }

    try {
        parseTransactionTagFilter(value);
        return true;
    } catch {
        return false;
    }
}

function splitRules(rules: string): string[] {
    return rules === '' ? [] : rules.split(',');
}

function validateObject(obj: Record<string, unknown>, s: Schema, errors: FieldValidationError[], propOf: (fieldSpec: FieldSpec) => string): void {
    for (const fieldSpec of s.fields) {
        if (fieldSpec.embedded) {
            validateObject(obj, fieldSpec.embedded, errors, propOf);
            continue;
        }

        const value = obj[propOf(fieldSpec)];
        const rules = splitRules(fieldSpec.rules);
        const kind = valueKind(fieldSpec.type);
        let fieldFailed = false;

        for (const rule of rules) {
            if (rule === 'omitempty') {
                if (fieldSpec.ptr ? (value === null || value === undefined) : isZero(value, fieldSpec.type)) {
                    break;
                }

                continue;
            }

            if (rule === 'required' && fieldSpec.ptr) {
                if (value === null || value === undefined) {
                    errors.push(new FieldValidationError(fieldSpec.goName, 'required', '', kind));
                    fieldFailed = true;
                    break;
                }

                continue;
            }

            if (fieldSpec.ptr && (value === null || value === undefined)) {
                continue;
            }

            const alternatives = rule.split('|');
            let passed = false;
            let failedTag = '';
            let failedParam = '';

            for (const alternative of alternatives) {
                const eqIndex = alternative.indexOf('=');
                const tag = eqIndex >= 0 ? alternative.substring(0, eqIndex) : alternative;
                const param = eqIndex >= 0 ? alternative.substring(eqIndex + 1) : '';

                if (checkTag(tag, param, value, fieldSpec.type)) {
                    passed = true;
                    break;
                }

                failedTag = failedTag === '' ? tag : `${failedTag}|${tag}`;
                failedParam = param;
            }

            if (!passed) {
                errors.push(new FieldValidationError(fieldSpec.goName, alternatives.length > 1 ? rule : failedTag, failedParam, kind));
                fieldFailed = true;
                break;
            }
        }

        // go-playground validator dives into nested struct automatically
        if (!fieldFailed && fieldSpec.type.kind === 'object' && value !== null && value !== undefined) {
            validateObject(value as Record<string, unknown>, fieldSpec.type.schema, errors, propOf);
        }
    }
}

// ---------- public api ----------

// bindJSON decodes the json text and validates it according to the schema, the result object uses json keys as property names
export function bindJSON<T>(body: string, s: Schema): T {
    if (body.trim() === '') {
        throw new BindingError('EOF');
    }

    let data: unknown;

    try {
        data = parseJsonWithNumberSource(body);
    } catch (err) {
        throw new BindingError((err as Error).message);
    }

    if (data === null) {
        return emptyObject(s) as T;
    }

    if (typeof data !== 'object' || Array.isArray(data) || data instanceof JsonNumber) {
        throw new BindingError(`json: cannot unmarshal ${jsonTypeName(data)} into Go value of type struct`);
    }

    const result = decodeJsonObject(data as Record<string, unknown>, s);
    const errors: FieldValidationError[] = [];
    validateObject(result, s, errors, fieldSpec => fieldSpec.key);

    if (errors.length > 0) {
        throw new ValidationErrors(errors);
    }

    return result as T;
}

// bindQuery decodes the query string and validates it according to the schema, the result object uses lower camel case go field names as property names
export function bindQuery<T>(query: URLSearchParams, s: Schema): T {
    const result = decodeFormObject(query, s);
    const errors: FieldValidationError[] = [];
    validateObject(result, s, errors, fieldSpec => getFirstLowerCharString(fieldSpec.goName));

    if (errors.length > 0) {
        throw new ValidationErrors(errors);
    }

    return result as T;
}

// validateStruct validates the object (which uses json keys as property names) according to the schema
export function validateJsonStruct(obj: Record<string, unknown>, s: Schema): void {
    const errors: FieldValidationError[] = [];
    validateObject(obj, s, errors, fieldSpec => fieldSpec.key);

    if (errors.length > 0) {
        throw new ValidationErrors(errors);
    }
}
