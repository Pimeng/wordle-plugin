import utils from './utils.js';
import { HELP_SECTIONS, HELP_TEXT } from './help.js';

/**
 * Wordle游戏核心逻辑模块
 */
class WordleGame {
  constructor() {
    // 工具模块
    this.utils = utils;

    // 正则表达式定义
    this.REGEX_WORDLE_CMD = /^#[Ww]ordle(.*)$/i;
    this.REGEX_ALPHA = /^[a-zA-Z]+$/;
    
    // 配置
    this.groupcooldownTime = 1000;
    this.personcooldownTime = 4000;
    this.adaptiveAttempts = {
      3: 5,
      4: 6,
      5: 8,
      6: 8,
      7: 10,
      8: 12,
      9: 13,
      10: 15
    };
    
    // 状态管理
    this.userCooldowns = new Map();
    this.groupCooldowns = new Map();
    this._groupLocks = new Map();
  }
  
  async _withGroupLock(groupId, fn) {
    const key = String(groupId);
    const previous = this._groupLocks.get(key) || Promise.resolve();
    const next = previous.then(fn, fn);
    this._groupLocks.set(key, next);
    try {
      return await next;
    } finally {
      if (this._groupLocks.get(key) === next) {
        this._groupLocks.delete(key);
      }
    }
  }

  /**
   * 延迟清理已结束的游戏数据
   * @param {string} groupId - 群组ID
   * @param {number} startTime - 本局开始时间，用于避免误删新对局
   */
  _scheduleGameCleanup(groupId, startTime) {
    setTimeout(async () => {
      if (startTime != null) {
        const current = await this.utils.db.getGameData(groupId);
        if (current?.startTime != null && current.startTime !== startTime) return;
      }
      await this.utils.db.deleteGameData(groupId);
    }, 100);
  }
  
