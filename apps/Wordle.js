const game = await import('../utils/game.js').then(m => m.default || m);

let utils;
(async () => {
  utils = await import('../utils/utils.js').then(m => m.default || m);
})();

//import game from '../utils/game.js';
//import utils from '../utils/utils.js';

export class Wordle extends plugin {
  constructor() {
    super({
      name: 'Wordle',
      dsc: '猜单词游戏',
      event: 'message', 
      priority: 5000,
      rule: [
        {
          reg: /^#[Ww]ordle.*(排行榜|榜|leaderboard|rank).*$/i,
          fnc: 'showLeaderboard'
        },
        {
          reg: /^#[Ww]ordle(.*)$/i,
          fnc: 'wordle'
        },
        {
          reg: /^#释义\s+([a-zA-Z]+)$/i,
          fnc: 'getDefinition'
        },
        {
          reg: /^(?:#|!|！)?[a-zA-Z]+$/,
          fnc: 'listenMessages',
          log: false
        }
      ]
    });
    
    // 注入工具和游戏模块
    this.game = game;
    this.utils = utils;
  }
  
  /**
   * 监听所有消息，用于游戏进行中的直接猜测
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async listenMessages(e) {
    return await this.game.listenMessages(e);
  }
  
  /**
   * Wordle主函数
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async wordle(e) {
    return await this.game.wordle(e);
  }

  /**
   * 获取单词释义
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async getDefinition(e) {
    const match = e.msg.match(/^#释义\s+([a-zA-Z]+)$/i);
    if (!match) {
      return false;
    }
    
    const word = match[1].toLowerCase();
    const utilsModule = this.utils || utils;
    this.utils = utilsModule;
    const definition = await utilsModule.word.getWordDefinition(word);
    
    if (definition) {
      await e.reply(`📖 单词：${word.toUpperCase()}
${definition}`);
      return true;
    } else {
      await e.reply(`❌ 未找到单词 "${word.toUpperCase()}" 的释义。\n该单词可能不在当前词库中。`);
      return false;
    }
  }

  async showLeaderboard(e) {
    const groupId = e.group_id;
    const utilsModule = this.utils || utils;
    this.utils = utilsModule;
    
    if (!utilsModule?.leaderboard) {
      await e.reply('排行榜功能尚未加载完成，请稍后再试。');
      return true;
    }

    const msgLower = (e.msg || '').toLowerCase();
    const isGlobal = msgLower.includes('总') || msgLower.includes('全局') || msgLower.includes('global');

    if (!isGlobal && !groupId) {
      await e.reply('群排行榜功能仅支持群聊使用，请使用"#wordle总排行榜"查看全局排行榜。');
      return true;
    }

    let focus = 'wins';
    if (msgLower.includes('胜率') || msgLower.includes('rate')) {
      focus = 'rate';
    } else if (msgLower.includes('参') || msgLower.includes('game')) {
      focus = 'games';
    }

    let winsTop, gamesTop, rateTop;
    if (isGlobal) {
      winsTop = utilsModule.leaderboard.getGlobalLeaderboard('wins', 10);
      gamesTop = utilsModule.leaderboard.getGlobalLeaderboard('games', 10);
      rateTop = utilsModule.leaderboard.getGlobalLeaderboard('rate', 10);
    } else {
      winsTop = utilsModule.leaderboard.getLeaderboard(groupId, 'wins', 10);
      gamesTop = utilsModule.leaderboard.getLeaderboard(groupId, 'games', 10);
      rateTop = utilsModule.leaderboard.getLeaderboard(groupId, 'rate', 10);
    }

    if (!winsTop.length && !gamesTop.length && !rateTop.length) {
      const emptyMsg = isGlobal 
        ? '全局还没有任何 Wordle 战绩，快来开一局吧！'
        : '当前群聊还没有任何 Wordle 战绩，快来开一局吧！';
      await e.reply(emptyMsg);
      return true;
    }

    const getMedal = (index) => {
      if (index === 0) return '🥇';
      if (index === 1) return '🥈';
      if (index === 2) return '🥉';
      return `${index + 1}.`;
    };

    const formatList = (list) => list.map((player, index) => {
      const medal = getMedal(index);
      const name = player.nickname || `玩家${player.userId}`;
      const wins = typeof player.wins === 'number' ? player.wins : 0;
      const games = typeof player.gamesPlayed === 'number' ? player.gamesPlayed : 0;
      const winRateNumber = typeof player.winRate === 'number' ? player.winRate : 0;
      const safeWinRate = games > 0 && Number.isFinite(winRateNumber) ? winRateNumber : 0;
      const winRateText = safeWinRate.toFixed(2);
      return `${medal} ${name} - ${wins}胜 / ${games}局 (胜率${winRateText}%)`;
    }).join('\n');

    const sections = [
      { key: 'wins', title: '🏆 胜场榜', data: winsTop, empty: '暂无胜场数据' },
      { key: 'games', title: '👥 参与榜', data: gamesTop, empty: '暂无参与数据' },
      { key: 'rate', title: '🎯 胜率榜（至少3局）', data: rateTop, empty: '暂无胜率数据' }
    ];

    const title = isGlobal ? '🌍 Wordle 全局排行榜' : '📊 Wordle 群排行榜';
    const messageParts = [title];
    for (const section of sections) {
      const sectionTitle = section.key === focus ? `⭐ ${section.title}` : section.title;
      messageParts.push('', sectionTitle);
      if (section.data.length) {
        messageParts.push(formatList(section.data));
      } else {
        messageParts.push(section.empty);
      }
    }

    await e.reply(messageParts.join('\n'));
    return true;
  }
}
