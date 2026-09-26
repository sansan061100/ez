import * as largeLanguageModels from '~~/server/lib/api/large_language_models';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    enabled: config => !!config.receiptImageRecognitionLLMConfig && config.receiptImageRecognitionLLMConfig.llmProvider !== '' && config.transactionFromAIImageRecognition,
    handler: bindApi(largeLanguageModels.recognizeReceiptImageHandler),
});
