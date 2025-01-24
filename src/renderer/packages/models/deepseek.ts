import { Message } from 'src/shared/types'
import { ApiError, ChatboxAIAPIError } from './errors'
import Base, { onResultChange } from './base'
import { log } from 'console'

interface Options {
    deepseekKey: string
    deepseekModel: DeepSeekModel

    temperature: number
    topP: number
}

export default class DeepSeek extends Base {
    public name = 'DeepSeek'

    public options: Options
    private apihost = 'https://api.deepseek.com'

    constructor(options: Options) {
        super()
        this.options = options
    }

    async callChatCompletion(rawMessages: Message[], signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        try {
            console.log("callChatCompletion=", rawMessages)
            return await this._callChatCompletion(rawMessages, signal, onResultChange)
        } catch (e) {
            if (e instanceof ApiError && e.message.includes('Invalid content type. image_url is only supported by certain models.')) {
                throw ChatboxAIAPIError.fromCodeName('model_not_support_image', 'model_not_support_image')
            }
            throw e
        }
    }

    async _callChatCompletion(rawMessages: Message[], signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        const model = this.options.deepseekModel

        rawMessages = injectModelSystemPrompt(model, rawMessages)
        const messages = await populateGPTMessage(rawMessages)
        return this.requestChatCompletionsStream({
            messages,
            model,
            max_tokens: deepseekModelConfigs[model].maxTokens,
            temperature: this.options.temperature,
            top_p: this.options.topP,
            stream: true,
        }, signal, onResultChange)
    }

    async requestChatCompletionsStream(requestBody: Record<string, any>, signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        const apiPath = '/v1/chat/completions'
        const response = await this.post(
            `${this.apihost}${apiPath}`,
            this.getHeaders(),
            requestBody,
            signal
        )

        let reasoning_result = ''
        let content_result = ''

        let result = ''

        await this.handleSSE(response, (message) => {
            if (message === '[DONE]') {
                return
            }
            const data = JSON.parse(message)
            if (data.error) {
                throw new ApiError(`Error from OpenAI: ${JSON.stringify(data)}`)
            }

            // reasoning_content是模型思考链输出
            // content是模型输出
            if (data.choices && Array.isArray(data.choices)) {
                data.choices.forEach((choice: any) => {
                    if (choice.delta && choice.delta.reasoning_content) {
                        reasoning_result += choice.delta.reasoning_content
                    }
                    if (choice.delta && choice.delta.content) {
                        content_result += choice.delta.content
                    }
                    if (onResultChange) {
                        result = "reasoning:" + reasoning_result
                        if(content_result.length > 0) {
                            result += "\n\ncontent:" + content_result
                        }
                        onResultChange(result)
                    }
                })
            }
        })
        return result
    }

    getHeaders() {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.options.deepseekKey}`,
            'Content-Type': 'application/json',
        }
        return headers
    }

}

// Ref: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
export const deepseekModelConfigs = {
    'deepseek-chat': {
        maxTokens: 8192,
        maxContextTokens: 65536,
    },
    'deepseek-reasoner': {
        maxTokens: 8192,
        maxContextTokens: 65536,
    },
}
export type DeepSeekModel = keyof typeof deepseekModelConfigs
export const deepseekmodels = Array.from(Object.keys(deepseekModelConfigs)).sort() as DeepSeekModel[]

export async function populateGPTMessage(rawMessages: Message[]): Promise<OpenAIMessage[]> {
    const messages: OpenAIMessage[] = rawMessages.map((m) => ({
        role: m.role,
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
