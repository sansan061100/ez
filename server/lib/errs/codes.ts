// Generated from pkg/errs/*.go
import { newNormalError, newSystemError } from "./error.js";

export const SystemSubcategoryDefault = 0;
export const SystemSubcategorySetting = 1;
export const SystemSubcategoryDatabase = 2;
export const SystemSubcategoryMail = 3;
export const SystemSubcategoryLogging = 4;
export const SystemSubcategoryCron = 5;
export const NormalSubcategoryGlobal = 0;
export const NormalSubcategoryUser = 1;
export const NormalSubcategoryToken = 2;
export const NormalSubcategoryTwofactor = 3;
export const NormalSubcategoryAccount = 4;
export const NormalSubcategoryTransaction = 5;
export const NormalSubcategoryCategory = 6;
export const NormalSubcategoryTag = 7;
export const NormalSubcategoryDataManagement = 8;
export const NormalSubcategoryMapProxy = 9;
export const NormalSubcategoryTemplate = 10;
export const NormalSubcategoryPicture = 11;
export const NormalSubcategoryConverter = 12;
export const NormalSubcategoryUserCustomExchangeRate = 13;
export const NormalSubcategoryModelContextProtocol = 14;
export const NormalSubcategoryLargeLanguageModel = 15;
export const NormalSubcategoryUserExternalAuth = 16;
export const NormalSubcategoryOAuth2 = 17;
export const NormalSubcategoryInsightsExplorer = 18;
export const NormalSubcategoryTagGroup = 19;
export const NormalSubcategoryUserCustomIcon = 20;

// account.go
export const ErrAccountIdInvalid = newNormalError(NormalSubcategoryAccount, 0, 400, "account id is invalid");
export const ErrAccountNotFound = newNormalError(NormalSubcategoryAccount, 1, 400, "account not found");
export const ErrAccountTypeInvalid = newNormalError(NormalSubcategoryAccount, 2, 400, "account type is invalid");
export const ErrAccountCurrencyInvalid = newNormalError(NormalSubcategoryAccount, 3, 400, "account currency is invalid");
export const ErrAccountHaveNoSubAccount = newNormalError(NormalSubcategoryAccount, 4, 400, "account must have at least one sub-account");
export const ErrAccountCannotHaveSubAccounts = newNormalError(NormalSubcategoryAccount, 5, 400, "account cannot have sub-accounts");
export const ErrParentAccountCannotSetCurrency = newNormalError(NormalSubcategoryAccount, 6, 400, "parent account cannot set currency");
export const ErrParentAccountCannotSetBalance = newNormalError(NormalSubcategoryAccount, 7, 400, "parent account cannot set balance");
export const ErrSubAccountCategoryNotEqualsToParent = newNormalError(NormalSubcategoryAccount, 8, 400, "sub-account category not equals to parent");
export const ErrSubAccountTypeInvalid = newNormalError(NormalSubcategoryAccount, 9, 400, "sub-account type invalid");
export const ErrSourceAccountNotFound = newNormalError(NormalSubcategoryAccount, 11, 400, "source account not found");
export const ErrDestinationAccountNotFound = newNormalError(NormalSubcategoryAccount, 12, 400, "destination account not found");
export const ErrAccountInUseCannotBeDeleted = newNormalError(NormalSubcategoryAccount, 13, 400, "account is in use and cannot be deleted");
export const ErrAccountCategoryInvalid = newNormalError(NormalSubcategoryAccount, 14, 400, "account category is invalid");
export const ErrAccountBalanceTimeNotSet = newNormalError(NormalSubcategoryAccount, 15, 400, "account balance time is not set");
export const ErrCannotSetStatementDateForNonCreditCard = newNormalError(NormalSubcategoryAccount, 16, 400, "cannot set statement date for non credit card account");
export const ErrCannotSetStatementDateForSubAccount = newNormalError(NormalSubcategoryAccount, 17, 400, "cannot set statement date for sub account");
export const ErrSubAccountNotFound = newNormalError(NormalSubcategoryAccount, 18, 400, "sub-account not found");
export const ErrSubAccountInUseCannotBeDeleted = newNormalError(NormalSubcategoryAccount, 19, 400, "sub-account is in use and cannot be deleted");
export const ErrNotSupportedChangeCurrency = newNormalError(NormalSubcategoryAccount, 20, 400, "not supported to modify account currency");
export const ErrNotSupportedChangeBalance = newNormalError(NormalSubcategoryAccount, 21, 400, "not supported to modify account balance");
export const ErrNotSupportedChangeBalanceTime = newNormalError(NormalSubcategoryAccount, 22, 400, "not supported to modify account balance time");
export const ErrParentAccountCannotSetLastReconciledTime = newNormalError(NormalSubcategoryAccount, 23, 400, "parent account cannot set last reconciled time");
export const ErrCannotSetLastReconciledTimeBeforeCurrent = newNormalError(NormalSubcategoryAccount, 24, 400, "cannot set last reconciled time before current value");
export const ErrAccountBalanceOverflow = newNormalError(NormalSubcategoryAccount, 25, 400, "account balance overflow");
export const ErrAccountIconInvalid = newNormalError(NormalSubcategoryAccount, 26, 400, "account icon is invalid");
export const ErrCannotSetCreditLimitForNonCreditCardAccount = newNormalError(NormalSubcategoryAccount, 27, 400, "cannot set credit limit for non credit card account");
export const ErrCannotSetCreditLimitForSubAccount = newNormalError(NormalSubcategoryAccount, 28, 400, "cannot set credit limit for sub account");
export const ErrMustSetParentAccountCurrencyWhenSetCreditLimit = newNormalError(NormalSubcategoryAccount, 29, 400, "must set parent account currency when set credit limit");

