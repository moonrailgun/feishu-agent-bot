/**
 * 聊天控制器
 * Chat Controller
 *
 * 功能说明:
 * - 处理来自不同聊天提供者的消息
 * - 管理用户认证流程
 * - 协调代理服务和上下文服务
 * - 处理特殊命令（如清除上下文）
 *
 * Features:
 * - Handle messages from different chat providers
 * - Manage user authentication flow
 * - Coordinate agent service and context service
 * - Handle special commands (like clearing context)
 */

import { AgentService } from '../service/agent';
import { ContextService } from '../service/context';
import { ChatProvider } from '../provider/type';
import { Express } from 'express';
import { generateLarkCardMessageWithElements } from '../provider/lark';
import { larkService } from '../service/lark';

/**
 * 聊天控制器类
 * Chat Controller Class
 * 负责协调多个聊天提供者的消息处理逻辑
 * Responsible for coordinating message processing logic across multiple chat providers
 */
export class ChatController {
  /**
   * 构造函数
   * Constructor
   * @param providers 聊天 Provider 数组 / Array of chat providers
   */
  constructor(private readonly providers: ChatProvider[]) {}

  /**
   * 注册所有聊天提供者的事件监听器和路由
   * Register event listeners and routes for all chat providers
   * @param app Express应用实例 / Express application instance
   */
  register(app: Express) {
    for (const provider of this.providers) {
      /**
       * 注册消息接收事件处理器
       * Register message receive event handler
       * 当收到用户消息时触发
       * Triggered when receiving user messages
       */
      provider.registerMessageReceiveEvent(
        app,
        async ({
          userId,
          chatId,
          query,
          isGroup,
        }: {
          userId: string;
          chatId: string;
          query: string;
          isGroup: boolean;
        }) => {
          const agentService = AgentService.getUserAgentService(userId, provider);
          const contextService = ContextService.getUserContextService(userId);

          // if (query.startsWith('/test')) {
          //   await larkService.sendCardMessage(
          //     chatId,
          //     generateLarkCardMessageWithElements([
          //       {
          //         tag: 'collapsible_panel',
          //         element_id: 'custom_id',
          //         header: {
          //           title: {
          //             tag: 'markdown',
          //             content: 'foo',
          //           },
          //         },
          //         elements: [
          //           {
          //             tag: 'markdown',
          //             content: `\`\`\`\n${JSON.stringify({ foo: 'bar' }, null, 2)}\n\`\`\``,
          //           },
          //         ],
          //       },
          //     ])
          //     // {
          //     //   schema: '2.0', // 卡片 JSON 结构的版本。默认为 1.0。要使用 JSON 2.0 结构，必须显示声明 2.0。
          //     //   body: {
          //     //     elements: [
          //     //       {
          //     //         tag: 'collapsible_panel', // 折叠面板的标签。
          //     //         element_id: 'custom_id', // 操作组件的唯一标识。JSON 2.0 新增属性。用于在调用组件相关接口中指定组件。需开发者自定义。
          //     //         header: {
          //     //           // 折叠面板的标题设置。
          //     //           title: {
          //     //             // 标题文本设置。支持 plain_text 和 markdown。
          //     //             tag: 'markdown',
          //     //             content: '**面板标题文本**',
          //     //           },
          //     //         },
          //     //         border: {
          //     //           // 边框设置。默认不显示边框。
          //     //           color: 'grey', // 边框的颜色。
          //     //           corner_radius: '5px', // 圆角设置。
          //     //         },
          //     //         elements: [
          //     //           // 此处可添加各个组件的 JSON 结构。暂不支持表单（form）组件。
          //     //           {
          //     //             tag: 'markdown',
          //     //             content: '很长的文本',
          //     //           },
          //     //         ],
          //     //       },
          //     //     ],
          //     //   },
          //     // }
          //   );
          //   return;
          // }

          /**
           * 处理清除上下文命令
           * Handle clear context command
           * 用户发送 /clear 命令时清除聊天历史
           * Clear chat history when user sends /clear command
           */
          if (query.startsWith('/clear')) {
            contextService.cleanMessage();
            await provider.sendMessage(chatId, '成功清除用户上下文');
            return;
          }

          /**
           * 检查用户登录状态
           * Check user login status
           * 未登录用户需要先完成授权流程
           * Unauthorized users need to complete authorization flow first
           */
          let loginMessageId: string | undefined;
          if (!contextService.isLogin) {
            // 发送登录链接给用户
            // Send login link to user
            const { messageId } = await provider.sendMessage(
              chatId,
              `请点击 [此处](${provider.authorizeUrl}) 授权访问`
            );

            // 等待用户完成登录（最多等待5分钟）
            // Wait for user to complete login (up to 5 minutes)
            const success = await contextService.waitLogin();
            if (!success) {
              await provider.updateMessage(messageId, '登录超时，请重试');
              return;
            }

            loginMessageId = messageId;
          }

          /**
           * 生成AI响应
           * Generate AI response
           * 用户已登录，开始处理消息并生成智能回复
           * User is logged in, start processing message and generate intelligent response
           */
          await agentService.generateResponse({ chatId, query, replacedMessageId: loginMessageId, isGroup });
        }
      );

      /**
       * 注册授权回调处理器
       * Register authorization callback handler
       * 处理用户完成OAuth授权后的回调
       * Handle callback after user completes OAuth authorization
       */
      provider.registerAuthCallback(app, async authInfo => {
        // 获取用户上下文服务并添加认证令牌
        // Get user context service and add auth token
        const contextService = ContextService.getUserContextService(authInfo.userId);
        contextService.addAuthToken(authInfo);
      });
    }
  }
}
