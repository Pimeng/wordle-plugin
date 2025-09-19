import fs from 'fs';
import path from 'node:path';
import utils from './utils.js';

/**
 * Wordle游戏核心逻辑模块
 */
class WordleGame {
  constructor() {
    // 正则表达式定义
    this.REGEX_WORDLE_CMD = /^#[Ww]ordle(.*)$/i;
    this.REGEX_ALPHA = /^[a-zA-Z]+$/;
    this.REGEX_NUMBER = /^\d+$/;
    
    // 配置
    this.wordsPath = './plugins/wordle-plugin/resources/words.txt';
    this.backupWordsPath = './plugins/wordle-plugin/resources/words-all.txt';
    this.cooldownTime = 10000; // 10秒冷却时间
    this.adaptiveAttempts = {
      3: 4,
      4: 5,
      5: 6,
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
    if (input.includes('词库') || input.includes('wordbank')) {
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
    const currentWordbank = await this.utils.db.getWordbankSelection(groupId);
    const wordbankName = currentWordbank === 'main' ? '四级词库' : '全词库';
    
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
    } else {
      await e.reply(`🎮 Wordle猜词游戏开始啦！\n请猜测一个${letterCount}字母单词\n当前词库：${wordbankName}\n你有${maxAttempts}次机会，请使用前缀#或!进行猜测\n例如：#apple 或 !apple\n🟩字母正确且位置正确\n🟨字母正确但位置错误\n⬜字母不存在`);
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
    let isWin = false;
    if (guess === currentGame.targetWord) {
      isWin = true;
      currentGame.finished = true;
    } else if (currentGame.attempts >= currentGame.maxAttempts) {
      currentGame.finished = true;
    }
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
    // 如果result存在，直接发送结果（可能是图片消息或错误信息）
    if (result) {
      await e.reply(result);
    } else {
      // 如果result为null（这种情况现在应该不会发生，但保留以防万一）
      await e.reply('渲染失败，请稍后再试或联系开发者获取帮助');
    }
    if (gameData.finished) {
      const groupId = e.group_id;
      setTimeout(async () => {
        // 删除游戏数据
        await this.utils.db.deleteGameData(groupId);
        // 清理Canvas缓存
        if (this.utils.renderer.canvasCache && this.utils.renderer.canvasCache.has(groupId)) {
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
    if (isWin) {
      let message = `🎉 恭喜 ${e.sender.card} 猜中了！\n答案是 ${gameData.targetWord}`;
      const definition = await this.utils.word.getWordDefinition(gameData.targetWord);
      if (definition) {
        message += `\n【释义】：${definition}`;
      }
      
      message += `\n你用了 ${gameData.attempts} 次猜测。\n成绩不错，再来一局吧！`;
      return message;
    } else if (gameData.finished) {
      let message = `\n😔 很遗憾，你没有猜中。答案是 ${gameData.targetWord}`;
      const definition = await this.utils.word.getWordDefinition(gameData.targetWord);
      if (definition) {
        message += `\n【释义】：${definition}`;
      }
      message += `\n别灰心，再来一局吧！`;
      return message;
    } else {
      return `\n还剩 ${gameData.maxAttempts - gameData.attempts} 次机会，再接再厉！\n直接发送${gameData.letterCount || 5}字母单词继续猜测，或发送 #wordle 答案 或 "#wordle ans" 结束当前游戏`;
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
【单词】：${targetWord}`;
    const definition = await this.utils.word.getWordDefinition(targetWord);
    if (definition) {
      message += `\n【释义】：${definition}`;
    }
    await e.reply(message);
    // 5分钟后清理游戏数据
    setTimeout(async () => {
      await this.utils.db.deleteGameData(groupId);
      // 清理Canvas缓存
      if (this.utils.renderer.canvasCache && this.utils.renderer.canvasCache.has(groupId)) {
        this.utils.renderer.canvasCache.delete(groupId);
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
    const currentWordbank = await this.utils.db.getWordbankSelection(groupId);
    const newWordbank = currentWordbank === 'main' ? 'backup' : 'main';
    await this.utils.db.setWordbankSelection(groupId, newWordbank);
    const currentWordbankName = currentWordbank === 'main' ? '四级词库' : '全词库';
    const newWordbankName = newWordbank === 'main' ? '四级词库' : '全词库';
    const wordbankDesc = newWordbank === 'main' ? 
      '四级词库：包含大学英语四级词汇，适合日常练习' : 
      '全词库：包含更全面的英语词汇，挑战性更高';
    await e.reply(`词库已切换：${currentWordbankName} → ${newWordbankName}\n当前词库信息：\n- ${wordbankDesc}`);
    return true;
  }
}

export default new WordleGame();