import fs from 'node:fs';
import utils from './utils.js';

/**
 * Wordle游戏核心逻辑模块
 */
class WordleGame {
  constructor() {
    // 正则表达式定义
    this.REGEX_WORDLE_CMD = /^#[Ww]ordle(.*)$/i;
    this.REGEX_ALPHA = /^[a-zA-Z]+$/;
    
    // 配置
    this.cooldownTime = 10000; // 10秒冷却时间
    this.adaptiveAttempts = {
      3: 5,
      4: 6,
      5: 8,
      6: 8,
      7: 10,
      8: 12
    };
    
    // 状态管理
    this.userCooldowns = new Map();
    
    // 注入工具模块
    this.utils = utils;
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
      const prefixes = ['#','!'];
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
      if (lastGuess && (now - lastGuess) < this.cooldownTime) {
        const remainingTime = Math.ceil((this.cooldownTime - (now - lastGuess)) / 1000);
        await e.reply(`我知道你很急，但你先别急，等 ${remainingTime} 秒！`, false, {recallMsg: 5});
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
          await e.reply('请输入纯英文单词', false, {recallMsg: 30});
          return true;
        }
        const expectedLength = currentGame.letterCount || 5;
        if (message.length !== expectedLength) {
          await e.reply(`请输入${expectedLength}个字母的单词，你输入了${message.length}个字母哦~`, false, {recallMsg: 30});
          return true;
        }
        this.userCooldowns.set(cooldownKey, now);
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
    const originalMsg = e.msg.toLowerCase();
    const groupId = e.group_id;
    if (originalMsg.includes('wordle 答案') || originalMsg.includes('wordle ans') || originalMsg.includes('wordle 放弃')) {
      return await this.giveUpGame(e);
    }
    const match = e.msg.match(this.REGEX_WORDLE_CMD);
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
      if (letterCount >= 3 && letterCount <= 8) {
        return await this.startNewGame(e, letterCount);
      } else {
        await e.reply('请输入3-8之间的字母数！');
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
    const groupId = e.group_id;
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
    
    // 初始化游戏数据
    const gameData = {
      targetWord: targetWord,
      guesses: [],
      attempts: 0,
      maxAttempts: maxAttempts,
      finished: false,
      startTime: Date.now(),
      letterCount: letterCount
    };
    // 保存游戏数据
    await this.utils.db.saveGameData(groupId, gameData);
    
    // 使用渲染器渲染游戏界面
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
        `🎮 Wordle猜词游戏开始啦！
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
  }
  
  /**
   * 处理猜测
   * @param {*} e - 消息事件对象
   * @param {string} guess - 猜测的单词
   * @param {string} groupId - 群组ID
   * @returns {Promise<boolean>} - 处理结果
   */
  async processGuess(e, guess, groupId) {
    let currentGame = await this.utils.db.getGameData(groupId);
    if (!currentGame || currentGame.finished) {
      await e.reply('当前群聊没有进行中的游戏！请先发送 "#wordle" 开始游戏。');
      return true;
    }
    if (currentGame.attempts >= currentGame.maxAttempts) {
      await e.reply('已经用完了所有猜测机会！');
      return true;
    }
    if (currentGame.guesses.includes(guess)) {
      await e.reply(`你已经猜过 "${guess}" 了！请尝试其他单词。`, false, {recallMsg: 5});
      return true;
    }
    if (!(await this.utils.word.isValidWord(guess, currentGame.letterCount, groupId))) {
      await e.reply(`"${guess}" 不是有效的英文单词哦~
请输入${currentGame.letterCount || 5}个字母的英文单词。`, false, {recallMsg: 30});
      return true;
    }
    currentGame.guesses.push(guess);
    currentGame.attempts++;
    const result = this.utils.checkGuess(guess, currentGame.targetWord);
    const isWin = guess === currentGame.targetWord;
    currentGame.finished = isWin || currentGame.attempts >= currentGame.maxAttempts;
    await this.utils.db.saveGameData(groupId, currentGame);
    // 准备游戏状态数据
    const gameData = {
      targetWord: currentGame.targetWord,
      guesses: currentGame.guesses,
      attempts: currentGame.attempts,
      maxAttempts: currentGame.maxAttempts,
      finished: currentGame.finished,
      gameState: isWin ? 'win' : (currentGame.finished ? 'lose' : 'playing'),
      result: result
    };
    
    // 调用渲染方法获取结果（可能是图片或错误信息）
    const renderResult = await this.utils.renderer.renderGame(e, gameData, this.utils.checkGuess);
    await this.sendGameResultMessage(e, gameData, isWin, renderResult);
    return true;
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
      // 将文本消息和图片一起发送
      if (result == null) {
        await e.reply(resultMessage);
      } else if (Array.isArray(resultMessage)) {
        resultMessage.push(result);
        await e.reply(resultMessage);
      } else {
        await e.reply([resultMessage, result]);
      }
    } else {
      // 如果result为null（这种情况现在应该不会发生，但保留以防万一）
      await e.reply('渲染失败，请稍后再试或联系开发者获取帮助');
    }
    if (gameData.finished) {
      const groupId = e.group_id;
      // 仅清理本群的游戏数据和缓存，避免影响其他群
      setTimeout(async () => {
        await this.utils.db.deleteGameData(groupId);
        // 只删除本群的canvasCache（如果是Map或对象）
        if (this.utils.renderer.canvasCache && typeof this.utils.renderer.canvasCache === 'object') {
          this.utils.renderer.canvasCache.delete(groupId);
        }
      }, 30000); // 30秒后清理
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
    const groupId = e.group_id;
    const currentGame = await this.utils.db.getGameData(groupId);
    const targetWord = currentGame.targetWord;
    if (isWin) {
      let message = `🎉 恭喜 ${e.sender.card} 猜中了！
答案是 ${gameData.targetWord}`;
      const definition = await this.utils.word.getWordDefinition(targetWord);
      if (definition) {
        message += `
${definition}`;
      }
      
      message += `
你用了 ${gameData.attempts} 次猜测。
成绩不错，再来一局吧！`;
      return message;
    } else if (gameData.finished) {
      let message = `😔 很遗憾，你没有猜中。
答案是 ${gameData.targetWord}`;
      const definition = await this.utils.word.getWordDefinition(gameData.targetWord);
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
    const groupId = e.group_id;
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
    // 30秒后清理游戏数据，仅清理本群
    setTimeout(async () => {
      await this.utils.db.deleteGameData(groupId);
      if (this.utils.renderer.canvasCache && typeof this.utils.renderer.canvasCache === 'object') {
        if (typeof this.utils.renderer.canvasCache.delete === 'function') {
          this.utils.renderer.canvasCache.delete(groupId);
        } else {
          delete this.utils.renderer.canvasCache[groupId];
        }
      }
    }, 30000);
    return true;
  }
  
  /**
   * 显示帮助
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async showHelp(e) {
    const helpPath = './plugins/wordle-plugin/resources/help.txt';
    if (fs.existsSync(helpPath)) {
      const helpText = fs.readFileSync(helpPath, 'utf-8');
      await e.reply(helpText);
    } else {
      await e.reply(`Wordle 游戏帮助

基本命令：
#wordle - 开始新游戏（默认5字母）
#wordle [数字] - 开始指定字母数量的游戏
![单词] - 提交猜测
#wordle (答案|ans) - 结束游戏
#wordle 帮助 - 显示帮助
#wordle 词库 - 切换词库

使用示例：
#apple - 使用前缀猜测
!apple - 通过前缀猜词
#wordle 7 - 开始7字母游戏
#apple - 使用前缀猜测
#wordle 词库- 切换词库（按群保存）
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
    const groupId = e.group_id;
    const input = e.msg.trim().toLowerCase();
    
    // 获取所有可用的词典
    const availableDicts = await this.utils.word.getAvailableDictionaries();
    
    // 检查是否指定了词典名称
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
}

export default new WordleGame();