// converter.go
export const ErrNotFoundTransactionDataInFile = newNormalError(NormalSubcategoryConverter, 0, 400, "not found transaction data");
export const ErrMissingRequiredFieldInHeaderRow = newNormalError(NormalSubcategoryConverter, 1, 400, "missing required field in header row");
export const ErrFewerFieldsInDataRowThanInHeaderRow = newNormalError(NormalSubcategoryConverter, 2, 400, "fewer fields in data row than in header row");
export const ErrFieldsInMultiTableAreDifferent = newNormalError(NormalSubcategoryConverter, 3, 400, "fields in multiple table headers are different");
export const ErrInvalidFileHeader = newNormalError(NormalSubcategoryConverter, 4, 400, "invalid file header");
export const ErrInvalidCSVFile = newNormalError(NormalSubcategoryConverter, 5, 400, "invalid csv file");
export const ErrRelatedIdCannotBeBlank = newNormalError(NormalSubcategoryConverter, 6, 400, "related id cannot be blank");
export const ErrFoundRecordNotHasRelatedRecord = newNormalError(NormalSubcategoryConverter, 7, 400, "found some transactions without related records");
export const ErrInvalidQIFFile = newNormalError(NormalSubcategoryConverter, 8, 400, "invalid qif file");
export const ErrMissingTransactionTime = newNormalError(NormalSubcategoryConverter, 9, 400, "missing transaction time field");
export const ErrInvalidGnuCashFile = newNormalError(NormalSubcategoryConverter, 10, 400, "invalid gnucash file");
export const ErrMissingAccountData = newNormalError(NormalSubcategoryConverter, 11, 400, "missing account data");
export const ErrNotSupportedSplitTransactions = newNormalError(NormalSubcategoryConverter, 12, 400, "not supported to import split transaction");
export const ErrThereAreNotSupportedTransactionType = newNormalError(NormalSubcategoryConverter, 13, 400, "there are not supported transaction type");
export const ErrInvalidIIFFile = newNormalError(NormalSubcategoryConverter, 14, 400, "invalid iif file");
export const ErrInvalidOFXFile = newNormalError(NormalSubcategoryConverter, 15, 400, "invalid ofx file");
export const ErrInvalidSGMLFile = newNormalError(NormalSubcategoryConverter, 16, 400, "invalid sgml file");
export const ErrInvalidBeancountFile = newNormalError(NormalSubcategoryConverter, 17, 400, "invalid beancount file");
export const ErrBeancountFileNotSupportInclude = newNormalError(NormalSubcategoryConverter, 18, 400, "not support include directive for beancount file");
export const ErrInvalidAmountExpression = newNormalError(NormalSubcategoryConverter, 19, 400, "invalid amount expression");
export const ErrInvalidXmlFile = newNormalError(NormalSubcategoryConverter, 20, 400, "invalid xml file");
export const ErrInvalidMT940File = newNormalError(NormalSubcategoryConverter, 21, 400, "invalid mt940 file");
export const ErrInvalidJSONFile = newNormalError(NormalSubcategoryConverter, 22, 400, "invalid json file");

// cron.go
export const ErrCronJobNameIsEmpty = newSystemError(SystemSubcategoryCron, 0, 500, "cron job name is empty");
export const ErrCronJobNotExistsOrNotEnabled = newSystemError(SystemSubcategoryCron, 1, 500, "cron job not exists or not enabled");

// data_managements.go
export const ErrDataExportNotAllowed = newNormalError(NormalSubcategoryDataManagement, 1, 400, "data export not allowed");
export const ErrDataImportNotAllowed = newNormalError(NormalSubcategoryDataManagement, 2, 400, "data import not allowed");
export const ErrImportTooManyTransaction = newNormalError(NormalSubcategoryDataManagement, 3, 400, "import too many transactions");

// database.go
export const ErrDatabaseTypeInvalid = newSystemError(SystemSubcategoryDatabase, 0, 500, "database type is invalid");
export const ErrDatabaseHostInvalid = newSystemError(SystemSubcategoryDatabase, 1, 500, "database host is invalid");
export const ErrDatabaseIsNull = newSystemError(SystemSubcategoryDatabase, 2, 500, "database cannot be null");
export const ErrDatabaseOperationFailed = newSystemError(SystemSubcategoryDatabase, 3, 500, "database operation failed");

// explorer.go
export const ErrInsightsExplorerIdInvalid = newNormalError(NormalSubcategoryInsightsExplorer, 0, 400, "exploration id is invalid");
export const ErrInsightsExplorerNotFound = newNormalError(NormalSubcategoryInsightsExplorer, 1, 400, "exploration not found");
export const ErrInsightsExplorerDataInvalid = newNormalError(NormalSubcategoryInsightsExplorer, 2, 400, "exploration data is invalid");

// external_auth.go
export const ErrUserExternalAuthNotFound = newNormalError(NormalSubcategoryUserExternalAuth, 0, 400, "user external auth is not found");
export const ErrUserExternalAuthAlreadyExists = newNormalError(NormalSubcategoryUserExternalAuth, 1, 400, "user external auth already exists");
export const ErrUserExternalAuthTypeInvalid = newNormalError(NormalSubcategoryUserExternalAuth, 2, 400, "user external auth type invalid");

