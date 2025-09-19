import fs from 'fs';
import yaml from 'yaml';

/**
 * Wordle游戏数据存储模块
 * 负责游戏数据的存取、删除等操作
 */
class WordleDB {
  constructor() {
    this.GAME_KEY_PREFIX = 'wordle:game:';
    this.WORDBANK_KEY_PREFIX = 'wordle:wordbank:';
  }

  /**
   * 从Redis获取游戏数据
   * @param {string} groupId - 群组ID
   * @returns {Promise<Object|null>} - 游戏数据对象或null
   */
  async getGameData(groupId) {
    try {
      if (!global.redis) {
        // Redis不可用时，使用内存中的数据
        return global.wordleGames?.[groupId] || null;
      }
      
      const key = this.GAME_KEY_PREFIX + groupId;
      const gameDataStr = await global.redis.get(key);
      
      if (gameDataStr) {
        const gameData = JSON.parse(gameDataStr);
        // 将时间戳字符串转换回数字
        if (gameData.startTime && typeof gameData.startTime === 'string') {
          gameData.startTime = parseInt(gameData.startTime, 10);
        }
        return gameData;
      }
      return null;
    } catch (error) {
      logger.error(`获取游戏数据时出错:`, error);
      return global.wordleGames?.[groupId] || null;
    }
  }

  /**
   * 保存游戏数据到Redis
   * @param {string} groupId - 群组ID
   * @param {Object} gameData - 游戏数据对象
   * @returns {Promise<boolean>} - 是否保存成功
   */
  async saveGameData(groupId, gameData) {
    try {
      // 总是在内存中保留一份副本，作为Redis不可用时的备份
      if (!global.wordleGames) {
        global.wordleGames = {};
      }
      global.wordleGames[groupId] = gameData;
      
      if (!global.redis) {
        logger.warn('Redis未启用，游戏数据将仅保存在内存中');
        return false;
      }
      
      const key = this.GAME_KEY_PREFIX + groupId;
      const gameDataStr = JSON.stringify(gameData);
      
      // 设置过期时间：24小时（86400秒）
      await global.redis.set(key, gameDataStr, { EX: 86400 });
      return true;
    } catch (error) {
      logger.error(`保存游戏数据时出错:`, error);
      return false;
    }
  }

  /**
   * 删除游戏数据
   * @param {string} groupId - 群组ID
   * @returns {Promise<boolean>} - 是否删除成功
   */
  async deleteGameData(groupId) {
    try {
      // 从内存中删除
      if (global.wordleGames && global.wordleGames[groupId]) {
        delete global.wordleGames[groupId];
      }
      
      if (!global.redis) {
        return true;
      }
      
      const key = this.GAME_KEY_PREFIX + groupId;
      await global.redis.del(key);
      return true;
    } catch (error) {
      logger.error(`删除游戏数据时出错:`, error);
      return false;
    }
  }

  /**
   * 获取群组的词库选择
   * @param {string} groupId - 群组ID
   * @returns {Promise<string>} - 词库类型，默认为'main'
   */
  async getWordbankSelection(groupId) {
    try {
      if (!global.redis) {
        logger.warn('Redis未启用，使用默认词库');
        return 'main';
      }
      
      const key = this.WORDBANK_KEY_PREFIX + groupId;
      const wordbank = await global.redis.get(key);
      
      return wordbank || 'main';
    } catch (error) {
      logger.error('获取词库选择时出错:', error);
      return 'main';
    }
  }

  /**
   * 设置群组的词库选择
   * @param {string} groupId - 群组ID
   * @param {string} wordbankType - 词库类型（'main'或'backup'）
   * @returns {Promise<boolean>} - 是否设置成功
   */
  async setWordbankSelection(groupId, wordbankType) {
    try {
      if (!global.redis) {
        logger.warn('Redis未启用，词库选择将不会持久化');
        return false;
      }
      
      const key = this.WORDBANK_KEY_PREFIX + groupId;
      await global.redis.set(key, wordbankType);
      
      return true;
    } catch (error) {
      logger.error('设置词库选择时出错:', error);
      return false;
    }
  }
}

export default new WordleDB();