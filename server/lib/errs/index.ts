import { AppError } from './error';
import { ErrIncompleteOrIncorrectSubmission, ErrLoggingError } from './codes';

export * from './error';
export * from './codes';

// newLoggingError returns a new logging error instance
export function newLoggingError(message: string, ...err: unknown[]): AppError {
    return new AppError(ErrLoggingError.category, ErrLoggingError.subCategory, ErrLoggingError.index, ErrLoggingError.httpStatusCode, message, err);
}

// newIncompleteOrIncorrectSubmissionError returns a new incomplete or incorrect submission error instance
export function newIncompleteOrIncorrectSubmissionError(err: unknown): AppError {
    return ErrIncompleteOrIncorrectSubmission.withBaseError(err);
}