// global.go
export const ErrIncompleteOrIncorrectSubmission = newNormalError(NormalSubcategoryGlobal, 0, 400, "incomplete or incorrect submission");
export const ErrOperationFailed = newNormalError(NormalSubcategoryGlobal, 1, 500, "operation failed");
export const ErrRequestIdInvalid = newNormalError(NormalSubcategoryGlobal, 2, 500, "request id is invalid");
export const ErrCiphertextInvalid = newNormalError(NormalSubcategoryGlobal, 3, 500, "ciphertext is invalid");
export const ErrNothingWillBeUpdated = newNormalError(NormalSubcategoryGlobal, 4, 400, "nothing will be updated");
export const ErrFailedToRequestRemoteApi = newNormalError(NormalSubcategoryGlobal, 5, 400, "failed to request third party api");
export const ErrPageIndexInvalid = newNormalError(NormalSubcategoryGlobal, 6, 400, "page index is invalid");
export const ErrPageCountInvalid = newNormalError(NormalSubcategoryGlobal, 7, 400, "page count is invalid");
export const ErrClientTimezoneOffsetInvalid = newNormalError(NormalSubcategoryGlobal, 8, 400, "client timezone offset is invalid");
export const ErrQueryItemsEmpty = newNormalError(NormalSubcategoryGlobal, 9, 400, "query items cannot be blank");
export const ErrQueryItemsTooMuch = newNormalError(NormalSubcategoryGlobal, 10, 400, "query items too much");
export const ErrQueryItemsInvalid = newNormalError(NormalSubcategoryGlobal, 11, 400, "query items have invalid item");
export const ErrParameterInvalid = newNormalError(NormalSubcategoryGlobal, 12, 400, "parameter invalid");
export const ErrFormatInvalid = newNormalError(NormalSubcategoryGlobal, 13, 400, "format invalid");
export const ErrNumberInvalid = newNormalError(NormalSubcategoryGlobal, 14, 400, "number invalid");
export const ErrNoFilesUpload = newNormalError(NormalSubcategoryGlobal, 15, 400, "no files uploaded");
export const ErrUploadedFileEmpty = newNormalError(NormalSubcategoryGlobal, 16, 400, "uploaded file is empty");
export const ErrExceedMaxUploadFileSize = newNormalError(NormalSubcategoryGlobal, 17, 400, "uploaded file size exceeds the maximum allowed size");
export const ErrFailureCountLimitReached = newNormalError(NormalSubcategoryGlobal, 18, 400, "failure count exceeded maximum limit");
export const ErrRepeatedRequest = newNormalError(NormalSubcategoryGlobal, 19, 400, "repeated request");
export const ErrIPForbidden = newNormalError(NormalSubcategoryGlobal, 20, 400, "ip address is forbidden to access this resource");
export const ErrNumericOverflow = newNormalError(NormalSubcategoryGlobal, 21, 400, "numeric overflow");
export const ErrDateRangeInvalid = newNormalError(NormalSubcategoryGlobal, 22, 400, "date range is invalid");

// large_language_model.go
export const ErrLargeLanguageModelProviderNotEnabled = newNormalError(NormalSubcategoryLargeLanguageModel, 0, 400, "llm provider is not enabled");
export const ErrNoAIRecognitionImage = newNormalError(NormalSubcategoryLargeLanguageModel, 1, 400, "no image for AI recognition");
export const ErrAIRecognitionImageIsEmpty = newNormalError(NormalSubcategoryLargeLanguageModel, 2, 400, "image for AI recognition is empty");
export const ErrExceedMaxAIRecognitionImageFileSize = newNormalError(NormalSubcategoryLargeLanguageModel, 3, 400, "exceed the maximum size of image file for AI recognition");
export const ErrNoTransactionInformation = newNormalError(NormalSubcategoryLargeLanguageModel, 4, 400, "no transaction information detected");
export const ErrNoAIRecognitionText = newNormalError(NormalSubcategoryLargeLanguageModel, 5, 400, "no text for AI recognition");
export const ErrAIRecognitionTextIsEmpty = newNormalError(NormalSubcategoryLargeLanguageModel, 6, 400, "text for AI recognition is empty");

// logging.go
export const ErrLoggingError = newSystemError(SystemSubcategoryLogging, 0, 500, "logging error");

// mail.go
export const ErrSMTPServerNotEnabled = newSystemError(SystemSubcategoryMail, 0, 500, "SMTP server is not enabled");
export const ErrSMTPServerHostInvalid = newSystemError(SystemSubcategoryMail, 1, 500, "SMTP server host is invalid");

// map_image_proxy.go
export const ErrMapProviderNotCurrent = newNormalError(NormalSubcategoryMapProxy, 0, 400, "specified map provider is not set");
export const ErrImageExtensionNotSupported = newNormalError(NormalSubcategoryMapProxy, 0, 404, "specified image extension is not supported");

// mcp.go
export const ErrMCPServerNotEnabled = newNormalError(NormalSubcategoryModelContextProtocol, 0, 400, "mcp server is not enabled");

