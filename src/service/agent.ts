/**
 * AI代理服务
 * AI Agent Service
 *
 * 功能说明:
 * - 管理AI模型的对话生成
 * - 处理工具调用和结果
 * - 实现流式响应更新
 * - 管理用户会话状态
 *
 * Features:
 * - Manage AI model conversation generation
 * - Handle tool calls and results
 * - Implement streaming response updates
 * - Manage user session state
 */

import { streamText, Tool, tool } from 'ai';
import { z } from 'zod';
import { config } from '../config';
import { ContextService } from './context';
import { ChatProvider, Message } from '../provider/type';
import { pThrottle } from '../util';
import { getSystemPrompt } from '../prompt';
import { AgentCoreMessage, parseChunk2Message } from '../util/message';
import { generateImage, ImageGenerationModel, AspectRatio } from '../util/image';
import { larkService } from './lark';

/**
 * AI代理服务类
 * AI Agent Service Class
 * 为每个用户提供独立的AI对话管理
 * Provides independent AI conversation management for each user
 */
export class AgentService {
  /**
   * 用户代理服务实例缓存
   * User agent service instance cache
   * 键为用户ID，值为对应的代理服务实例
   * Key is user ID, value is corresponding agent service instance
   */
  private static agentServices = new Map<string, AgentService>();

  /**
   * 获取用户专属的代理服务实例（单例模式）
   * Get user-specific agent service instance (singleton pattern)
   * @param userId 用户ID / User ID
   * @param provider 聊天提供者 / Chat provider
   * @returns 代理服务实例 / Agent service instance
   */
  static getUserAgentService(userId: string, provider: ChatProvider) {
    if (this.agentServices.has(userId)) {
      return this.agentServices.get(userId)!;
    }
    const agentService = new AgentService(userId, provider);
    this.agentServices.set(userId, agentService);
    return agentService;
  }

  /** 用户上下文服务实例 / User context service instance */
  private contextService: ContextService;

  /** 聊天提供者实例 / Chat provider instance */
  private provider: ChatProvider;

  /** 标记是否正在运行AI生成任务 / Flag indicating if AI generation task is running */
  private isRunning: boolean = false;

  /**
   * 构造函数
   * Constructor
   * @param userId 用户ID / User ID
   * @param provider 聊天提供者 / Chat provider
   */
  constructor(private readonly userId: string, provider: ChatProvider) {
    this.contextService = ContextService.getUserContextService(userId);
    this.provider = provider;
  }

  /**
   * 节流的消息更新函数
   * Throttled message update function
   * 限制更新频率为每200ms一次，防止过于频繁的API调用
   * Limit update frequency to once per 200ms to prevent excessive API calls
   */
  throttledUpdateMessage = pThrottle(async (messageId: string, message: Message): Promise<void> => {
    return await this.provider.updateMessage(messageId, message);
  }, 200);

