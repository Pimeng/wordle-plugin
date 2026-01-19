import fs from 'node:fs';

let utils;
let utilsPromise;

async function loadUtils() {
  if (utils) return utils;
  if (!utilsPromise) {
    utilsPromise = import('./utils.js').then(m => m.default || m);
  }
  try {
    utils = await utilsPromise;
    return utils;
  } catch (e) {
    logger.error('[game.js] 动态加载 utils 失败', e);
    throw e;
  }
}

/**
 * Wordle游戏核心逻辑模块
 */
class WordleGame {
  constructor() {
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

    // 缓存
    this._helpTextCache = null;
  }
  
  get utils(){
    return utils;
  }

  async _ensureUtils() {
    return await loadUtils();
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
   * 监听所有消息，用于游戏进行中的直接猜测
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async listenMessages(e) {
    await this._ensureUtils();
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
    await this._ensureUtils();
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
    await this._ensureUtils();
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
    await this._ensureUtils();
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
    await this._ensureUtils();
    if (result) {
      const resultMessage = await this.generateResultMessage(e, gameData, isWin);
      // 将文本消息和图片分开发送
      if (resultMessage) {
        await e.reply(resultMessage);
      }
      if (result != null) {
        await e.reply(result);
      }
    } else {
      await e.reply('渲染失败，请稍后再试或联系开发者获取帮助');
    }
    if (gameData.finished) {
      const groupId = e?.group_id;
      if (!groupId) return;
      const finishedStartTime = gameData?.startTime;
      setTimeout(async () => {
        if (finishedStartTime != null) {
          const current = await this.utils.db.getGameData(groupId);
          if (current?.startTime != null && current.startTime !== finishedStartTime) return;
        }
        await this.utils.db.deleteGameData(groupId);
        if (this.utils.renderer.canvasCache && typeof this.utils.renderer.canvasCache === 'object') {
          this.utils.renderer.canvasCache.delete(groupId);
        }
      }, 100);
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
    await this._ensureUtils();
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
    await this._ensureUtils();
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
      const finishedStartTime = currentGame?.startTime;
      setTimeout(async () => {
        if (finishedStartTime != null) {
          const current = await this.utils.db.getGameData(groupId);
          if (current?.startTime != null && current.startTime !== finishedStartTime) return;
        }
        await this.utils.db.deleteGameData(groupId);
        if (this.utils.renderer.canvasCache && typeof this.utils.renderer.canvasCache === 'object') {
          if (typeof this.utils.renderer.canvasCache.delete === 'function') {
            this.utils.renderer.canvasCache.delete(groupId);
          } else {
            delete this.utils.renderer.canvasCache[groupId];
          }
        }
      }, 100);
      return true;
    });
  }
  
  /**
   * 显示帮助
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async showHelp(e) {
    const helpPath = './plugins/wordle-plugin/resources/help.txt';
    if (!this._helpTextCache) {
      if (fs.existsSync(helpPath)) {
        try {
          this._helpTextCache = fs.readFileSync(helpPath, 'utf-8');
        } catch (err) {
          logger.debug('[Wordle] 读取帮助文件失败:', err.message);
        }
      }
    }

    if (this._helpTextCache) {
      await e.reply(this._helpTextCache);
    } else {
      await e.reply(`Wordle 游戏帮助

📋 基本命令：
#wordle - 开始新游戏（默认5字母）
#wordle [数字] - 开始指定字母数量的游戏
#wordle ans - 结束游戏
#wordle 词典 [名称] - 按名称切换词典
#释义 [单词] - 查询单词释义

🎯 提交猜测方式：
• 使用前缀：#apple !apple

📱 使用示例：
#apple - 使用前缀猜测
!apple - 通过前缀猜词
#wordle 7 - 开始7字母游戏
#apple - 使用前缀猜测
#wordle 词典 - 循环切换词典
#wordle 词典 四级 - 切换到四级词典
#wordle 词典 六级 - 切换到六级词典
#释义 access - 查询单词access的释义
`);
    }
    return true;
  }
  
  /**
   * 选择词库
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async selectWordbank(e) {
    await this._ensureUtils();
    const groupId = e?.group_id;
    if (!groupId) {
      await e.reply('Wordle 仅支持群聊使用');
      return true;
    }
    const input = (typeof e?.msg === 'string' ? e.msg : '').trim().toLowerCase();
    
    const availableDicts = await this.utils.word.getAvailableDictionaries();
    const dictNameMatch = input.match(/#wordle\s+(?:词库|词典|wordbank)\s+(.+)/);
    
    if (dictNameMatch && dictNameMatch[1]) {
      // 按名称切换词典
      const targetDictName = dictNameMatch[1].trim();
      const targetDict = availableDicts.find(dict => 
        dict.name.toLowerCase().includes(targetDictName.toLowerCase()) ||
        dict.id.toLowerCase().includes(targetDictName.toLowerCase())
      );
      
      if (targetDict) {
        const currentDict = await this.utils.db.getWordbankSelection(groupId);
        const currentDictInfo = availableDicts.find(dict => dict.id === currentDict) || availableDicts[0];
        
        // 设置新的词典选择
        await this.utils.db.setWordbankSelection(groupId, targetDict.id);
        
        await e.reply(`词典已切换：${currentDictInfo.name} → ${targetDict.name}\n当前词典信息：\n- 包含 ${targetDict.wordCount} 个单词\n- 使用 #wordle 开始新游戏生效`);
        return true;
      } else {
        // 列出所有可用的词典
        const dictList = availableDicts.map(dict => `- ${dict.name} (${dict.wordCount}个单词)`).join('\n');
        await e.reply(`未找到名为"${targetDictName}"的词典\n\n可用词典列表：\n${dictList}\n\n请使用正确的词典名称，例如：#wordle 词典 四级`);
        return true;
      }
    } else {
      // 循环切换词典（原有逻辑）
      const currentDict = await this.utils.db.getWordbankSelection(groupId);
      
      // 找到当前词典的索引
      let currentIndex = availableDicts.findIndex(dict => dict.id === currentDict);
      if (currentIndex === -1) currentIndex = 0;
      
      // 计算下一个词典的索引（循环选择）
      const nextIndex = (currentIndex + 1) % availableDicts.length;
      const nextDict = availableDicts[nextIndex];
      
      // 设置新的词典选择
      await this.utils.db.setWordbankSelection(groupId, nextDict.id);
      
      const currentDictInfo = availableDicts[currentIndex];
      const nextDictInfo = nextDict;
      
      await e.reply(`词典已切换：${currentDictInfo.name} → ${nextDictInfo.name}\n当前词典信息：\n- 包含 ${nextDictInfo.wordCount} 个单词\n- 使用 #wordle 开始新游戏生效`);
      return true;
    }
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
    await this._ensureUtils();
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