// oauth2.go
export const ErrOAuth2NotEnabled = newNormalError(NormalSubcategoryOAuth2, 0, 400, "oauth2 not enabled");
export const ErrOAuth2AutoRegistrationNotEnabled = newNormalError(NormalSubcategoryOAuth2, 1, 400, "oauth2 auto registration not enabled");
export const ErrInvalidOAuth2LoginRequest = newNormalError(NormalSubcategoryOAuth2, 2, 400, "invalid oauth2 login request");
export const ErrInvalidOAuth2Callback = newNormalError(NormalSubcategoryOAuth2, 3, 400, "invalid oauth2 callback");
export const ErrMissingOAuth2State = newNormalError(NormalSubcategoryOAuth2, 4, 400, "missing state in oauth2 callback");
export const ErrMissingOAuth2Code = newNormalError(NormalSubcategoryOAuth2, 5, 400, "missing code in oauth2 callback");
export const ErrInvalidOAuth2State = newNormalError(NormalSubcategoryOAuth2, 6, 400, "invalid state in oauth2 callback");
export const ErrCannotRetrieveOAuth2Token = newNormalError(NormalSubcategoryOAuth2, 7, 400, "cannot retrieve oauth2 token");
export const ErrInvalidOAuth2Token = newNormalError(NormalSubcategoryOAuth2, 8, 400, "invalid oauth2 token");
export const ErrCannotRetrieveUserInfo = newNormalError(NormalSubcategoryOAuth2, 9, 400, "cannot retrieve user info from oauth2 provider");
export const ErrOAuth2UserAlreadyBoundToAnotherUser = newNormalError(NormalSubcategoryOAuth2, 10, 400, "oauth2 user already bound to another user");
export const ErrOAuth2UserNameAndEmailEmpty = newNormalError(NormalSubcategoryOAuth2, 11, 400, "user name and email from oauth2 provider are both empty");
export const ErrOAuth2UserNameEmpty = newNormalError(NormalSubcategoryOAuth2, 12, 400, "user name from oauth2 provider is empty");
export const ErrOAuth2EmailEmpty = newNormalError(NormalSubcategoryOAuth2, 13, 400, "email from oauth2 provider is empty");
export const ErrOAuth2UserNameEmptyCannotRegister = newNormalError(NormalSubcategoryOAuth2, 14, 400, "user name from oauth2 provider is empty, cannot register new user");
export const ErrOAuth2EmailEmptyCannotRegister = newNormalError(NormalSubcategoryOAuth2, 15, 400, "email from oauth2 provider is empty, cannot register new user");

// setting.go
export const ErrInvalidServerMode = newSystemError(SystemSubcategorySetting, 0, 500, "invalid server mode");
export const ErrInvalidProtocol = newSystemError(SystemSubcategorySetting, 1, 500, "invalid server protocol");
export const ErrInvalidLogMode = newSystemError(SystemSubcategorySetting, 2, 500, "invalid log mode");
export const ErrInvalidLogLevel = newSystemError(SystemSubcategorySetting, 3, 500, "invalid log level");
export const ErrGettingLocalAddress = newSystemError(SystemSubcategorySetting, 4, 500, "failed to get local address");
export const ErrInvalidStorageType = newSystemError(SystemSubcategorySetting, 5, 500, "invalid storage type");
export const ErrInvalidLocalFileSystemStoragePath = newSystemError(SystemSubcategorySetting, 6, 500, "invalid local file system storage path");
export const ErrInvalidUuidMode = newSystemError(SystemSubcategorySetting, 7, 500, "invalid uuid mode");
export const ErrInvalidDuplicateCheckerType = newSystemError(SystemSubcategorySetting, 8, 500, "invalid duplicate checker type");
export const ErrInvalidInMemoryDuplicateCheckerCleanupInterval = newSystemError(SystemSubcategorySetting, 9, 500, "invalid in-memory duplicate checker cleanup interval");
export const ErrInvalidTokenExpiredTime = newSystemError(SystemSubcategorySetting, 10, 500, "invalid token expired time");
export const ErrInvalidTokenMinRefreshInterval = newSystemError(SystemSubcategorySetting, 11, 500, "invalid token min refresh interval");
export const ErrInvalidTemporaryTokenExpiredTime = newSystemError(SystemSubcategorySetting, 12, 500, "invalid temporary token expired time");
export const ErrInvalidEmailVerifyTokenExpiredTime = newSystemError(SystemSubcategorySetting, 13, 500, "invalid email verify token expired time");
export const ErrInvalidAvatarProvider = newSystemError(SystemSubcategorySetting, 14, 500, "invalid avatar provider");
export const ErrInvalidMapProvider = newSystemError(SystemSubcategorySetting, 15, 500, "invalid map provider");
export const ErrInvalidAmapSecurityVerificationMethod = newSystemError(SystemSubcategorySetting, 16, 500, "invalid amap security verification method");
export const ErrInvalidPasswordResetTokenExpiredTime = newSystemError(SystemSubcategorySetting, 17, 500, "invalid password reset token expired time");
export const ErrInvalidExchangeRatesDataSource = newSystemError(SystemSubcategorySetting, 18, 500, "invalid exchange rates data source");
export const ErrInvalidIpAddressPattern = newSystemError(SystemSubcategorySetting, 19, 500, "invalid ip address pattern");
export const ErrInvalidLLMProvider = newSystemError(SystemSubcategorySetting, 20, 500, "invalid llm provider");
export const ErrInvalidLLMModelId = newSystemError(SystemSubcategorySetting, 21, 500, "invalid llm model id");
export const ErrInvalidOAuth2Config = newSystemError(SystemSubcategorySetting, 22, 500, "invalid oauth 2.0 config");
export const ErrInvalidOAuth2UserIdentifier = newSystemError(SystemSubcategorySetting, 23, 500, "invalid oauth 2.0 user identifier");
export const ErrInvalidOAuth2Provider = newSystemError(SystemSubcategorySetting, 24, 500, "invalid oauth 2.0 provider");
export const ErrInvalidOAuth2StateExpiredTime = newSystemError(SystemSubcategorySetting, 25, 500, "invalid oauth 2.0 state expired time");
export const ErrInvalidLLMThinkingLevel = newSystemError(SystemSubcategorySetting, 26, 500, "invalid llm thinking level");

// system.go
export const ErrSystemError = newSystemError(SystemSubcategoryDefault, 0, 500, "system error");
export const ErrApiNotFound = newSystemError(SystemSubcategoryDefault, 1, 404, "api not found");
export const ErrMethodNotAllowed = newSystemError(SystemSubcategoryDefault, 2, 405, "method not allowed");
export const ErrNotImplemented = newSystemError(SystemSubcategoryDefault, 3, 501, "not implemented");
export const ErrSystemIsBusy = newSystemError(SystemSubcategoryDefault, 4, 503, "system is busy");
export const ErrNotSupported = newSystemError(SystemSubcategoryDefault, 5, 400, "not supported");
export const ErrImageTypeNotSupported = newSystemError(SystemSubcategoryDefault, 6, 400, "image type not supported");