  async getTools(chatId: string, isGroup: boolean) {
    const userContext = await this.contextService.mustGetContext();

    let tools: Record<string, Tool> = {};

    // 工具集合，从所有MCP客户端收集
    // Tool collection, gathered from all MCP clients
    if (!isGroup) {
      for (const mcpClient of userContext.mcpClients) {
        const mcpTools = await mcpClient.tools();
        tools = { ...tools, ...mcpTools };
      }
    }

    // Add image generation tool for all chats
    tools.generateImage = tool({
      description:
        'Generate an image based on a text prompt. Supports multiple models and aspect ratios. If success, the image keys will be returned. Image will direct render in the message. and current not support continue to modify it.',
      parameters: z.object({
        prompt: z.string().describe('The text prompt describing the image to generate'),
        model: z
          .enum(['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'midjourney', 'zimage', 'seedream-4-5-251128'])
          .optional()
          .default('gemini-2.5-flash-image')
          .describe('The image generation model to use. Default: gemini-3-pro-image-preview'),
        aspectRatio: z
          .enum(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'])
          .optional()
          .describe('The aspect ratio of the generated image. Default: 1:1'),
        temperature: z
          .number()
          .min(0)
          .max(2)
          .default(0.7)
          .optional()
          .describe('Controls randomness in generation. Range: 0.1-2. Default: 0.7'),
        // width: z
        //   .number()
        //   .min(256)
        //   .max(2048)
        //   .optional()
        //   .describe('Image width (must be multiple of 16, between 256-2048)'),
        // height: z
        //   .number()
        //   .min(256)
        //   .max(2048)
        //   .optional()
        //   .describe('Image height (must be multiple of 16, between 256-2048)'),
      }),
      execute: async ({
        prompt,
        model,
        aspectRatio,
        temperature,
        // width,
        // height,
      }) => {
        const result = await generateImage({
          prompt,
          // model: model || 'gemini-3-pro-image-preview',
          model: model || 'gemini-2.5-flash-image',
          aspect_ratio: aspectRatio || '1:1',
          temperature,
          // width,
          // height,
        });

        if (!result.success) {
          return {
            error: result.error || 'Failed to generate image',
          };
        }

        const imageUrls = result.imageUrls;
        if (imageUrls) {
          const images = await Promise.all(imageUrls.map(url => larkService.uploadImageFromUrl(url, 'message')));

          return {
            success: true,
            imageUrls: imageUrls,
            imageKeys: images.map(image => image?.image_key).filter(Boolean),
          };
        }

        return {
          success: true,
          imageUrls: [],
          imageKeys: [],
        };
      },
    });

    // Add update group info tool for group chats
    if (isGroup) {
      tools.updateGroupInfo = tool({
        description:
          'Update group chat information including name, description, and avatar. This tool can only be used in group chats.',
        parameters: z.object({
          name: z.string().optional().describe('New group name'),
          description: z.string().optional().describe('New group description'),
          avatarUrl: z
            .string()
            .optional()
            .describe('URL of the new group avatar image. Will be uploaded and set as group avatar.'),
        }),
        execute: async ({ name, description, avatarUrl }) => {
          try {
            const updateParams: { name?: string; description?: string; avatar?: string } = {};

            if (name) {
              updateParams.name = name;
            }

            if (description) {
              updateParams.description = description;
            }

            if (avatarUrl) {
              const uploadResult = await larkService.uploadImageFromUrl(avatarUrl, 'avatar');
              if (uploadResult?.image_key) {
                updateParams.avatar = uploadResult.image_key;
              } else {
                return {
                  success: false,
                  error: 'Failed to upload avatar image',
                };
              }
            }

            if (Object.keys(updateParams).length === 0) {
              return {
                success: false,
                error: 'At least one parameter (name, description, or avatarUrl) must be provided',
              };
            }

            await larkService.updateChatInfo(chatId, updateParams);

            return {
              success: true,
              message: 'Group information updated successfully',
              updated: updateParams,
            };
          } catch (error) {
            console.error('Failed to update group info:', error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
              success: false,
              error: `Failed to update group information: ${errorMsg}`,
            };
          }
        },
      });
    }

    return tools;
  }

  /**
   * 生成AI响应
   * Generate AI response
   * @param chatId 聊天ID / Chat ID
   * @param query 用户查询 / User query
   */
  async generateResponse({
    chatId,
    query,
    replacedMessageId,
    isGroup,
  }: {
    chatId: string;
    query: string;
    replacedMessageId?: string;
    isGroup: boolean;
  }) {
    // 获取用户上下文信息
    // Get user context information
    const userContext = await this.contextService.mustGetContext();

    // 检查是否有任务正在执行（防止并发执行）
    // Check if any task is currently running (prevent concurrent execution)
    if (this.isRunning) {
      this.provider.sendMessage(chatId, '不能同时执行多个任务，请稍后再试');
      return;
    }

    // 将用户消息添加到上下文历史
    // Add user message to context history
    this.contextService.addMessage([{ role: 'user', content: query }]);

    this.isRunning = true;

    try {
      // 发送初始"思考中"消息并获取消息ID
      // Send initial "thinking" message and get message ID
      let messageId: string;
      if (replacedMessageId) {
        await this.provider.updateMessage(replacedMessageId, '思考中...');
        messageId = replacedMessageId;
      } else {
        const { messageId: _messageId } = await this.provider.sendMessage(chatId, '思考中...');
        messageId = _messageId;
      }

      // 临时消息数组，用于流式更新
      // Temporary message array for streaming updates
      let tempMessages: AgentCoreMessage[] = [];

      const tools = await this.getTools(chatId, isGroup);

      for (const tool of Object.values(tools)) {
        const originExec = tool.execute;
        if (originExec) {
          tool.execute = (async (...args) => {
            try {
              return await originExec(...args);
            } catch (error) {
              console.error(error);
              return error;
            }
          }) as typeof tool.execute;
        }
      }

      console.log('处理用户请求:', query);
      // 开始流式文本生成
      // Start streaming text generation
      const stream = streamText({
        model: config.agent.model,
        temperature: config.agent.model.modelId === 'gpt-5' ? 1 : 0,

        // 系统提示词
        // System prompt
        system: getSystemPrompt(this.userId, chatId),

        // 对话历史消息
        // Conversation history messages
        messages: userContext.coreMessages,

        // 最大执行步数
        // Maximum execution steps
        maxSteps: config.agent.maxStep,
        tools,

        /**
         * 流式响应处理器
         * Streaming response handler
         * 在每个数据块到达时更新消息显示
         * Update message display when each data chunk arrives
         */
        onChunk: chunk => {
          tempMessages = parseChunk2Message(tempMessages, chunk);
          this.throttledUpdateMessage(messageId, tempMessages);
        },

        /**
         * 步骤完成处理器
         * Step completion handler
         * 在每个执行步骤完成时保存消息到上下文
         * Save messages to context when each execution step completes
         */
        onStepFinish: step => {
          const messages = step.response.messages;
          this.contextService.addMessage(messages);
          try {
            this.provider.updateMessage(messageId, messages);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('更新消息失败:', error);
            this.provider.sendMessage(chatId, `发生错误，请重试:\n${errorMsg}`);
          }
        },

        /**
         * 错误处理器
         * Error handler
         * 处理生成过程中的异常情况
         * Handle exceptions during generation process
         */
        onError: e => {
          console.error('AI生成错误:', e);
          this.isRunning = false;

          // Extract concise error message
          let errorMsg = 'Unknown error';
          if (e instanceof Error) {
            errorMsg = e.message;
            // For API errors, try to extract more specific info
            if ('cause' in e && e.cause) {
              const cause = e.cause as any;
              if (cause.message) {
                errorMsg = cause.message;
              }
            }
          } else if (typeof e === 'object' && e !== null) {
            if ('message' in e) {
              errorMsg = String(e.message);
            } else if ('error' in e) {
              errorMsg = String(e.error);
            }
          }

          this.provider.sendMessage(chatId, `AI处理失败，请稍后重试\n错误信息: ${errorMsg}`);
        },

        /**
         * 完成处理器
         * Completion handler
         * 清理临时状态，重置运行标志
         * Clean up temporary state, reset running flag
         */
        onFinish: () => {
          this.isRunning = false;
          console.log('处理用户请求完成');
          tempMessages = [];
        },
      });

      // 等待流式处理完成
      // Wait for streaming process to complete
      await stream.consumeStream();
    } finally {
      this.isRunning = false;
    }
  }
}
