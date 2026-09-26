export enum ErrorCategory {
    System = 1,
    Normal = 2,
}

// AppError represents the specific error returned to user
export class AppError extends Error {
    public readonly category: ErrorCategory;
    public readonly subCategory: number;
    public readonly index: number;
    public readonly httpStatusCode: number;
    public readonly baseError: unknown[];
    public readonly context: unknown;

    public constructor(category: ErrorCategory, subCategory: number, index: number, httpStatusCode: number, message: string, baseError: unknown[] = [], context?: unknown) {
        super(message);
        this.name = 'AppError';
        this.category = category;
        this.subCategory = subCategory;
        this.index = index;
        this.httpStatusCode = httpStatusCode;
        this.baseError = baseError;
        this.context = context;
    }

    // code returns the error code
    public get code(): number {
        return this.category * 100000 + this.subCategory * 1000 + this.index;
    }

    public withBaseError(...errors: unknown[]): AppError {
        return new AppError(this.category, this.subCategory, this.index, this.httpStatusCode, this.message, errors, this.context);
    }

    public withMessage(message: string): AppError {
        return new AppError(this.category, this.subCategory, this.index, this.httpStatusCode, message, this.baseError, this.context);
    }

    public is(other: unknown): boolean {
        return other instanceof AppError && other.code === this.code;
    }
}

export class MultiErrors extends Error {
    public readonly errors: unknown[];

    public constructor(errors: unknown[]) {
        super(MultiErrors.buildMessage(errors));
        this.errors = errors;
    }

    private static buildMessage(errors: unknown[]): string {
        if (errors.length === 1) {
            return errorMessage(errors[0]);
        }

        let ret = 'multi errors: ';
        let lastErrorChar = '';

        for (let i = 0; i < errors.length; i++) {
            if (i > 0) {
                ret += lastErrorChar === '.' ? ' ' : ', ';
            }

            const content = errorMessage(errors[i]);
            lastErrorChar = content[content.length - 1] ?? '';
            ret += content;
        }

        return ret;
    }
}

export function errorMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }

    return String(err);
}

export function newSystemError(subCategory: number, index: number, httpStatusCode: number, message: string): AppError {
    return new AppError(ErrorCategory.System, subCategory, index, httpStatusCode, message);
}

export function newNormalError(subCategory: number, index: number, httpStatusCode: number, message: string): AppError {
    return new AppError(ErrorCategory.Normal, subCategory, index, httpStatusCode, message);
}

// newErrorWithContext returns a new error instance with specified context
export function newErrorWithContext(baseError: AppError, context: unknown): AppError {
    return new AppError(baseError.category, baseError.subCategory, baseError.index, baseError.httpStatusCode, baseError.message, baseError.baseError, context);
}

// newMultiErrorOrNil returns a new multi error instance
export function newMultiErrorOrNil(...errors: unknown[]): unknown {
    if (errors.length < 1) {
        return null;
    } else if (errors.length === 1) {
        return errors[0];
    }

    return new MultiErrors(errors);
}

// or returns the error itself if it is defined in this project, otherwise returns the default error
export function or(err: unknown, defaultErr: AppError): AppError {
    return err instanceof AppError ? err : defaultErr;
}

// isCustomError returns whether this error is defined in this project
export function isCustomError(err: unknown): err is AppError {
    return err instanceof AppError;
}

export function getParameterInvalidMessage(field: string): string {
    return `parameter "${field}" is invalid`;
}

export function getParameterIsRequiredMessage(field: string): string {
    return `parameter "${field}" is required`;
}

export function getParameterMustLessThanMessage(field: string, param: string): string {
    return `parameter "${field}" must be less than ${param}`;
}

export function getParameterMustLessThanCharsMessage(field: string, param: string): string {
    return `parameter "${field}" must be less than ${param} characters`;
}

export function getParameterMustMoreThanMessage(field: string, param: string): string {
    return `parameter "${field}" must be more than ${param}`;
}

export function getParameterMustMoreThanCharsMessage(field: string, param: string): string {
    return `parameter "${field}" must be more than ${param} characters`;
}

export function getParameterLengthNotEqualMessage(field: string, param: string): string {
    return `parameter "${field}" length is not equal to ${param}`;
}

export function getParameterNotBeBlankMessage(field: string): string {
    return `parameter "${field}" cannot be blank`;
}

export function getParameterInvalidUsernameMessage(field: string): string {
    return `parameter "${field}" is invalid username format`;
}

export function getParameterInvalidEmailMessage(field: string): string {
    return `parameter "${field}" is invalid email format`;
}

export function getParameterInvalidCurrencyMessage(field: string): string {
    return `parameter "${field}" is invalid currency`;
}

export function getParameterInvalidHexRGBColorMessage(field: string): string {
    return `parameter "${field}" is invalid color`;
}

export function getParameterInvalidAmountFilterMessage(field: string): string {
    return `parameter "${field}" is invalid amount filter`;
}

export function getParameterInvalidTransactionAmountMessage(field: string): string {
    return `parameter "${field}" is invalid transaction amount`;
}

export function getParameterInvalidTagFilterMessage(field: string): string {
    return `parameter "${field}" is invalid tag filter`;
}