// token.go
export const ErrTokenGenerating = newNormalError(NormalSubcategoryToken, 0, 500, "failed to generate token");
export const ErrUnauthorizedAccess = newNormalError(NormalSubcategoryToken, 1, 401, "unauthorized access");
export const ErrCurrentInvalidToken = newNormalError(NormalSubcategoryToken, 2, 401, "current token is invalid");
export const ErrCurrentTokenExpired = newNormalError(NormalSubcategoryToken, 3, 401, "current token is expired");
export const ErrCurrentInvalidTokenType = newNormalError(NormalSubcategoryToken, 4, 401, "current token type is invalid");
export const ErrCurrentTokenRequire2FA = newNormalError(NormalSubcategoryToken, 5, 401, "current token requires two-factor authorization");
export const ErrCurrentTokenNotRequire2FA = newNormalError(NormalSubcategoryToken, 6, 401, "current token does not require two-factor authorization");
export const ErrInvalidToken = newNormalError(NormalSubcategoryToken, 7, 400, "token is invalid");
export const ErrInvalidTokenId = newNormalError(NormalSubcategoryToken, 8, 400, "token id is invalid");
export const ErrInvalidUserTokenId = newNormalError(NormalSubcategoryToken, 9, 400, "user token id is invalid");
export const ErrTokenRecordNotFound = newNormalError(NormalSubcategoryToken, 10, 400, "token is not found");
export const ErrTokenExpired = newNormalError(NormalSubcategoryToken, 11, 400, "token is expired");
export const ErrTokenIsEmpty = newNormalError(NormalSubcategoryToken, 12, 400, "token is empty");
export const ErrEmailVerifyTokenIsInvalidOrExpired = newNormalError(NormalSubcategoryToken, 13, 400, "email verify token is invalid or expired");
export const ErrPasswordResetTokenIsInvalidOrExpired = newNormalError(NormalSubcategoryToken, 14, 400, "password reset token is invalid or expired");
export const ErrAPITokenNotEnabled = newNormalError(NormalSubcategoryToken, 15, 403, "api token is not enabled");

