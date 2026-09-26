import type { Context } from '../core/context';
import { ApplicationName, getOutgoingUserAgent } from '../core/types';
import * as errs from '../errs/index';
import { type HttpClient, newHttpClient } from '../httpclient/index';
import * as log from '../log/index';
import {
    AnthropicCompatibleLLMProvider,
    AnthropicLLMProvider,
    type Config,
    GoogleAILLMProvider,
    type LLMConfig,
    LMStudioLLMProvider,
    OllamaLLMProvider,
    OpenAICompatibleLLMProvider,
    OpenAILLMProvider,
    OpenAIResponsesCompatibleLLMProvider,
    OpenRouterLLMProvider,
} from '../settings/settings';
import { goJsonStringify } from '../web/json';

export const LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_TEXT = 0;
export const LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL = 1;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used in the response format type (same as the original go constant)
const LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_TEXT = 0;
const LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_JSON = 1;

type ResponseFormat = typeof LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_TEXT | typeof LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_JSON;

// LargeLanguageModelRequest represents the request to large language model
export interface LargeLanguageModelRequest {
    stream: boolean;
    systemPrompt: string;
    userPrompt: Buffer;
    userPromptType: number;
    userPromptContentType: string;
    // the json schema of response object (generated like invopop/jsonschema), null for no schema
    responseJsonSchema: Record<string, unknown> | null;
}

// LargeLanguageModelTextualResponse represents the textual response from large language model
export interface LargeLanguageModelTextualResponse {
    content: string;
}

// LargeLanguageModelProvider defines the structure of large language model provider
export interface LargeLanguageModelProvider {
    getJsonResponse(c: Context, uid: bigint, currentLLMConfig: LLMConfig, request: LargeLanguageModelRequest): Promise<LargeLanguageModelTextualResponse>;
}

interface HttpRequestDefinition {
    url: string;
    headers: Record<string, string>;
    body: string;
}

// HttpLargeLanguageModelAdapter defines the structure of http large language model adapter
interface HttpLargeLanguageModelAdapter {
    buildTextualRequest(c: Context, uid: bigint, request: LargeLanguageModelRequest, responseType: ResponseFormat): HttpRequestDefinition;
    parseTextualResponse(c: Context, uid: bigint, body: Buffer, responseType: ResponseFormat): LargeLanguageModelTextualResponse;
}

function ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : url + '/';
}

function parseJsonObject(body: Buffer): Record<string, unknown> | null {
    const data = JSON.parse(body.toString('utf8')) as unknown;

    if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
        throw new Error('json: cannot unmarshal into go struct');
    }

    return data as Record<string, unknown> | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function marshalRequestBody(c: Context, uid: bigint, prefix: string, request: unknown): string {
    const body = goJsonStringify(request);
    log.debugf(c, `[${prefix}.buildJsonRequestBody] request body is ${body}`);
    void uid;
    return body;
}

class CommonHttpLargeLanguageModelProvider implements LargeLanguageModelProvider {
    private readonly httpClient: HttpClient;

    public constructor(llmConfig: LLMConfig, enableResponseLog: boolean, private readonly adapter: HttpLargeLanguageModelAdapter) {
        this.httpClient = newHttpClient(llmConfig.largeLanguageModelAPIRequestTimeout, llmConfig.largeLanguageModelAPIProxy, llmConfig.largeLanguageModelAPISkipTLSVerify, getOutgoingUserAgent(), enableResponseLog);
    }

    public async getJsonResponse(c: Context, uid: bigint, _currentLLMConfig: LLMConfig, request: LargeLanguageModelRequest): Promise<LargeLanguageModelTextualResponse> {
        const response = await this.getTextualResponse(c, uid, request, LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_JSON);

        if (response.content.startsWith('```json') && response.content.endsWith('```')) {
            response.content = response.content.substring('```json'.length);
            response.content = response.content.endsWith('```') ? response.content.substring(0, response.content.length - 3) : response.content;
        } else if (response.content.startsWith('```') && response.content.endsWith('```')) {
            response.content = response.content.substring(3);
            response.content = response.content.endsWith('```') ? response.content.substring(0, response.content.length - 3) : response.content;
        }

        return response;
    }

