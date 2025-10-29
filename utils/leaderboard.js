import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Wordle排行榜数据管理模块
 * 负责记录和管理玩家的游戏统计数据
 */
class LeaderboardManager {
  constructor() {
    this.dataDir = path.resolve(__dirname, '../data');
    this._ensureDataDir();
  }

  /**
   * 确保 data 目录存在
   */
  _ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 获取群组排行榜数据文件路径
   * @param {string|number} groupId - 群组ID
   * @returns {string} 文件路径
   */
  _getLeaderboardPath(groupId) {
    const id = groupId != null ? String(groupId) : 'global';
    return path.join(this.dataDir, `leaderboard_${id}.json`);
  }

  /**
   * 读取群组排行榜数据
   * @param {string|number} groupId - 群组ID
   * @returns {Object} 排行榜数据对象
   */
  _readLeaderboard(groupId) {
    const filePath = this._getLeaderboardPath(groupId);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      logger.error('[Wordle] 读取排行榜数据失败:', error);
      return {};
    }
  }

  /**
   * 写入群组排行榜数据
   * @param {string|number} groupId - 群组ID
   * @param {Object} data - 排行榜数据对象
   */
  _writeLeaderboard(groupId, data) {
    const filePath = this._getLeaderboardPath(groupId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('[Wordle] 写入排行榜数据失败:', error);
    }
  }

  /**
   * 记录一局游戏的结果
   * @param {string|number} groupId - 群组ID
   * @param {Array<{userId:string|number,nickname?:string}>} participants - 本局参与玩家列表（至少猜测过一次）
   * @param {string|number|null} winnerId - 获胜玩家ID，若无则为 null
   * @param {string} winnerName - 获胜玩家昵称（可选，用于覆盖）
   */
  recordGameResult(groupId, participants = [], winnerId = null, winnerName = '') {
    const leaderboard = this._readLeaderboard(groupId);
    const participantSet = new Set();

    for (const participant of participants) {
      if (!participant || participant.userId == null) continue;
      const id = String(participant.userId);
      if (participantSet.has(id)) continue;
      participantSet.add(id);

      const nickname = this._normalizeNickname(participant.nickname, id);
      if (!leaderboard[id]) {
        leaderboard[id] = { nickname, wins: 0, gamesPlayed: 0 };
      }

      leaderboard[id].nickname = nickname;
      leaderboard[id].gamesPlayed = (leaderboard[id].gamesPlayed || 0) + 1;
    }

    if (winnerId != null) {
      const id = String(winnerId);
      const nickname = this._normalizeNickname(winnerName || leaderboard[id]?.nickname, id);

      if (!leaderboard[id]) {
        leaderboard[id] = { nickname, wins: 0, gamesPlayed: 0 };
      }

      leaderboard[id].nickname = nickname;
      leaderboard[id].wins = (leaderboard[id].wins || 0) + 1;

      if (!participantSet.has(id)) {
        leaderboard[id].gamesPlayed = (leaderboard[id].gamesPlayed || 0) + 1;
      }
    }

    this._writeLeaderboard(groupId, leaderboard);
  }

  /**
   * 获取排行榜数据（按指定方式排序）
   * @param {string|number} groupId - 群组ID
   * @param {('wins'|'games'|'rate')} sortBy - 排序方式
   * @param {number} limit - 返回的最大人数
   * @returns {Array} 排序后的玩家数据
   */
  getLeaderboard(groupId, sortBy = 'wins', limit = 10) {
    const leaderboard = this._readLeaderboard(groupId);
    const players = Object.entries(leaderboard).map(([userId, data]) => {
      const games = Number(data.gamesPlayed) || 0;
      const wins = Number(data.wins) || 0;
      return {
        userId,
        nickname: data.nickname,
        wins,
        gamesPlayed: games,
        winRate: this._calculateWinRate(wins, games)
      };
    });

    let sorted;
    switch (sortBy) {
      case 'games':
        sorted = players.sort((a, b) => {
          if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
          if (b.wins !== a.wins) return b.wins - a.wins;
          return a.userId.localeCompare(b.userId, 'zh-Hans-CN');
        });
        break;
      case 'rate':
        sorted = players
          .filter(player => player.gamesPlayed >= 3)
          .sort((a, b) => {
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
            return a.userId.localeCompare(b.userId, 'zh-Hans-CN');
          });
        break;
      case 'wins':
      default:
        sorted = players.sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
          return a.userId.localeCompare(b.userId, 'zh-Hans-CN');
        });
        break;
    }

    return sorted.slice(0, limit);
  }

  /**
   * 获取玩家个人数据
   * @param {string|number} groupId - 群组ID
   * @param {string|number} userId - 玩家ID
   * @returns {Object|null} 玩家数据
   */
  getPlayerStats(groupId, userId) {
    const leaderboard = this._readLeaderboard(groupId);
    const id = String(userId);
    const data = leaderboard[id];
    if (!data) return null;

    const games = Number(data.gamesPlayed) || 0;
    const wins = Number(data.wins) || 0;

    return {
      nickname: data.nickname,
      wins,
      gamesPlayed: games,
      winRate: this._calculateWinRate(wins, games)
    };
  }

  /**
   * 计算胜率
   * @param {number} wins - 胜场
   * @param {number} games - 参赛场次
   * @returns {number} 胜率（0-100，保留两位小数）
   */
  _calculateWinRate(wins, games) {
    if (!games) return 0;
    return Number(((wins / games) * 100).toFixed(2));
  }

  /**
   * 标准化昵称
   * @param {string} nickname - 原始昵称
   * @param {string} fallback - 备用值
   * @returns {string} 处理后的昵称
   */
  _normalizeNickname(nickname, fallback) {
    if (typeof nickname === 'string' && nickname.trim().length > 0) {
      return nickname.trim();
    }
    return `玩家${fallback}`;
  }
}

export default new LeaderboardManager();