// transaction.go
export const ErrTransactionIdInvalid = newNormalError(NormalSubcategoryTransaction, 0, 400, "transaction id is invalid");
export const ErrTransactionNotFound = newNormalError(NormalSubcategoryTransaction, 1, 400, "transaction not found");
export const ErrTransactionTypeInvalid = newNormalError(NormalSubcategoryTransaction, 2, 400, "transaction type is invalid");
export const ErrTransactionSourceAndDestinationIdCannotBeEqual = newNormalError(NormalSubcategoryTransaction, 3, 400, "transaction source and destination account id cannot be equal");
export const ErrTransactionSourceAndDestinationAmountNotEqual = newNormalError(NormalSubcategoryTransaction, 4, 400, "transaction source and destination amount not equal");
export const ErrTransactionDestinationAccountCannotBeSet = newNormalError(NormalSubcategoryTransaction, 5, 400, "transaction destination account cannot be set");
export const ErrTransactionDestinationAmountCannotBeSet = newNormalError(NormalSubcategoryTransaction, 6, 400, "transaction destination amount cannot be set");
export const ErrTooMuchTransactionInOneSecond = newNormalError(NormalSubcategoryTransaction, 7, 400, "too much transaction in one second");
export const ErrBalanceModificationTransactionCannotSetCategory = newNormalError(NormalSubcategoryTransaction, 8, 400, "balance modification transaction cannot set category");
export const ErrBalanceModificationTransactionCannotChangeAccountId = newNormalError(NormalSubcategoryTransaction, 9, 400, "balance modification transaction cannot change account id");
export const ErrBalanceModificationTransactionCannotAddWhenNotEmpty = newNormalError(NormalSubcategoryTransaction, 10, 400, "balance modification transaction cannot add when other transaction exists");
export const ErrCannotAddTransactionToHiddenAccount = newNormalError(NormalSubcategoryTransaction, 11, 400, "cannot add transaction to hidden account");
export const ErrCannotModifyTransactionInHiddenAccount = newNormalError(NormalSubcategoryTransaction, 12, 400, "cannot modify transaction of hidden account");
export const ErrCannotDeleteTransactionInHiddenAccount = newNormalError(NormalSubcategoryTransaction, 13, 400, "cannot delete transaction in hidden account");
export const ErrCannotAddTransactionToParentAccount = newNormalError(NormalSubcategoryTransaction, 14, 400, "cannot add transaction to parent account");
export const ErrCannotModifyTransactionInParentAccount = newNormalError(NormalSubcategoryTransaction, 15, 400, "cannot modify transaction of parent account");
export const ErrCannotDeleteTransactionInParentAccount = newNormalError(NormalSubcategoryTransaction, 16, 400, "cannot delete transaction in parent account");
export const ErrCannotCreateTransactionWithThisTransactionTime = newNormalError(NormalSubcategoryTransaction, 17, 400, "cannot add transaction with this transaction time");
export const ErrCannotModifyTransactionWithThisTransactionTime = newNormalError(NormalSubcategoryTransaction, 18, 400, "cannot modify transaction with this transaction time");
export const ErrCannotDeleteTransactionWithThisTransactionTime = newNormalError(NormalSubcategoryTransaction, 19, 400, "cannot delete transaction with this transaction time");
export const ErrCannotUseHiddenAccount = newNormalError(NormalSubcategoryTransaction, 20, 400, "cannot use hidden account");
export const ErrCannotUseHiddenTransactionCategory = newNormalError(NormalSubcategoryTransaction, 21, 400, "cannot use hidden transaction category");
export const ErrCannotUseHiddenTransactionTag = newNormalError(NormalSubcategoryTransaction, 22, 400, "cannot use hidden transaction tag");
export const ErrTransactionHasTooManyTags = newNormalError(NormalSubcategoryTransaction, 23, 400, "transaction has too many tags");
export const ErrTransactionHasTooManyPictures = newNormalError(NormalSubcategoryTransaction, 24, 400, "transaction has too many pictures");
export const ErrImportFileTypeIsEmpty = newNormalError(NormalSubcategoryTransaction, 25, 400, "import file type is empty");
export const ErrImportFileTypeNotSupported = newNormalError(NormalSubcategoryTransaction, 26, 400, "import file type not supported");
export const ErrNoDataToImport = newNormalError(NormalSubcategoryTransaction, 27, 400, "no data to import");
export const ErrCannotAddTransactionBeforeBalanceModificationTransaction = newNormalError(NormalSubcategoryTransaction, 28, 400, "cannot add transaction before balance modification transaction");
export const ErrBalanceModificationTransactionCannotModifyTime = newNormalError(NormalSubcategoryTransaction, 29, 400, "balance modification transaction cannot modify transaction time");
export const ErrTransferTransactionAmountCannotBeLessThanZero = newNormalError(NormalSubcategoryTransaction, 30, 400, "transfer transaction amount cannot be less than zero");
export const ErrImportFileEncodingIsEmpty = newNormalError(NormalSubcategoryTransaction, 31, 400, "import file encoding is empty");
export const ErrImportFileEncodingNotSupported = newNormalError(NormalSubcategoryTransaction, 32, 400, "import file encoding not supported");
export const ErrImportFileColumnMappingInvalid = newNormalError(NormalSubcategoryTransaction, 33, 400, "column mapping invalid");
export const ErrImportFileTransactionTypeMappingInvalid = newNormalError(NormalSubcategoryTransaction, 34, 400, "transaction type mapping invalid");
export const ErrImportFileTransactionTimeFormatInvalid = newNormalError(NormalSubcategoryTransaction, 35, 400, "transaction time format invalid");
export const ErrImportFileTransactionTimezoneFormatInvalid = newNormalError(NormalSubcategoryTransaction, 36, 400, "transaction time zone format invalid");
export const ErrCannotMoveTransactionToSameAccount = newNormalError(NormalSubcategoryTransaction, 37, 400, "cannot move transaction to same account");
export const ErrCannotMoveTransactionFromOrToHiddenAccount = newNormalError(NormalSubcategoryTransaction, 38, 400, "cannot move transaction from or to hidden account");
export const ErrCannotMoveTransactionFromOrToParentAccount = newNormalError(NormalSubcategoryTransaction, 39, 400, "cannot move transaction from or to parent account");
export const ErrCannotMoveTransactionBetweenAccountsWithDifferentCurrencies = newNormalError(NormalSubcategoryTransaction, 40, 400, "cannot move transaction between accounts with different currencies");
export const ErrCannotAddTagsToTooManyTransactionsOneTime = newNormalError(NormalSubcategoryTransaction, 41, 400, "cannot add tags to too many transactions one time");
export const ErrMergedBalanceModificationTransactionAmountOverflow = newNormalError(NormalSubcategoryTransaction, 42, 400, "merged balance modification transaction amount overflow");
export const ErrTransactionTimeInvalid = newNormalError(NormalSubcategoryTransaction, 43, 400, "transaction time is invalid");
export const ErrTransactionTimeZoneInvalid = newNormalError(NormalSubcategoryTransaction, 44, 400, "transaction time zone is invalid");
export const ErrAmountInvalid = newNormalError(NormalSubcategoryTransaction, 45, 400, "transaction amount is invalid");
export const ErrGeographicLocationInvalid = newNormalError(NormalSubcategoryTransaction, 46, 400, "geographic location is invalid");

// transaction_category.go
export const ErrTransactionCategoryIdInvalid = newNormalError(NormalSubcategoryCategory, 0, 400, "transaction category id is invalid");
export const ErrTransactionCategoryNotFound = newNormalError(NormalSubcategoryCategory, 1, 400, "transaction category not found");
export const ErrTransactionCategoryTypeInvalid = newNormalError(NormalSubcategoryCategory, 2, 400, "transaction category type is invalid");
export const ErrParentTransactionCategoryNotFound = newNormalError(NormalSubcategoryCategory, 3, 400, "parent transaction category not found");
export const ErrCannotAddToSecondaryTransactionCategory = newNormalError(NormalSubcategoryCategory, 4, 400, "cannot add to secondary transaction category");
export const ErrCannotUsePrimaryCategoryForTransaction = newNormalError(NormalSubcategoryCategory, 5, 400, "cannot use primary category for transaction category");
export const ErrTransactionCategoryInUseCannotBeDeleted = newNormalError(NormalSubcategoryCategory, 6, 400, "transaction category is in use and cannot be deleted");
export const ErrNotAllowChangePrimaryTransactionCategoryToSecondary = newNormalError(NormalSubcategoryCategory, 7, 400, "not allow to change primary category to secondary category");
export const ErrNotAllowChangeSecondaryTransactionCategoryToPrimary = newNormalError(NormalSubcategoryCategory, 8, 400, "not allow to change secondary category to primary category");
export const ErrNotAllowChangePrimaryTransactionType = newNormalError(NormalSubcategoryCategory, 9, 400, "not allow to change primary category with different type");
export const ErrNotAllowUseSecondaryTransactionAsPrimaryCategory = newNormalError(NormalSubcategoryCategory, 10, 400, "not allow to use secondary category as primary category");
export const ErrTransactionCategoryIconInvalid = newNormalError(NormalSubcategoryCategory, 11, 400, "transaction category icon is invalid");

