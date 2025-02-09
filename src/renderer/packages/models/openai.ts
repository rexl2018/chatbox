import { Message } from 'src/shared/types'
import { ApiError, ChatboxAIAPIError } from './errors'
import Base, { onResultChange } from './base'
import { ElectronIPC } from '../../../shared/electron-types'

interface Options {
    openaiKey: string
    apiHost: string
    apiPath?: string
    model: Model | 'custom-model'
    azureOpenAiModel?: string
    openaiCustomModel?: string
    openaiReasoningEffort: string
    temperature: number
    topP: number
}

export default class OpenAI extends Base {
    public name = 'OpenAI'

    public options: Options
    constructor(options: Options) {
        super()
        this.options = options
        if (this.options.apiHost && this.options.apiHost.trim().length === 0) {
            this.options.apiHost = 'https://api.openai.com'
        }
        if (this.options.apiHost && this.options.apiHost.startsWith('https://openrouter.ai/api/v1')) {
            this.options.apiHost = 'https://openrouter.ai/api'
        }
        if (this.options.apiPath && !this.options.apiPath.startsWith('/')) {
            this.options.apiPath = '/' + this.options.apiPath
        }
        if (this.options.apiHost && this.options.apiHost.includes('.openai.azure.com')) {
            if (this.options.azureOpenAiModel && this.options.azureOpenAiModel !== '') {
                const modelName = this.options.azureOpenAiModel
                this.options.apiPath = `/openai/deployments/${modelName}/chat/completions?api-version=2024-02-15-preview`
            } else {
                this.options.apiPath = ''
            }
        } 
    }

    async callChatCompletion(rawMessages: Message[], signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        try {
            return await this._callChatCompletion(rawMessages, signal, onResultChange)
        } catch (e) {
            if (e instanceof ApiError && e.message.includes('Invalid content type. image_url is only supported by certain models.')) {
                throw ChatboxAIAPIError.fromCodeName('model_not_support_image', 'model_not_support_image')
            }
            throw e
        }
    }

    async _callChatCompletion(rawMessages: Message[], signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        const model = this.options.model === 'custom-model'
            ? this.options.openaiCustomModel || ''
            : this.options.model

        rawMessages = injectModelSystemPrompt(model, rawMessages)

        // o1-mini and o1-preview does not support reasoning unlike o1 relase
        if (model.startsWith('o1-mini') || model.startsWith('o1-preview')) {
            const messages = await populateReasoningMessage(rawMessages)
            return this.requestChatCompletionsNotStream({
                model, 
                messages,
            }, signal, onResultChange)
        }

        // https://platform.openai.com/docs/guides/reasoning
        if (model.startsWith('o')) {
            const messages = await populateReasoningMessage(rawMessages)
            return this.requestChatCompletionsNotStream({
                model, 
                messages,
                reasoning_effort: this.options.openaiReasoningEffort,
            }, signal, onResultChange)
        }

        const messages = await populateGPTMessage(rawMessages)
        return this.requestChatCompletionsStream({
            messages,
            model,
            // vision 模型的默认 max_tokens 极低，基本很难回答完整，因此手动设置为模型最大值
            max_tokens: this.options.model === 'gpt-4-vision-preview'
                ? openaiModelConfigs['gpt-4-vision-preview'].maxTokens
                : undefined,
            temperature: this.options.temperature,
            top_p: this.options.topP,
            stream: true,
        }, signal, onResultChange)
    }

    async requestChatCompletionsStream(requestBody: Record<string, any>, signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        const apiPath = this.options.apiPath || '/v1/chat/completions'
        const response = await this.post(
            `${this.options.apiHost}${apiPath}`,
            await this.getHeaders(),
            requestBody,
            signal
        )
        let result = ''
        await this.handleSSE(response, (message) => {
            if (message === '[DONE]') {
                return
            }
            const data = JSON.parse(message)
            if (data.error) {
                throw new ApiError(`Error from OpenAI: ${JSON.stringify(data)}`)
            }
            const text = data.choices[0]?.delta?.content
            if (text !== undefined) {
                result += text
                if (onResultChange) {
                    onResultChange(result)
                }
            }
        })
        return result
    }

    async requestChatCompletionsNotStream(requestBody: Record<string, any>, signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        const apiPath = this.options.apiPath || '/v1/chat/completions'
        const response = await this.post(
            `${this.options.apiHost}${apiPath}`,
            await this.getHeaders(),
            requestBody,
            signal
        )
        const json = await response.json()
        if (json.error) {
            throw new ApiError(`Error from OpenAI: ${JSON.stringify(json)}`)
        }
        if (onResultChange) {
            onResultChange(json.choices[0].message.content)
        }
        return json.choices[0].message.content
    }


