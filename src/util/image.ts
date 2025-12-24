/**
 * 图片生成工具函数
 * Image Generation Utility Functions
 *
 * 功能说明:
 * - 提供图片生成API调用封装
 * - 支持多种图片生成模型
 * - 支持image-to-image生成
 *
 * Features:
 * - Provide image generation API call wrapper
 * - Support multiple image generation models
 * - Support image-to-image generation
 */

/**
 * 支持的图片生成模型
 * Supported image generation models
 */
export type ImageGenerationModel =
  | 'gemini-2.5-flash-image'
  | 'gemini-3-pro-image-preview'
  | 'midjourney'
  | 'zimage'
  | 'seedream-4-5-251128';

/**
 * 支持的宽高比
 * Supported aspect ratios
 */
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

/**
 * 图片生成请求参数
 * Image generation request parameters
 */
export interface ImageGenerationRequest {
  prompt: string;
  images?: string[];
  model?: ImageGenerationModel;
  temperature?: number;
  aspect_ratio?: AspectRatio;
  width?: number;
  height?: number;
}

/**
 * 图片生成响应结果
 * Image generation response result
 */
export interface ImageGenerationResponse {
  success: boolean;
  imageUrls?: string[];
  error?: string;
}

/**
 * 图片生成服务配置
 * Image generation service configuration
 */
export interface ImageGenerationConfig {
  apiUrl?: string;
  authToken?: string;
  defaultModel?: ImageGenerationModel;
}

/**
 * 默认配置
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ImageGenerationConfig> = {
  apiUrl: `${process.env.IMAGE_GENERATION_API_URL}/api/image-generation/generate`,
  authToken: process.env.IMAGE_GENERATION_TOKEN || '',
  defaultModel: 'gemini-3-pro-image-preview',
};

/**
 * 图片生成工具类
 * Image generation utility class
 */
export class ImageGenerator {
  private config: Required<ImageGenerationConfig>;

  constructor(config?: ImageGenerationConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * 生成图片
   * Generate image
   *
   * @param request 图片生成请求参数 / Image generation request parameters
   * @returns 图片生成响应结果 / Image generation response result
   */
  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    try {
      const payload = {
        prompt: request.prompt,
        images: request.images,
        model: request.model || this.config.defaultModel,
        temperature: request.temperature || 0.7,
        aspect_ratio: request.aspect_ratio ?? '1:1',
        ...(request.width && { width: request.width }),
        ...(request.height && { height: request.height }),
      };

      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          accept: '*/*',
          'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          origin: 'https://tavern.yata.art',
          pragma: 'no-cache',
          priority: 'u=1, i',
          referer: 'https://tavern.yata.art/',
          'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          Authorization: `Bearer ${this.config.authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      console.log('image generation response:', data);

      return {
        success: true,
        imageUrls: data['image_urls'] || [],
      };
    } catch (error) {
      console.error('image generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * 从本地文件生成图片
   * Generate image from local file
   *
   * @param prompt 生成提示词 / Generation prompt
   * @param imagePath 本地图片路径 / Local image path
   * @param options 其他选项 / Other options
   * @returns 图片生成响应结果 / Image generation response result
   */
  async generateFromFile(
    prompt: string,
    imagePath: string,
    options?: Partial<ImageGenerationRequest>
  ): Promise<ImageGenerationResponse> {
    try {
      const fs = await import('fs/promises');
      const imageBuffer = await fs.readFile(imagePath);
      const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      return this.generate({
        prompt,
        images: [imageBase64],
        ...options,
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read image file',
      };
    }
  }

  /**
   * 从URL生成图片
   * Generate image from URL
   *
   * @param prompt 生成提示词 / Generation prompt
   * @param imageUrl 图片URL / Image URL
   * @param options 其他选项 / Other options
   * @returns 图片生成响应结果 / Image generation response result
   */
  async generateFromUrl(
    prompt: string,
    imageUrl: string,
    options?: Partial<ImageGenerationRequest>
  ): Promise<ImageGenerationResponse> {
    return this.generate({
      prompt,
      images: [imageUrl],
      ...options,
    });
  }

  /**
   * 验证宽度和高度参数
   * Validate width and height parameters
   *
   * @param width 宽度 / Width
   * @param height 高度 / Height
   * @returns 是否有效 / Whether valid
   */
  static validateDimensions(width?: number, height?: number): boolean {
    if (width !== undefined) {
      if (width < 256 || width > 2048 || width % 16 !== 0) {
        return false;
      }
    }
    if (height !== undefined) {
      if (height < 256 || height > 2048 || height % 16 !== 0) {
        return false;
      }
    }
    return true;
  }
}

/**
 * 创建默认的图片生成器实例
 * Create default image generator instance
 */
export const defaultImageGenerator = new ImageGenerator();

/**
 * 快捷方法：生成图片
 * Shortcut method: Generate image
 */
export const generateImage = (request: ImageGenerationRequest) => defaultImageGenerator.generate(request);

/**
 * 快捷方法：从文件生成图片
 * Shortcut method: Generate image from file
 */
export const generateImageFromFile = (prompt: string, imagePath: string, options?: Partial<ImageGenerationRequest>) =>
  defaultImageGenerator.generateFromFile(prompt, imagePath, options);

/**
 * 快捷方法：从URL生成图片
 * Shortcut method: Generate image from URL
 */
export const generateImageFromUrl = (prompt: string, imageUrl: string, options?: Partial<ImageGenerationRequest>) =>
  defaultImageGenerator.generateFromUrl(prompt, imageUrl, options);