// transaction_picture.go
export const ErrTransactionPictureIdInvalid = newNormalError(NormalSubcategoryPicture, 0, 400, "transaction picture id is invalid");
export const ErrTransactionPictureNotFound = newNormalError(NormalSubcategoryPicture, 1, 400, "transaction picture not found");
export const ErrNoTransactionPicture = newNormalError(NormalSubcategoryPicture, 2, 400, "no transaction picture");
export const ErrTransactionPictureIsEmpty = newNormalError(NormalSubcategoryPicture, 3, 400, "transaction picture is empty");
export const ErrTransactionPictureNoExists = newNormalError(NormalSubcategoryPicture, 4, 404, "transaction picture not exists");
export const ErrTransactionPictureExtensionInvalid = newNormalError(NormalSubcategoryPicture, 5, 404, "transaction picture file extension invalid");
export const ErrExceedMaxTransactionPictureFileSize = newNormalError(NormalSubcategoryPicture, 6, 400, "exceed the maximum size of transaction picture file");

// transaction_tag.go
export const ErrTransactionTagIdInvalid = newNormalError(NormalSubcategoryTag, 0, 400, "transaction tag id is invalid");
export const ErrTransactionTagNotFound = newNormalError(NormalSubcategoryTag, 1, 400, "transaction tag not found");
export const ErrTransactionTagNameIsEmpty = newNormalError(NormalSubcategoryTag, 2, 400, "transaction tag name is empty");
export const ErrTransactionTagNameAlreadyExists = newNormalError(NormalSubcategoryTag, 3, 400, "transaction tag name already exists");
export const ErrTransactionTagInUseCannotBeDeleted = newNormalError(NormalSubcategoryTag, 4, 400, "transaction tag is in use and cannot be deleted");
export const ErrTransactionTagIndexNotFound = newNormalError(NormalSubcategoryTag, 5, 400, "transaction tag index not found");

// transaction_tag_group.go
export const ErrTransactionTagGroupIdInvalid = newNormalError(NormalSubcategoryTagGroup, 0, 400, "transaction tag group id is invalid");
export const ErrTransactionTagGroupNotFound = newNormalError(NormalSubcategoryTagGroup, 1, 400, "transaction tag group not found");
export const ErrTransactionTagGroupInUseCannotBeDeleted = newNormalError(NormalSubcategoryTagGroup, 2, 400, "transaction tag group is in use and cannot be deleted");

// transaction_template.go
export const ErrTransactionTemplateIdInvalid = newNormalError(NormalSubcategoryTemplate, 0, 400, "transaction template id is invalid");
export const ErrTransactionTemplateNotFound = newNormalError(NormalSubcategoryTemplate, 1, 400, "transaction template not found");
export const ErrTransactionTemplateTypeInvalid = newNormalError(NormalSubcategoryTemplate, 2, 400, "transaction template type is invalid");
export const ErrScheduledTransactionNotEnabled = newNormalError(NormalSubcategoryTemplate, 3, 400, "scheduled transaction is not enabled");
export const ErrScheduledTransactionFrequencyInvalid = newNormalError(NormalSubcategoryTemplate, 4, 400, "scheduled transaction frequency is invalid");
export const ErrTransactionTemplateHasTooManyTags = newNormalError(NormalSubcategoryTemplate, 5, 400, "transaction template has too many tags");
export const ErrScheduledTransactionTemplateStartDataLaterThanEndDate = newNormalError(NormalSubcategoryTemplate, 6, 400, "scheduled transaction start date is later than end time");
export const ErrScheduledTransactionStartDateRequired = newNormalError(NormalSubcategoryTemplate, 7, 400, "scheduled transaction start date is required");

// twofactor_authorization.go
export const ErrPasscodeInvalid = newNormalError(NormalSubcategoryTwofactor, 0, 401, "passcode is invalid");
export const ErrTwoFactorRecoveryCodeInvalid = newNormalError(NormalSubcategoryTwofactor, 1, 401, "two-factor backup code is invalid");
export const ErrTwoFactorRecoveryCodeNotExist = newNormalError(NormalSubcategoryTwofactor, 2, 401, "two-factor backup code does not exist");
export const ErrTwoFactorIsNotEnabled = newNormalError(NormalSubcategoryTwofactor, 3, 400, "two-factor is not enabled");
export const ErrTwoFactorAlreadyEnabled = newNormalError(NormalSubcategoryTwofactor, 4, 400, "two-factor has already been enabled");
export const ErrPasscodeEmpty = newNormalError(NormalSubcategoryTwofactor, 5, 401, "passcode is empty");