  /**
   * 监听所有消息，用于游戏进行中的直接猜测
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async listenMessages(e) {
    // 仅群聊
    if (e.group_id) {
      const groupId = e.group_id;
      const userId = e.user_id;
      if (!e.msg || typeof e.msg !== 'string') {
        return false;
      }
      let message = e.msg.trim();
      const prefixes = ['#','!','！'];
      let prefix = '';
      for (const p of prefixes) {
        if (message.startsWith(p)) {
          prefix = p;
          message = message.substring(1);
          break;
        }
      }
      message = message.toLowerCase();
      const cooldownKey = `${groupId}_${userId}`;
      const lastGuess = this.userCooldowns.get(cooldownKey);
      const now = Date.now();
      const lastGroupGuess = this.groupCooldowns.get(groupId);
      if (lastGroupGuess && (now - lastGroupGuess) < this.groupcooldownTime) {
        const remainingTime = Math.ceil((this.groupcooldownTime - (now - lastGroupGuess)) / 1000);
        await e.reply(`停停停，你俩什么默契\n（群冷却中，还剩 ${remainingTime} 秒）`, false, {recallMsg: 60});
        return true;
      }
      if (lastGuess && (now - lastGuess) < this.personcooldownTime) {
        const remainingTime = Math.ceil((this.personcooldownTime - (now - lastGuess)) / 1000);
        await e.reply(`我知道你很急，但你先别急\n（个人冷却中，还剩 ${remainingTime} 秒）`, false, {recallMsg: 60});
        return true;
      }
      const currentGame = await this.utils.db.getGameData(groupId);
      if (currentGame && !currentGame.finished) {
        if (message.startsWith('wordle')) {
          return false;
        }
        if (!prefix) {
          return false;
        }
        if (!this.REGEX_ALPHA.test(message)) {
          await e.reply('请输入纯英文单词', false, {recallMsg: 60});
          return true;
        }
        const expectedLength = currentGame.letterCount || 5;
        if (message.length !== expectedLength) {
          return true;
        }
        this.userCooldowns.set(cooldownKey, now);
        this.groupCooldowns.set(groupId, now);
        return await this.processGuess(e, message, groupId);
      }
    }
    
    return false;
  }
  
  /**
   * Wordle主函数
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async wordle(e) {
    const msg = typeof e?.msg === 'string' ? e.msg : '';
    const groupId = e?.group_id;
    if (!groupId) {
      await e.reply('Wordle 仅支持群聊使用');
      return true;
    }
    const originalMsg = msg.toLowerCase();
    if (originalMsg.includes('答案') || originalMsg.includes('ans') || originalMsg.includes('放弃')) {
      return await this.giveUpGame(e);
    }
    const match = msg.match(this.REGEX_WORDLE_CMD);
    let input = match && match[1] ? match[1].trim().toLowerCase() : '';
    if (input.includes('帮助') || input.includes('help')) {
      return await this.showHelp(e);
    }
    if (input.includes('词库') || input.includes('词典') || input.includes('wordbank')) {
      return await this.selectWordbank(e);
    }
    if (!input) {
      return await this.startNewGame(e, 5);
    }
    const numberMatch = input.match(/^\d+$/);
    if (numberMatch) {
      const letterCount = parseInt(numberMatch[0]);
      if (letterCount >= 3 && letterCount <= 10) {
        return await this.startNewGame(e, letterCount);
      } else {
        await e.reply('请输入3-10之间的字母数！');
        return true;
      }
    }
    if (/^[a-z]+$/.test(input)) {
      const currentGame = await this.utils.db.getGameData(groupId);
      const expectedLength = currentGame ? currentGame.letterCount : 5;
      if (input.length === expectedLength) {
        return await this.processGuess(e, input, groupId);
      } else {
        await e.reply(`请输入${expectedLength}个字母的单词！`);
        return true;
      }
    }
    
    return await this.showHelp(e);
  }
  
  /**
   * 开始新游戏
   * @param {*} e - 消息事件对象
   * @param {number} letterCount - 字母数量
   * @returns {Promise<boolean>} - 处理结果
   */
  async startNewGame(e, letterCount = 5) {
    const groupId = e?.group_id;
    if (!groupId) {
      await e.reply('Wordle 仅支持群聊使用');
      return true;
    }
    return await this._withGroupLock(groupId, async () => {
      const existingGame = await this.utils.db.getGameData(groupId);
      if (existingGame && !existingGame.finished) {
        await e.reply('当前群聊已经有一个进行中的游戏了哦！请先完成当前游戏或使用 "#wordle 答案" 或 "#wordle ans" 结束游戏。');
        return true;
      }
      const targetWord = await this.utils.word.getRandomWord(letterCount, groupId);
      if (!targetWord) {
        await e.reply(`词汇表中没有${letterCount}个字母的单词！请尝试其他字母数量。`);
        return true;
      }
      const maxAttempts = this.adaptiveAttempts[letterCount] || 6;
      const currentDict = await this.utils.db.getWordbankSelection(groupId);
      const availableDicts = await this.utils.word.getAvailableDictionaries();
      const currentDictInfo = availableDicts.find(dict => dict.id === currentDict) || availableDicts[0];
      const wordbankName = currentDictInfo.name;
      
      const gameData = {
        targetWord: targetWord,
        guesses: [],
        attempts: 0,
        maxAttempts: maxAttempts,
        finished: false,
        startTime: Date.now(),
        letterCount: letterCount,
        participants: {}
      };
      await this.utils.db.saveGameData(groupId, gameData);
      
      const renderData = {
        targetWord: targetWord,
        guesses: [],
        attempts: 0,
        maxAttempts: maxAttempts,
        finished: false,
        gameState: 'playing'
      };
      
      const img = await this.utils.renderer.renderGame(e, renderData);
      if (img) {
        const gameStartMessage = [
          `Wordle猜词游戏开始啦！
`,
          `当前词库：${wordbankName}
`,
          img
        ];
        await e.reply(gameStartMessage);
      } else{
        logger.error("游戏图片渲染失败")
        throw new Error("游戏出现错误，请检查必要依赖是否安装，或反馈错误");
      }
      
      return true;
    });
  }
  
  /**
   * 处理猜测
   * @param {*} e - 消息事件对象
   * @param {string} guess - 猜测的单词
   * @param {string} groupId - 群组ID
   * @returns {Promise<boolean>} - 处理结果
   */
  async processGuess(e, guess, groupId) {
    const resolvedGroupId = groupId ?? e?.group_id;
    if (!resolvedGroupId) {
      await e.reply('Wordle 仅支持群聊使用');
      return true;
    }
    return await this._withGroupLock(resolvedGroupId, async () => {
      let currentGame = await this.utils.db.getGameData(resolvedGroupId);
      if (!currentGame || currentGame.finished) {
        await e.reply('当前群聊没有进行中的游戏！请先发送 "#wordle" 开始游戏。');
        return true;
      }
      if (!(await this.utils.word.isValidWord(guess, currentGame.letterCount, resolvedGroupId))) {
        return true;
      }
      
      const userId = this._getUserId(e);
      const nickname = this._getDisplayName(e);
      
      if (!currentGame.participants || typeof currentGame.participants !== 'object') {
        currentGame.participants = {};
      }
      if (userId) {
        currentGame.participants[userId] = {
          nickname
        };
      }
      
      currentGame.guesses.push(guess);
      currentGame.attempts++;
      const isWin = guess === currentGame.targetWord;
      currentGame.finished = isWin || currentGame.attempts >= currentGame.maxAttempts;
      await this.utils.db.saveGameData(resolvedGroupId, currentGame);
  
      const results = (currentGame.guesses || []).map(g => this.utils.checkGuess(g, currentGame.targetWord));
  
      const gameData = {
        targetWord: currentGame.targetWord,
        guesses: currentGame.guesses,
        attempts: currentGame.attempts,
        maxAttempts: currentGame.maxAttempts,
        finished: currentGame.finished,
        startTime: currentGame.startTime,
        gameState: isWin ? 'win' : (currentGame.finished ? 'lose' : 'playing'),
        results
      };
      
      const renderResult = await this.utils.renderer.renderGame(e, gameData);
      await this.sendGameResultMessage(e, gameData, isWin, renderResult);
      if (gameData.finished) {
        await this._updateLeaderboardStats(e, currentGame, isWin ? userId : null);
      }
      return true;
    });
  }
  