    private async getTextualResponse(c: Context, uid: bigint, request: LargeLanguageModelRequest, responseType: ResponseFormat): Promise<LargeLanguageModelTextualResponse> {
        const prefix = 'common_http_large_language_model_provider.getTextualResponse';
        let httpRequest: HttpRequestDefinition;

        try {
            httpRequest = this.adapter.buildTextualRequest(c, uid, request, responseType);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to build requests for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        let response;

        try {
            response = await this.httpClient.request(httpRequest.url, {
                method: 'POST',
                headers: httpRequest.headers,
                body: httpRequest.body,
                logHandler: body => log.debugf(c, `[${prefix}] response is ${body.toString('utf8')}`),
            });
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to request large language model api for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        if (response.status !== 200) {
            log.errorf(c, `[${prefix}] failed to get large language model api response for user "uid:${uid}", because response code is ${response.status}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        return this.adapter.parseTextualResponse(c, uid, response.body, responseType);
    }
}

const openAIReasoningEffortsMapping: Record<string, string> = {
    off: 'none',
    low: 'low',
    medium: 'medium',
    on: 'medium',
    high: 'high',
    xhigh: 'xhigh',
};

interface OpenAIApiProvider {
    url: string;
    headers: Record<string, string>;
    modelId: string;
}

// OpenAI chat completions api adapter
class OpenAIChatCompletionsAdapter implements HttpLargeLanguageModelAdapter {
    public constructor(private readonly apiProvider: OpenAIApiProvider, private readonly thinkingLevel: string) {
    }

    public buildTextualRequest(c: Context, uid: bigint, request: LargeLanguageModelRequest, responseType: ResponseFormat): HttpRequestDefinition {
        const prefix = 'openai_common_compatible_large_language_model_adapter';

        if (this.apiProvider.modelId === '') {
            throw errs.ErrInvalidLLMModelId;
        }

        const body: Record<string, unknown> = {
            model: this.apiProvider.modelId,
            stream: request.stream,
            messages: [] as unknown[],
        };

        const messages = body['messages'] as unknown[];
        const effort = openAIReasoningEffortsMapping[this.thinkingLevel];

        if (effort !== undefined) {
            body['reasoning'] = { effort: effort };
        }

        if (request.systemPrompt !== '') {
            messages.push({ role: 'system', content: request.systemPrompt });
        }

        if (request.userPrompt.length > 0) {
            if (request.userPromptType === LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL) {
                messages.push({
                    role: 'user',
                    content: [{
                        type: 'image_url',
                        image_url: { url: `data:${request.userPromptContentType};base64,${request.userPrompt.toString('base64')}` },
                    }],
                });
            } else {
                messages.push({ role: 'user', content: request.userPrompt.toString('utf8') });
            }
        }

        if (responseType === LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_JSON) {
            if (request.responseJsonSchema) {
                body['response_format'] = {
                    type: 'json_schema',
                    json_schema: {
                        name: 'response',
                        strict: true,
                        schema: request.responseJsonSchema,
                    },
                };
            } else {
                body['response_format'] = { type: 'json_object' };
            }
        }

        return {
            url: this.apiProvider.url,
            headers: { ...this.apiProvider.headers, 'Content-Type': 'application/json' },
            body: marshalRequestBody(c, uid, prefix, body),
        };
    }

    public parseTextualResponse(c: Context, uid: bigint, body: Buffer): LargeLanguageModelTextualResponse {
        const prefix = 'openai_common_compatible_large_language_model_adapter.ParseTextualResponse';
        let response: Record<string, unknown> | null;

        try {
            response = parseJsonObject(body);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to parse chat completions response for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const choices = asArray(response?.['choices']);
        const message = asObject(asObject(choices[0])?.['message']);
        const content = message?.['content'];

        if (typeof content !== 'string') {
            log.errorf(c, `[${prefix}] chat completions response is invalid for user "uid:${uid}"`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        return { content: content };
    }
}

// OpenAI responses api adapter
class OpenAIResponsesAdapter implements HttpLargeLanguageModelAdapter {
    public constructor(private readonly apiProvider: OpenAIApiProvider, private readonly thinkingLevel: string) {
    }

    public buildTextualRequest(c: Context, uid: bigint, request: LargeLanguageModelRequest, responseType: ResponseFormat): HttpRequestDefinition {
        const prefix = 'openai_common_responses_api_large_language_model_adapter';

        if (this.apiProvider.modelId === '') {
            throw errs.ErrInvalidLLMModelId;
        }

        const body: Record<string, unknown> = {
            model: this.apiProvider.modelId,
            stream: request.stream,
            input: [] as unknown[],
        };

        const input = body['input'] as unknown[];
        const effort = openAIReasoningEffortsMapping[this.thinkingLevel];

        if (effort !== undefined) {
            body['reasoning'] = { effort: effort };
        }

        if (request.systemPrompt !== '') {
            input.push({ role: 'system', content: request.systemPrompt });
        }

        if (request.userPrompt.length > 0) {
            if (request.userPromptType === LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL) {
                input.push({
                    role: 'user',
                    content: [{
                        type: 'input_image',
                        image_url: `data:${request.userPromptContentType};base64,${request.userPrompt.toString('base64')}`,
                    }],
                });
            } else {
                input.push({ role: 'user', content: request.userPrompt.toString('utf8') });
            }
        }

        if (responseType === LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_JSON) {
            if (request.responseJsonSchema) {
                body['text'] = {
                    format: {
                        type: 'json_schema',
                        name: 'response',
                        strict: true,
                        schema: request.responseJsonSchema,
                    },
                };
            } else {
                body['text'] = { format: { type: 'json_object' } };
            }
        }

        return {
            url: this.apiProvider.url,
            headers: { ...this.apiProvider.headers, 'Content-Type': 'application/json' },
            body: marshalRequestBody(c, uid, prefix, body),
        };
    }

    public parseTextualResponse(c: Context, uid: bigint, body: Buffer): LargeLanguageModelTextualResponse {
        const prefix = 'openai_common_responses_api_large_language_model_adapter.ParseTextualResponse';
        let response: Record<string, unknown> | null;

        try {
            response = parseJsonObject(body);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to parse responses response for user uid:${uid}, because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        let content = '';
        let hasOutputText = false;

        for (const outputItem of asArray(response?.['output'])) {
            const output = asObject(outputItem);

            if (!output || output['type'] !== 'message') {
                continue;
            }

            for (const contentItem of asArray(output['content'])) {
                const outputContent = asObject(contentItem);

                if (!outputContent || outputContent['type'] !== 'output_text' || typeof outputContent['text'] !== 'string') {
                    continue;
                }

                content += outputContent['text'];
                hasOutputText = true;
            }
        }

        if (!hasOutputText) {
            log.errorf(c, `[${prefix}] responses response is invalid for user uid:${uid}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        return { content: content };
    }
}

interface AnthropicApiProvider {
    url: string;
    headers: Record<string, string>;
    modelId: string;
    maxTokens: number;
    thinkingBudgetTokens: number;
}

// Anthropic messages api adapter
class AnthropicMessagesAdapter implements HttpLargeLanguageModelAdapter {
    public constructor(private readonly apiProvider: AnthropicApiProvider, private readonly thinkingLevel: string) {
    }

    public buildTextualRequest(c: Context, uid: bigint, request: LargeLanguageModelRequest): HttpRequestDefinition {
        const prefix = 'anthropic_common_compatible_large_language_model_adapter';

        if (this.apiProvider.modelId === '') {
            throw errs.ErrInvalidLLMModelId;
        }

        const thinking: Record<string, unknown> = { type: 'disabled' };

        if (this.thinkingLevel !== '' && this.thinkingLevel !== 'off') {
            thinking['type'] = 'enabled';

            if (this.apiProvider.thinkingBudgetTokens !== 0) {
                thinking['budget_tokens'] = this.apiProvider.thinkingBudgetTokens;
            }
        }

        const body: Record<string, unknown> = {
            model: this.apiProvider.modelId,
            max_tokens: this.apiProvider.maxTokens,
            stream: request.stream,
        };

        if (request.systemPrompt !== '') {
            body['system'] = request.systemPrompt;
        }

        const messages: unknown[] = [];
        body['messages'] = messages;
        body['thinking'] = thinking;

        if (request.userPrompt.length > 0) {
            if (request.userPromptType === LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL) {
                messages.push({
                    role: 'user',
                    content: [{
                        source: {
                            data: request.userPrompt.toString('base64'),
                            media_type: request.userPromptContentType,
                            type: 'base64',
                        },
                        type: 'image',
                    }],
                });
            } else {
                messages.push({ role: 'user', content: request.userPrompt.toString('utf8') });
            }
        }

        return {
            url: this.apiProvider.url,
            headers: { ...this.apiProvider.headers, 'Content-Type': 'application/json' },
            body: marshalRequestBody(c, uid, prefix, body),
        };
    }

    public parseTextualResponse(c: Context, uid: bigint, body: Buffer): LargeLanguageModelTextualResponse {
        const prefix = 'anthropic_common_compatible_large_language_model_adapter.ParseTextualResponse';
        let response: Record<string, unknown> | null;

        try {
            response = parseJsonObject(body);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to parse messages response for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const contents = asArray(response?.['content']);

        if (contents.length < 1) {
            log.errorf(c, `[${prefix}] messages response is invalid for user "uid:${uid}"`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        for (const item of contents) {
            const text = asObject(item)?.['text'];

            if (typeof text === 'string') {
                return { content: text };
            }
        }

        log.errorf(c, `[${prefix}] messages response content has no text field for user "uid:${uid}"`);
        throw errs.ErrFailedToRequestRemoteApi;
    }
}

const ollamaThinkingTypesMapping: Record<string, unknown> = {
    off: false,
    on: true,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'max',
};

// Ollama chat api adapter
class OllamaAdapter implements HttpLargeLanguageModelAdapter {
    public constructor(private readonly serverUrl: string, private readonly modelId: string, private readonly thinkingLevel: string) {
    }

    public buildTextualRequest(c: Context, uid: bigint, request: LargeLanguageModelRequest, responseType: ResponseFormat): HttpRequestDefinition {
        if (this.modelId === '') {
            throw errs.ErrInvalidLLMModelId;
        }

        const messages: Record<string, unknown>[] = [];
        const body: Record<string, unknown> = {
            model: this.modelId,
            stream: request.stream,
            messages: messages,
        };

        const think = ollamaThinkingTypesMapping[this.thinkingLevel];

        // go omitempty only omits nil interface value
        if (think !== undefined) {
            body['think'] = think;
        }

        if (request.systemPrompt !== '') {
            messages.push({ role: 'system', content: request.systemPrompt });
        }

        if (request.userPrompt.length > 0) {
            if (request.userPromptType === LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL) {
                messages.push({ role: 'user', content: '', images: [request.userPrompt.toString('base64')] });
            } else {
                messages.push({ role: 'user', content: request.userPrompt.toString('utf8') });
            }
        }

        if (responseType === LARGE_LANGUAGE_MODEL_RESPONSE_FORMAT_JSON) {
            body['format'] = 'json';
        }

        return {
            url: ensureTrailingSlash(this.serverUrl) + 'api/chat',
            headers: { 'Content-Type': 'application/json' },
            body: marshalRequestBody(c, uid, 'ollama_large_language_model_adapter', body),
        };
    }

    public parseTextualResponse(c: Context, uid: bigint, body: Buffer): LargeLanguageModelTextualResponse {
        const prefix = 'ollama_large_language_model_adapter.ParseTextualResponse';
        let response: Record<string, unknown> | null;

        try {
            response = parseJsonObject(body);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to parse chat response for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const content = asObject(response?.['message'])?.['content'];

        if (typeof content !== 'string') {
            log.errorf(c, `[${prefix}] chat response is invalid for user "uid:${uid}"`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        return { content: content };
    }
}

const lmStudioReasoningTypesMapping: Record<string, string> = {
    off: 'off',
    on: 'on',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'high',
};

// LM Studio chat api adapter
class LMStudioAdapter implements HttpLargeLanguageModelAdapter {
    public constructor(private readonly serverUrl: string, private readonly token: string, private readonly modelId: string, private readonly thinkingLevel: string) {
    }

    public buildTextualRequest(c: Context, uid: bigint, request: LargeLanguageModelRequest): HttpRequestDefinition {
        if (this.modelId === '') {
            throw errs.ErrInvalidLLMModelId;
        }

        const body: Record<string, unknown> = {
            model: this.modelId,
            stream: request.stream,
        };

        if (request.systemPrompt !== '') {
            body['system_prompt'] = request.systemPrompt;
        }

        const reasoning = lmStudioReasoningTypesMapping[this.thinkingLevel];

        if (reasoning) {
            body['reasoning'] = reasoning;
        }

        const input: Record<string, unknown>[] = [];
        body['input'] = input;

        if (request.userPrompt.length > 0) {
            if (request.userPromptType === LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL) {
                input.push({ type: 'image', data_url: `data:${request.userPromptContentType};base64,${request.userPrompt.toString('base64')}` });
            } else {
                const text = request.userPrompt.toString('utf8');
                input.push(text !== '' ? { type: 'text', content: text } : { type: 'text' });
            }
        }

        const headers: Record<string, string> = {};

        if (this.token !== '') {
            headers['Authorization'] = 'Bearer ' + this.token;
        }

        headers['Content-Type'] = 'application/json';

        return {
            url: ensureTrailingSlash(this.serverUrl) + 'api/v1/chat',
            headers: headers,
            body: marshalRequestBody(c, uid, 'lm_studio_large_language_model_adapter', body),
        };
    }

    public parseTextualResponse(c: Context, uid: bigint, body: Buffer): LargeLanguageModelTextualResponse {
        const prefix = 'lm_studio_large_language_model_adapter.ParseTextualResponse';
        let response: Record<string, unknown> | null;

        try {
            response = parseJsonObject(body);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to parse chat response for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const content = asObject(asArray(response?.['output'])[0])?.['content'];

        if (typeof content !== 'string') {
            log.errorf(c, `[${prefix}] chat response is invalid for user "uid:${uid}"`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        return { content: content };
    }
}

const googleAIThinkingLevelsMapping: Record<string, string> = {
    off: 'MINIMAL',
    low: 'LOW',
    medium: 'MEDIUM',
    on: 'MEDIUM',
    high: 'HIGH',
    xhigh: 'HIGH',
};

// Google AI generate content api adapter
class GoogleAIAdapter implements HttpLargeLanguageModelAdapter {
    public constructor(private readonly apiKey: string, private readonly modelId: string, private readonly thinkingLevel: string) {
    }

    public buildTextualRequest(c: Context, uid: bigint, request: LargeLanguageModelRequest): HttpRequestDefinition {
        if (this.modelId === '') {
            throw errs.ErrInvalidLLMModelId;
        }

        const parts: Record<string, unknown>[] = [];
        const body: Record<string, unknown> = {
            contents: [{ parts: parts }],
        };

        if (request.systemPrompt !== '') {
            body['systemInstruction'] = { parts: [{ text: request.systemPrompt }] };
        }

        const thinkingLevel = googleAIThinkingLevelsMapping[this.thinkingLevel];

        if (thinkingLevel !== undefined) {
            body['generationConfig'] = { thinkingConfig: { thinkingLevel: thinkingLevel } };
        }

        if (request.userPrompt.length > 0) {
            if (request.userPromptType === LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL) {
                parts.push({ inlineData: { mimeType: request.userPromptContentType, data: request.userPrompt.toString('base64') } });
            } else {
                const text = request.userPrompt.toString('utf8');
                parts.push(text !== '' ? { text: text } : {});
            }
        }

        return {
            url: `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent`,
            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': this.apiKey },
            body: marshalRequestBody(c, uid, 'google_ai_large_language_model_adapter', body),
        };
    }

    public parseTextualResponse(c: Context, uid: bigint, body: Buffer): LargeLanguageModelTextualResponse {
        const prefix = 'google_ai_large_language_model_adapter.ParseTextualResponse';
        let response: Record<string, unknown> | null;

        try {
            response = parseJsonObject(body);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to parse generate content response for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const candidate = asObject(asArray(response?.['candidates'])[0]);
        const part = asObject(asArray(asObject(candidate?.['content'])?.['parts'])[0]);
        const text = part?.['text'];

        if (typeof text !== 'string') {
            log.errorf(c, `[${prefix}] generate content response is invalid for user "uid:${uid}"`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        return { content: text };
    }
}

function createProvider(llmConfig: LLMConfig, enableResponseLog: boolean): LargeLanguageModelProvider | null {
    const thinkingLevel = String(llmConfig.enableThinking ?? '');
    const newProvider = (adapter: HttpLargeLanguageModelAdapter): LargeLanguageModelProvider => new CommonHttpLargeLanguageModelProvider(llmConfig, enableResponseLog, adapter);

    switch (llmConfig.llmProvider) {
        case OpenAILLMProvider:
            return newProvider(new OpenAIResponsesAdapter({
                url: 'https://api.openai.com/v1/responses',
                headers: { Authorization: 'Bearer ' + llmConfig.openAIAPIKey },
                modelId: llmConfig.openAIModelID,
            }, thinkingLevel));
        case OpenAICompatibleLLMProvider:
            return newProvider(new OpenAIChatCompletionsAdapter({
                url: ensureTrailingSlash(llmConfig.openAICompatibleBaseURL) + 'chat/completions',
                headers: llmConfig.openAICompatibleAPIKey !== '' ? { Authorization: 'Bearer ' + llmConfig.openAICompatibleAPIKey } : {},
                modelId: llmConfig.openAICompatibleModelID,
            }, thinkingLevel));
        case OpenAIResponsesCompatibleLLMProvider:
            return newProvider(new OpenAIResponsesAdapter({
                url: ensureTrailingSlash(llmConfig.openAICompatibleBaseURL) + 'responses',
                headers: llmConfig.openAICompatibleAPIKey !== '' ? { Authorization: 'Bearer ' + llmConfig.openAICompatibleAPIKey } : {},
                modelId: llmConfig.openAICompatibleModelID,
            }, thinkingLevel));
        case AnthropicLLMProvider:
            return newProvider(new AnthropicMessagesAdapter({
                url: 'https://api.anthropic.com/v1/messages',
                headers: { 'anthropic-version': '2023-06-01', 'X-Api-Key': llmConfig.anthropicAPIKey },
                modelId: llmConfig.anthropicModelID,
                maxTokens: llmConfig.anthropicMaxTokens,
                thinkingBudgetTokens: llmConfig.anthropicThinkingBudgetTokens,
            }, thinkingLevel));
        case AnthropicCompatibleLLMProvider: {
            const headers: Record<string, string> = {};

            if (llmConfig.anthropicCompatibleAPIVersion !== '') {
                headers['anthropic-version'] = llmConfig.anthropicCompatibleAPIVersion;
            }

            if (llmConfig.anthropicCompatibleAPIKey !== '') {
                headers['X-Api-Key'] = llmConfig.anthropicCompatibleAPIKey;
            }

            return newProvider(new AnthropicMessagesAdapter({
                url: ensureTrailingSlash(llmConfig.anthropicCompatibleBaseURL) + 'messages',
                headers: headers,
                modelId: llmConfig.anthropicCompatibleModelID,
                maxTokens: llmConfig.anthropicCompatibleMaxTokens,
                thinkingBudgetTokens: llmConfig.anthropicCompatibleThinkingBudgetTokens,
            }, thinkingLevel));
        }
        case OpenRouterLLMProvider:
            return newProvider(new OpenAIChatCompletionsAdapter({
                url: 'https://openrouter.ai/api/v1/chat/completions',
                headers: {
                    'Authorization': 'Bearer ' + llmConfig.openRouterAPIKey,
                    'HTTP-Referer': 'https://ezbookkeeping.mayswind.net/',
                    'X-Title': ApplicationName,
                },
                modelId: llmConfig.openRouterModelID,
            }, thinkingLevel));
        case OllamaLLMProvider:
            return newProvider(new OllamaAdapter(llmConfig.ollamaServerURL, llmConfig.ollamaModelID, thinkingLevel));
        case LMStudioLLMProvider:
            return newProvider(new LMStudioAdapter(llmConfig.lmStudioServerURL, llmConfig.lmStudioToken, llmConfig.lmStudioModelID, thinkingLevel));
        case GoogleAILLMProvider:
            return newProvider(new GoogleAIAdapter(llmConfig.googleAIAPIKey, llmConfig.googleAIModelID, thinkingLevel));
        case '':
            return null;
    }

    throw errs.ErrInvalidLLMProvider;
}

class LargeLanguageModelProviderContainer {
    public textRecognitionCurrentProvider: LargeLanguageModelProvider | null = null;
    public receiptImageRecognitionCurrentProvider: LargeLanguageModelProvider | null = null;

    // getJsonResponseByTextRecognitionModel returns the json response from the text recognition model
    public async getJsonResponseByTextRecognitionModel(c: Context, uid: bigint, currentConfig: Config, request: LargeLanguageModelRequest): Promise<LargeLanguageModelTextualResponse> {
        if (!currentConfig.textRecognitionLLMConfig || !this.textRecognitionCurrentProvider) {
            throw errs.ErrInvalidLLMProvider;
        }

        return this.textRecognitionCurrentProvider.getJsonResponse(c, uid, currentConfig.textRecognitionLLMConfig, request);
    }

    // getJsonResponseByReceiptImageRecognitionModel returns the json response from the receipt image recognition model
    public async getJsonResponseByReceiptImageRecognitionModel(c: Context, uid: bigint, currentConfig: Config, request: LargeLanguageModelRequest): Promise<LargeLanguageModelTextualResponse> {
        if (!currentConfig.receiptImageRecognitionLLMConfig || !this.receiptImageRecognitionCurrentProvider) {
            throw errs.ErrInvalidLLMProvider;
        }

        return this.receiptImageRecognitionCurrentProvider.getJsonResponse(c, uid, currentConfig.receiptImageRecognitionLLMConfig, request);
    }
}

export const Container = new LargeLanguageModelProviderContainer();

// initializeLargeLanguageModelProvider initializes the large language model providers according to the config
export function initializeLargeLanguageModelProvider(config: Config): void {
    if (config.textRecognitionLLMConfig) {
        Container.textRecognitionCurrentProvider = createProvider(config.textRecognitionLLMConfig, config.enableDebugLog);
    }

    if (config.receiptImageRecognitionLLMConfig) {
        Container.receiptImageRecognitionCurrentProvider = createProvider(config.receiptImageRecognitionLLMConfig, config.enableDebugLog);
    }
}