// user.go
export const ErrLoginNameInvalid = newNormalError(NormalSubcategoryUser, 0, 401, "login name is invalid");
export const ErrLoginNameOrPasswordInvalid = newNormalError(NormalSubcategoryUser, 1, 401, "login name or password is invalid");
export const ErrLoginNameOrPasswordWrong = newNormalError(NormalSubcategoryUser, 2, 401, "login name or password is wrong");
export const ErrUserIdInvalid = newNormalError(NormalSubcategoryUser, 3, 400, "user id is invalid");
export const ErrUsernameIsEmpty = newNormalError(NormalSubcategoryUser, 4, 400, "username is empty");
export const ErrEmailIsEmpty = newNormalError(NormalSubcategoryUser, 5, 400, "email is empty");
export const ErrNicknameIsEmpty = newNormalError(NormalSubcategoryUser, 6, 400, "nickname is empty");
export const ErrPasswordIsEmpty = newNormalError(NormalSubcategoryUser, 7, 400, "password is empty");
export const ErrUserDefaultCurrencyIsEmpty = newNormalError(NormalSubcategoryUser, 8, 400, "user default currency is empty");
export const ErrUserDefaultCurrencyIsInvalid = newNormalError(NormalSubcategoryUser, 9, 400, "user default currency is invalid");
export const ErrUserNotFound = newNormalError(NormalSubcategoryUser, 10, 400, "user not found");
export const ErrUserPasswordWrong = newNormalError(NormalSubcategoryUser, 11, 400, "password is wrong");
export const ErrUsernameAlreadyExists = newNormalError(NormalSubcategoryUser, 12, 400, "username already exists");
export const ErrUserEmailAlreadyExists = newNormalError(NormalSubcategoryUser, 13, 400, "email already exists");
export const ErrUserRegistrationNotAllowed = newNormalError(NormalSubcategoryUser, 14, 400, "user registration not allowed");
export const ErrUserDefaultAccountIsInvalid = newNormalError(NormalSubcategoryUser, 15, 400, "user default account is invalid");
export const ErrUserIsDisabled = newNormalError(NormalSubcategoryUser, 16, 400, "user is disabled");
export const ErrEmailIsInvalid = newNormalError(NormalSubcategoryUser, 17, 400, "email is invalid");
export const ErrEmailIsEmptyOrInvalid = newNormalError(NormalSubcategoryUser, 18, 400, "email is empty or invalid");
export const ErrNewPasswordEqualsOldInvalid = newNormalError(NormalSubcategoryUser, 19, 400, "new password equals old password");
export const ErrEmailIsNotVerified = newNormalError(NormalSubcategoryUser, 20, 400, "email is not verified");
export const ErrEmailIsVerified = newNormalError(NormalSubcategoryUser, 21, 400, "email is verified");
export const ErrEmailValidationNotAllowed = newNormalError(NormalSubcategoryUser, 22, 400, "email validation not allowed");
export const ErrDecimalSeparatorAndDigitGroupingSymbolCannotBeEqual = newNormalError(NormalSubcategoryUser, 23, 400, "decimal separator and digit grouping symbol cannot be equal");
export const ErrUserDefaultAccountIsHidden = newNormalError(NormalSubcategoryUser, 24, 400, "user default account is hidden");
export const ErrNoUserAvatar = newNormalError(NormalSubcategoryUser, 25, 400, "no user avatar");
export const ErrUserAvatarIsEmpty = newNormalError(NormalSubcategoryUser, 26, 400, "user avatar is empty");
export const ErrUserAvatarNoExists = newNormalError(NormalSubcategoryUser, 27, 404, "user avatar not exists");
export const ErrUserAvatarNotSet = newNormalError(NormalSubcategoryUser, 28, 404, "user avatar not set");
export const ErrUserAvatarExtensionInvalid = newNormalError(NormalSubcategoryUser, 29, 404, "user avatar file extension invalid");
export const ErrExceedMaxUserAvatarFileSize = newNormalError(NormalSubcategoryUser, 30, 400, "exceed the maximum size of user avatar file");
export const ErrNotPermittedToPerformThisAction = newNormalError(NormalSubcategoryUser, 31, 400, "not permitted to perform this action");
export const ErrCannotLoginByPassword = newNormalError(NormalSubcategoryUser, 32, 400, "cannot login by password");
export const ErrUserNameIsInvalid = newNormalError(NormalSubcategoryUser, 33, 400, "user name is invalid");
export const ErrNickNameIsInvalid = newNormalError(NormalSubcategoryUser, 34, 400, "nick name is invalid");
export const ErrLastReconciledTimeIsNotEnabled = newNormalError(NormalSubcategoryUser, 35, 400, "last reconciled time is not enabled");

// user_custom_exchange_rate.go
export const ErrUserCustomExchangeRateNotFound = newNormalError(NormalSubcategoryUserCustomExchangeRate, 0, 400, "user custom exchange rate data not found");
export const ErrCannotUpdateExchangeRateForDefaultCurrency = newNormalError(NormalSubcategoryUserCustomExchangeRate, 1, 400, "cannot update exchange rate data for base currency");
export const ErrCannotDeleteExchangeRateForDefaultCurrency = newNormalError(NormalSubcategoryUserCustomExchangeRate, 2, 400, "cannot delete exchange rate data for base currency");

// user_custom_icon.go
export const ErrUserCustomIconIdInvalid = newNormalError(NormalSubcategoryUserCustomIcon, 0, 400, "user custom icon id is invalid");
export const ErrUserCustomIconNotFound = newNormalError(NormalSubcategoryUserCustomIcon, 1, 400, "user custom icon not found");
export const ErrNoUserCustomIcon = newNormalError(NormalSubcategoryUserCustomIcon, 2, 400, "no user custom icon");
export const ErrUserCustomIconIsEmpty = newNormalError(NormalSubcategoryUserCustomIcon, 3, 400, "user custom icon is empty");
export const ErrUserCustomIconeNotExists = newNormalError(NormalSubcategoryUserCustomIcon, 4, 404, "user custom icon not exists");
export const ErrUserCustomIconExtensionInvalid = newNormalError(NormalSubcategoryUserCustomIcon, 5, 400, "user custom icon file extension invalid");
export const ErrExceedMaxUserCustomIconFileSize = newNormalError(NormalSubcategoryUserCustomIcon, 6, 400, "exceed the maximum size of user custom icon file");
export const ErrUserCustomIconDimensionsInvalid = newNormalError(NormalSubcategoryUserCustomIcon, 7, 400, "user custom icon dimensions must not exceed 256 pixels");
export const ErrUserCustomIconInUse = newNormalError(NormalSubcategoryUserCustomIcon, 8, 400, "user custom icon is in use");