  /**
   * 发送游戏结果消息
   * @param {*} e - 消息事件对象
   * @param {Object} gameData - 游戏数据
   * @param {boolean} isWin - 是否获胜
   * @param {*} result - 渲染结果或错误信息
   */
  async sendGameResultMessage(e, gameData, isWin, result) {
    if (result) {
      const resultMessage = await this.generateResultMessage(e, gameData, isWin);
      // 将文本消息和图片分开发送
      if (resultMessage) {
        await e.reply(resultMessage);
      }
      await e.reply(result);
    } else {
      await e.reply('渲染失败，请稍后再试或联系开发者获取帮助');
    }
    if (gameData.finished) {
      const groupId = e?.group_id;
      if (!groupId) return;
      this._scheduleGameCleanup(groupId, gameData?.startTime);
    }
  }
  
  /**
   * 生成结果消息
   * @param {*} e - 消息事件对象
   * @param {Object} gameData - 游戏数据
   * @param {boolean} isWin - 是否获胜
   * @returns {string} 结果消息
   */
  async generateResultMessage(e, gameData, isWin) {
    const targetWord = gameData?.targetWord;
    if (isWin) {
      const playerName = this._getDisplayName(e);
      let message = `🎉 恭喜 ${playerName} 猜中了！
答案是 ${targetWord}`;
      const definition = await this.utils.word.getWordDefinition(targetWord);
      if (definition) {
        message += `
${definition}`;
      }
      
      message += `
共猜了 ${gameData.attempts} 次
成绩不错，再来一局吧！`;
      return message;
    } else if (gameData.finished) {
      let message = `😔 很遗憾，没有人猜中
答案是 ${targetWord}`;
      const definition = await this.utils.word.getWordDefinition(targetWord);
      if (definition) {
        message += `
${definition}`;
      }
      
      message += `
别灰心，再来一局吧！`;
      return message;
    } else {
      return ``;
    }
  }
  
