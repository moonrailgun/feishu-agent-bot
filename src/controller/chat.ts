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
           * 处理用户登录命令
           * Handle user login command
           * 用户发送 /login 命令时弹出授权提示
           * Show authorization prompt when user sends /login command
           */
          if (query.startsWith('/login')) {
            const isLogin = await contextService.isLogin();
            if (isLogin) {
              await provider.sendMessage(chatId, '你已经登录了，无需重复登录');
              return;
            }

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

            await provider.updateMessage(messageId, '登录成功！现在你可以使用完整的功能了');
            return;
          }

          /**
           * 处理查看用户信息命令
           * Handle whoami command
           * 用户发送 /whoami 命令时显示当前用户信息
           * Show current user information when user sends /whoami command
           */
          if (query.startsWith('/whoami')) {
            const userInfo = await contextService.getUserInfo();
            if (!userInfo) {
              await provider.sendMessage(chatId, '你还未登录，请先使用 /login 命令登录');
              return;
            }

            const infoText =
              `**用户信息**\n\n` +
              `用户ID: ${userId}\n` +
              `当前chat: ${chatId}\n` +
              `名称: ${userInfo.name || '未知'}\n` +
              `英文名: ${userInfo.en_name || '未知'}\n` +
              `登录状态: 已登录`;

            await provider.sendMessage(chatId, infoText);
            return;
          }

          /**
           * 生成AI响应
           * Generate AI response
           * 开始处理消息并生成智能回复
           * Start processing message and generate intelligent response
           */
          await agentService.generateResponse({ chatId, query, isGroup });
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
