/**
 * Redis Service
 *
 * Features:
 * - Manage Redis connection using ioredis
 * - Provide type-safe token storage and retrieval
 * - Handle token expiration with TTL
 * - Error handling and reconnection logic
 */

import Redis from 'ioredis';
import { config } from '../config';
import { AuthToken } from './context';

/**
 * Redis Service Class
 * Provides Redis operations for auth token management
 */
export class RedisService {
  private static client: Redis;

  /**
   * Get Redis client instance (singleton)
   * Initialize on first access
   */
  private static getClient(): Redis {
    if (!this.client) {
      const redisUrl = config.redis.url;

      if (!redisUrl) {
        console.warn('⚠️ REDIS_URL not configured, creating Redis client with default settings');
        this.client = new Redis({
          host: 'localhost',
          port: 6379,
          retryStrategy: times => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          maxRetriesPerRequest: 3,
        });
      } else {
        this.client = new Redis(redisUrl, {
          retryStrategy: times => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          maxRetriesPerRequest: 3,
        });
      }

      this.client.on('error', err => {
        console.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        console.log('✅ Redis connected successfully');
      });

      this.client.on('ready', () => {
        console.log('✅ Redis client ready');
      });

      this.client.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
      });
    }

    return this.client;
  }

  /**
   * Generate Redis key for user auth token
   * @param userId User ID
   * @returns Redis key string
   */
  private static getTokenKey(userId: string): string {
    return `auth:token:${userId}`;
  }

  /**
   * Calculate TTL (Time To Live) in seconds from expiresAt timestamp
   * @param expiresAt Expiration timestamp in milliseconds
   * @returns TTL in seconds, or null if already expired
   */
  private static calculateTTL(expiresAt: number): number | null {
    const now = Date.now();
    const ttlMs = expiresAt - now;

    if (ttlMs <= 0) {
      return null;
    }

    return Math.floor(ttlMs / 1000);
  }

  /**
   * Store auth token in Redis with automatic expiration
   * @param userId User ID
   * @param authToken Authentication token
   * @returns Promise<boolean> Success status
   */
  static async setAuthToken(userId: string, authToken: AuthToken): Promise<boolean> {
    try {
      const client = this.getClient();
      const key = this.getTokenKey(userId);
      const value = JSON.stringify(authToken);

      const ttl = this.calculateTTL(authToken.expiresAt);

      if (ttl === null || ttl <= 0) {
        console.warn(`⚠️ Token for user ${userId} is already expired, not storing`);
        return false;
      }

      await client.setex(key, ttl, value);
      console.log(`✅ Stored auth token for user ${userId}, TTL: ${ttl}s`);
      return true;
    } catch (error) {
      console.error('Error storing auth token:', error);
      return false;
    }
  }

  /**
   * Retrieve auth token from Redis
   * @param userId User ID
   * @returns Promise<AuthToken | null> Auth token or null if not found/expired
   */
  static async getAuthToken(userId: string): Promise<AuthToken | null> {
    try {
      const client = this.getClient();
      const key = this.getTokenKey(userId);
      const value = await client.get(key);

      if (!value) {
        return null;
      }

      const authToken = JSON.parse(value) as AuthToken;

      // Double check expiration
      if (authToken.expiresAt <= Date.now()) {
        await this.deleteAuthToken(userId);
        return null;
      }

      return authToken;
    } catch (error) {
      console.error('Error retrieving auth token:', error);
      return null;
    }
  }

  /**
   * Delete auth token from Redis
   * @param userId User ID
   * @returns Promise<boolean> Success status
   */
  static async deleteAuthToken(userId: string): Promise<boolean> {
    try {
      const client = this.getClient();
      const key = this.getTokenKey(userId);
      await client.del(key);
      console.log(`🗑️ Deleted auth token for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error deleting auth token:', error);
      return false;
    }
  }

  /**
   * Check if auth token exists for user
   * @param userId User ID
   * @returns Promise<boolean> Existence status
   */
  static async hasAuthToken(userId: string): Promise<boolean> {
    try {
      const client = this.getClient();
      const key = this.getTokenKey(userId);
      const exists = await client.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('Error checking auth token existence:', error);
      return false;
    }
  }

  /**
   * Close Redis connection
   * Should be called on application shutdown
   */
  static async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      console.log('👋 Redis connection closed');
    }
  }
}
