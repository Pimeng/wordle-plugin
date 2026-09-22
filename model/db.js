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
   * 检查Redis是否可用
   * @returns {boolean} - Redis是否可用
   */
  isRedisAvailable() {
    return !!global.redis;
  }

  /**
   * 从Redis获取游戏数据
   * @param {string} groupId - 群组ID
   * @returns {Promise<Object|null>} - 游戏数据对象或null
   */
  async getGameData(groupId) {
    try {
      if (!this.isRedisAvailable()) return null;
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
      return null;
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
      if (!this.isRedisAvailable()) return false;
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
      if (!this.isRedisAvailable()) return true;
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
   * @returns {Promise<string>} - 词典名称，默认为'CET4'
   */
  async getWordbankSelection(groupId) {
    try {
      if (!this.isRedisAvailable()) return 'CET4';
      const key = this.WORDBANK_KEY_PREFIX + groupId;
      const wordbank = await global.redis.get(key);
      return wordbank || 'CET4';
    } catch (error) {
      logger.error('获取词库选择时出错:', error);
      return 'CET4';
    }
  }

  /**
   * 设置群组的词库选择
   * @param {string} groupId - 群组ID
   * @param {string} dictionaryName - 词典名称
   * @returns {Promise<boolean>} - 是否设置成功
   */
  async setWordbankSelection(groupId, dictionaryName) {
    try {
      if (!this.isRedisAvailable()) return false;
      const key = this.WORDBANK_KEY_PREFIX + groupId;
      await global.redis.set(key, dictionaryName);
      return true;
    } catch (error) {
      logger.error('设置词库选择时出错:', error);
      return false;
    }
  }
}

export default new WordleDB();