    async getHeaders() {
        let token = this.options.openaiKey
        if (token === undefined || token === '') {
            const ipc: ElectronIPC = window.electronAPI!!
            token = await ipc.invoke('getAccessToken')
        }
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            'api-key': `${token}`,
            'Content-Type': 'application/json',
        }
        if (this.options.apiHost.includes('openrouter.ai')) {
            headers['HTTP-Referer'] = 'https://chatboxai.app'
            headers['X-Title'] = 'Chatbox AI'
        }
        return headers
    }

}

// Ref: https://platform.openai.com/docs/models/gpt-4
export const openaiModelConfigs = {
    'DeepSeek-R1': {
        maxTokens: 8192,
        maxContextTokens: 128_000,
    },
    'gpt-3.5-turbo': {
        maxTokens: 4096,
        maxContextTokens: 16_385,
    },
    'gpt-3.5-turbo-16k': {
        maxTokens: 4096,
        maxContextTokens: 16_385,
    },
    'gpt-3.5-turbo-1106': {
        maxTokens: 4096,
        maxContextTokens: 16_385,
    },
    'gpt-3.5-turbo-0125': {
        maxTokens: 4096,
        maxContextTokens: 16_385,
    },
    'gpt-3.5-turbo-0613': {
        maxTokens: 4096,
        maxContextTokens: 4_096,
    },
    'gpt-3.5-turbo-16k-0613': {
        maxTokens: 4096,
        maxContextTokens: 16_385,
    },

    'gpt-4o-mini': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4o-mini-2024-07-18': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },

    'gpt-4o': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4o-2024-05-13': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4o-2024-08-06': {
        maxTokens: 16_384,
        maxContextTokens: 128_000,
    },
    'gpt-4o-2024-11-20': {
        maxTokens: 16_384,
        maxContextTokens: 128_000,
    },
    'chatgpt-4o-latest': {
        maxTokens: 16_384,
        maxContextTokens: 128_000,
    },

    // https://platform.openai.com/docs/models#o1
    'o1': {
        maxTokens: 100_000,
        maxContextTokens: 200_000,
    },
    'o1-2024-12-17': {
        maxTokens: 100_000,
        maxContextTokens: 200_000,
    },
    'o1-preview': {
        maxTokens: 32_768,
        maxContextTokens: 128_000,
    },
    'o1-preview-2024-09-12': {
        maxTokens: 32_768,
        maxContextTokens: 128_000,
    },
    'o1-mini': {
        maxTokens: 65_536,
        maxContextTokens: 128_000,
    },
    'o1-mini-2024-09-12': {
        maxTokens: 65_536,
        maxContextTokens: 128_000,
    },

    // https://platform.openai.com/docs/models#o3-mini
    'o3-mini': {
        maxTokens: 100_000,
        maxContextTokens: 200_000,
    },
    'o3-mini-2025-01-31': {
        maxTokens: 100_000,
        maxContextTokens: 200_000,
    },

    'gpt-4': {
        maxTokens: 4_096,
        maxContextTokens: 8_192,
    },
    'gpt-4-turbo': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4-turbo-2024-04-09': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4-0613': {
        maxTokens: 4_096,
        maxContextTokens: 8_192,
    },
    'gpt-4-32k': {
        maxTokens: 4_096,
        maxContextTokens: 32_768,
    },
    'gpt-4-32k-0613': {
        maxTokens: 4_096,
        maxContextTokens: 32_768,
    },
    'gpt-4-1106-preview': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4-0125-preview': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4-turbo-preview': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },
    'gpt-4-vision-preview': {
        maxTokens: 4_096,
        maxContextTokens: 128_000,
    },

    // https://platform.openai.com/docs/models/continuous-model-upgrades
    'gpt-3.5-turbo-0301': {
        maxTokens: 4096,
        maxContextTokens: 4096,
    },
    'gpt-4-0314': {
        maxTokens: 4096,
        maxContextTokens: 8192,
    },
    'gpt-4-32k-0314': {
        maxTokens: 4096,
        maxContextTokens: 32768,
    },
}
export type Model = keyof typeof openaiModelConfigs
export const models = Array.from(Object.keys(openaiModelConfigs)).sort() as Model[]

export async function populateGPTMessage(rawMessages: Message[]): Promise<OpenAIMessage[]> {
    const messages: OpenAIMessage[] = rawMessages.map((m) => ({
        role: m.role,
        content: m.content,
    }))
    return messages
}

export async function populateReasoningMessage(rawMessages: Message[]): Promise<OpenAIMessage[]> {
    const messages: OpenAIMessage[] = rawMessages.map((m) => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content,
    }))
    return messages
}

export function injectModelSystemPrompt(model: string, messages: Message[]) {
    const metadataPrompt = `
Current model: ${model}
Current date: ${new Date().toISOString()}

`
    let hasInjected = false
    return messages.map((m) => {
        if (m.role === 'system' && !hasInjected) {
            m = { ...m }
            m.content = metadataPrompt + m.content
            hasInjected = true
        }
        return m
    })
}

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
    name?: string
}