  /**
   * 结束游戏
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async giveUpGame(e) {
    const groupId = e?.group_id;
    if (!groupId) {
      await e.reply('Wordle 仅支持群聊使用');
      return true;
    }
    return await this._withGroupLock(groupId, async () => {
      const currentGame = await this.utils.db.getGameData(groupId);
      if (!currentGame || currentGame.finished) {  
        await e.reply('当前群聊没有进行中的游戏哦qwq');
        return true;
      }
      const targetWord = currentGame.targetWord;
      currentGame.finished = true;
      await this.utils.db.saveGameData(groupId, currentGame);
      let message = `游戏结束了哦
【单词】${targetWord}`;
      const definition = await this.utils.word.getWordDefinition(targetWord);
      if (definition) {
        message += `  
${definition}`;
      }
      await e.reply(message);
      await this._updateLeaderboardStats(e, currentGame, null);
      this._scheduleGameCleanup(groupId, currentGame?.startTime);
      return true;
    });
  }
  
  /**
   * 显示帮助（优先渲染帮助图，失败时回退文字版）
   * 帮助图样式由 config/config.yaml 的 render.preset 配置
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async showHelp(e) {
    const img = await this.utils.renderer.renderHelp(e, { sections: HELP_SECTIONS });
    await e.reply(img || HELP_TEXT);
    return true;
  }
  
  /**
   * 选择词库
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async selectWordbank(e) {
    const groupId = e?.group_id;
    if (!groupId) {
      await e.reply('Wordle 仅支持群聊使用');
      return true;
    }
    const input = (typeof e?.msg === 'string' ? e.msg : '').trim().toLowerCase();

    const availableDicts = await this.utils.word.getAvailableDictionaries();
    const currentDict = await this.utils.db.getWordbankSelection(groupId);
    const currentDictInfo = availableDicts.find(dict => dict.id === currentDict) || availableDicts[0];

    const dictNameMatch = input.match(/#wordle\s*(?:词库|词典|wordbank)\s*(.*)/);
    const targetName = dictNameMatch ? dictNameMatch[1].trim() : '';

    // 无参数时循环切换，带“列表”时展示全部词库
    if (!targetName || targetName === '列表' || targetName === 'list') {
      if (!targetName) {
        const currentIndex = availableDicts.findIndex(dict => dict.id === currentDict);
        const nextIndex = ((currentIndex === -1 ? 0 : currentIndex) + 1) % availableDicts.length;
        await this._switchWordbank(e, currentDictInfo, availableDicts[nextIndex]);
        return true;
      }
      await e.reply(this._formatWordbankList(availableDicts, currentDictInfo));
      return true;
    }

    // 按序号或名称切换
    let targetDict;
    if (/^\d+$/.test(targetName)) {
      const index = parseInt(targetName, 10);
      if (index < 1 || index > availableDicts.length) {
        await e.reply(`序号超出范围，请输入 1-${availableDicts.length} 之间的序号\n\n${this._formatWordbankList(availableDicts, currentDictInfo)}`);
        return true;
      }
      targetDict = availableDicts[index - 1];
    } else {
      targetDict = availableDicts.find(dict =>
        dict.name.toLowerCase().includes(targetName) ||
        dict.id.toLowerCase().includes(targetName)
      );
    }

    if (!targetDict) {
      await e.reply(`未找到名为"${targetName}"的词典\n\n${this._formatWordbankList(availableDicts, currentDictInfo)}`);
      return true;
    }

    await this._switchWordbank(e, currentDictInfo, targetDict);
    return true;
  }

  /**
   * 格式化词库列表（含当前词库标记与序号）
   * @param {Array} availableDicts - 可用词库列表
   * @param {Object} currentDictInfo - 当前词库信息
   * @returns {string} 词库列表文本
   */
  _formatWordbankList(availableDicts, currentDictInfo) {
    const lines = availableDicts.map((dict, index) => {
      const mark = currentDictInfo && dict.id === currentDictInfo.id ? ' ← 当前' : '';
      return `${index + 1}. ${dict.name}（${dict.wordCount} 个单词）${mark}`;
    });
    return `📚 当前词库：${currentDictInfo.name}（${currentDictInfo.wordCount} 个单词）\n\n可用词库：\n${lines.join('\n')}\n\n发送 #wordle 词典 <序号|名称> 切换，发送 #wordle 词典 可循环切换`;
  }

  /**
   * 切换词库并回复结果
   * @param {*} e - 消息事件对象
   * @param {Object} currentDictInfo - 当前词库信息
   * @param {Object} targetDict - 目标词库
   */
  async _switchWordbank(e, currentDictInfo, targetDict) {
    // 设置新的词典选择
    await this.utils.db.setWordbankSelection(e.group_id, targetDict.id);

    await e.reply(`词典已切换：${currentDictInfo.name} → ${targetDict.name}\n当前词典信息：\n- 包含 ${targetDict.wordCount} 个单词\n- 使用 #wordle 开始新游戏生效`);
  }

  _getUserId(e) {
    if (e?.user_id != null) return String(e.user_id);
    if (e?.sender?.user_id != null) return String(e.sender.user_id);
    return null;
  }

  _getDisplayName(e) {
    const card = e?.sender?.card;
    const nickname = e?.sender?.nickname;
    const userId = this._getUserId(e);
    if (card && typeof card === 'string' && card.trim().length > 0) {
      return card.trim();
    }
    if (nickname && typeof nickname === 'string' && nickname.trim().length > 0) {
      return nickname.trim();
    }
    return userId != null ? `玩家${userId}` : '未知玩家';
  }

  async _updateLeaderboardStats(e, gameData, winnerId = null) {
    const groupId = e?.group_id;
    if (!groupId || !gameData || !this.utils?.leaderboard) return;

    const participants = gameData.participants || {};
    const participantsArray = Object.entries(participants).map(([userId, data]) => {
      if (typeof data === 'string') {
        return { userId, nickname: data };
      }
      if (data && typeof data === 'object') {
        return { userId, nickname: data.nickname || `玩家${userId}` };
      }
      return { userId, nickname: `玩家${userId}` };
    });

    const resolvedWinnerId = winnerId != null ? String(winnerId) : null;
    let winnerName = '';
    if (resolvedWinnerId) {
      const winnerData = participants[resolvedWinnerId];
      if (typeof winnerData === 'string') {
        winnerName = winnerData;
      } else if (winnerData && typeof winnerData === 'object' && winnerData.nickname) {
        winnerName = winnerData.nickname;
      } else {
        winnerName = this._getDisplayName(e);
      }
    }

    if (!participantsArray.length && !resolvedWinnerId) return;

    await this.utils.leaderboard.recordGameResult(groupId, participantsArray, resolvedWinnerId, winnerName);
  }
}

export default new WordleGame();
