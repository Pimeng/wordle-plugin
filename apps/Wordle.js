import plugin from '../../../lib/plugins/plugin.js'
import fs from 'fs'
import path from 'node:path'
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';

// 正则表达式定义
const REGEX_WORDLE_CMD = /^#[Ww]ordle(.*)$/i
const REGEX_ALPHA = /^[a-zA-Z]+$/
const REGEX_NUMBER = /^\d+$/

// 游戏数据存储在内存中
global.wordleGames = global.wordleGames || {}

export class Wordle extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: 'Wordle',
      /** 功能描述 */
      dsc: '猜单词游戏',
      event: 'message', 
      /** 优先级，数字越小等级越高 */
      priority: 5000,
      rule: [
        {
          /** 命令正则匹配 */
          reg: REGEX_WORDLE_CMD,
          /** 执行方法 */
          fnc: 'wordle'
        },
        {
          reg: /^(?:#|!)?[a-zA-Z]+$/,
          /** 执行方法 */
          fnc: 'listenMessages',
          log: false
        }
      ]
    })
    
    // 重要配置区，默认没必要改
    this.wordsPath = './plugins/wordle-plugin/resources/words.txt'
    this.backupWordsPath = './plugins/wordle-plugin/resources/words-all.txt'
    this.wordsCache = null
    this.cooldownTime = 10000 // 5秒冷却时间
    this.WORDBANK_KEY_PREFIX = 'wordle:wordbank:'
    this.userCooldowns = new Map()
    this.canvasCache = new Map()
    this.lengthStats = null
    this.adaptiveAttempts = {
      3: 4,
      4: 5,
      5: 6,
      6: 8,
      7: 10,
      8: 12
    }

  }

  /**
   * 监听所有消息，用于游戏进行中的直接猜测
   * @param e
   * @returns {Promise<boolean>}
   */
  async listenMessages(e) {
    // 仅群聊
    if (e.group_id) {
      const groupId = e.group_id
      const userId = e.user_id
      
      // 确保 e.msg 存在并且是字符串
      if (!e.msg || typeof e.msg !== 'string') {
        return false
      }
      
      // 移除前缀并转换为小写
      let message = e.msg.trim()
      const prefixes = ['#','!']
      let prefix = ''
      
      for (const p of prefixes) {
        if (message.startsWith(p)) {
          prefix = p
          message = message.substring(1)
          break
        }
      }
      
      message = message.toLowerCase()
      
      // 检查冷却时间
      const cooldownKey = `${groupId}_${userId}`
      const lastGuess = this.userCooldowns.get(cooldownKey)
      const now = Date.now()
      if (lastGuess && (now - lastGuess) < this.cooldownTime) {
        const remainingTime = Math.ceil((this.cooldownTime - (now - lastGuess)) / 1000)
        await e.reply(`我知道你很急，但你先别急，等 ${remainingTime} 秒！`, false, {recallMsg: 5})
        return true
      }
      // 检查群聊中是否有进行中的游戏
      if (global.wordleGames[groupId] && !global.wordleGames[groupId].finished) {
        // 忽略以#开头的命令消息，让wordle方法处理
        if (message.startsWith('wordle')) {
          return false
        }
        // 必须有前缀才能猜词
        if (!prefix) {
          return false
        }
        // 检查是否包含非字母字符
        if (!REGEX_ALPHA.test(message)) {
          await e.reply('请输入纯英文单词', false, {recallMsg: 30})
          return true
        }
        // 获取当前游戏的字母数量
        const game = global.wordleGames[groupId]
        const expectedLength = game.letterCount || 5
        
        if (message.length !== expectedLength) {
          await e.reply(`请输入${expectedLength}个字母的单词，你输入了${message.length}个字母哦~`, false, {recallMsg: 30})
          return true
        }
        // 更新冷却时间
        this.userCooldowns.set(cooldownKey, now)
        return await this.processGuess(e, message, groupId)
      }
    }
    
    return false
  }
  
  /**
   * Wordle主函数
   * @param e
   * @returns {Promise<boolean>}
   */
  async wordle(e) {
    const originalMsg = e.msg.toLowerCase()
    const groupId = e.group_id
    
    if (originalMsg.includes('wordle 答案') || originalMsg.includes('wordle ans') || originalMsg.includes('wordle 放弃')) {
      return await this.giveUpGame(e)
    }
    
    const match = e.msg.match(REGEX_WORDLE_CMD)
    let input = match && match[1] ? match[1].trim().toLowerCase() : ''
    
    // 如果没有参数，开始新游戏（默认5字母）
    if (!input) {
      return await this.startNewGame(e, 5)
    }
    
    // 处理特殊命令 - 使用更灵活的匹配方式
    if (input.includes('帮助') || input.includes('help')) {
      return await this.showHelp(e)
    }
    if (input.includes('词库') || input.includes('wordbank')) {
      return await this.selectWordbank(e)
    }
    
    // 提取纯数字，忽略其他字符
    const numberMatch = input.match(/^\d+$/)
    if (numberMatch) {
      const letterCount = parseInt(numberMatch[0])
      if (letterCount >= 3 && letterCount <= 8) {
        return await this.startNewGame(e, letterCount)
      } else {
        await e.reply('请输入3-8之间的字母数！')
        return true
      }
    }
    
    // 处理猜测
    if (/^[a-z]+$/.test(input)) {
      // 获取当前游戏的字母数量
      const currentGame = global.wordleGames[groupId]
      const expectedLength = currentGame ? currentGame.letterCount : 5
      
      if (input.length === expectedLength) {
        return await this.processGuess(e, input, groupId)
      } else {
        await e.reply(`请输入${expectedLength}个字母的单词！`)
        return true
      }
    }
    
    return await this.showHelp(e)
  }

  /**
   * 开始新游戏
   * @param e
   * @returns {Promise<boolean>}
   */
  async startNewGame(e, letterCount = 5) {
    const groupId = e.group_id
    
    // 检查群聊是否已有进行中的游戏
    if (global.wordleGames[groupId] && !global.wordleGames[groupId].finished) {
      await e.reply('当前群聊已经有一个进行中的游戏了哦！请先完成当前游戏或使用 "#wordle 答案" 或 "#wordle ans" 结束游戏。')
      return true
    }
    
    // 选择随机单词
    const targetWord = await this.getRandomWord(letterCount, groupId)
    if (!targetWord) {
      await e.reply(`词汇表中没有${letterCount}个字母的单词！请尝试其他字母数量。`)
      return true
    }
    
    // 获取自适应尝试次数
    const maxAttempts = this.adaptiveAttempts[letterCount] || 6
    
    // 获取当前词库信息
    const currentWordbank = await this.getWordbankSelection(groupId)
    const wordbankName = currentWordbank === 'main' ? '四级词库' : '全词库'
    
    // 初始化游戏数据
    global.wordleGames[groupId] = {
      targetWord: targetWord,
      guesses: [],
      attempts: 0,
      maxAttempts: maxAttempts,
      finished: false,
      startTime: Date.now(),
      letterCount: letterCount
    }
    
    // 使用Puppeteer渲染游戏界面
    const gameData = {
      targetWord: targetWord,
      guesses: [],
      attempts: 0,
      maxAttempts: maxAttempts,
      finished: false,
      gameState: 'playing'
    }
    
    const img = await this.renderGame(e, gameData)
    if (img) {
      const gameStartMessage = [
        `🎮 Wordle猜词游戏开始啦！
`,
        `当前词库：${wordbankName}
`,
        img
      ]
      await e.reply(gameStartMessage)
    } else {
      await e.reply(`🎮 Wordle猜词游戏开始啦！\n请猜测一个${letterCount}字母单词\n当前词库：${wordbankName}\n你有${maxAttempts}次机会，请使用前缀#或!进行猜测\n例如：#apple 或 !apple\n🟩字母正确且位置正确\n🟨字母正确但位置错误\n⬜字母不存在`)
    }
    
    return true
  }

  /**
   * 处理猜测
   * @param e
   * @param guess
   * @returns {Promise<boolean>}
   */
   async processGuess(e, guess, groupId) {
     // 检查群聊中是否有进行中的游戏
     if (!global.wordleGames[groupId] || global.wordleGames[groupId].finished) {
       await e.reply('当前群聊没有进行中的游戏！请先发送 "#wordle" 开始游戏。')
       return true
     }
     
     const game = global.wordleGames[groupId]
     
     // 检查猜测次数
     if (game.attempts >= game.maxAttempts) {
       await e.reply('已经用完了所有猜测机会！')
       return true
     }
     
     // 检查是否已猜过该单词
     if (game.guesses.includes(guess)) {
       await e.reply(`你已经猜过 "${guess}" 了！请尝试其他单词。`, false, {recallMsg: 5})
       return true
     }
     
     // 验证单词是否在单词列表中
     if (!(await this.isValidWord(guess, game.letterCount, groupId))) {
       // 发送提示并在5秒后撤回
       await e.reply(`"${guess}" 不是有效的英文单词哦~\n请输入${game.letterCount || 5}个字母的英文单词。`, false, {recallMsg: 30})
       return true
     }
     game.guesses.push(guess)
     game.attempts++
     const result = this.checkGuess(guess, game.targetWord)
     let isWin = false
     if (guess === game.targetWord) {
       isWin = true
       game.finished = true
     } else if (game.attempts >= game.maxAttempts) {
       game.finished = true
     }
     
     // 准备游戏状态数据
     const gameData = {
       targetWord: game.targetWord,
       guesses: game.guesses,
       attempts: game.attempts,
       maxAttempts: game.maxAttempts,
       finished: game.finished,
       gameState: isWin ? 'win' : (game.finished ? 'lose' : 'playing'),
       result: result
     }
     
     const img = await this.renderGame(e, gameData)
     await this.sendGameResultMessage(e, gameData, isWin, img)
     return true
   }
   
   /**
    * 发送游戏结果消息
    * @param {*} e
    * @param {Object} gameData - 游戏数据
    * @param {boolean} isWin - 是否获胜
    * @param {*} img - 渲染的图片
    */
   async sendGameResultMessage(e, gameData, isWin, img) {
     if (img) {
       await e.reply(img)
     } else {
         // 备用文本显示
         let feedback = `第${gameData.attempts}次猜测：${gameData.guesses[gameData.guesses.length - 1]}\n`
         feedback += this.formatResult(gameData.result)
         
         // 添加键盘提示
         const keyboardHint = this.generateKeyboardHint(gameData.guesses, gameData.targetWord)
         feedback += `\n\n${keyboardHint}`
         
         // 生成结果消息
         feedback += this.generateResultMessage(e, gameData, isWin)
       
       await e.reply(feedback)
     }
     if (gameData.finished) {
       const groupId = e.group_id
       setTimeout(() => {
         if (global.wordleGames && global.wordleGames[groupId]) {
           delete global.wordleGames[groupId]
         }
         // 清理Canvas缓存
         if (this.canvasCache && this.canvasCache.has(groupId)) {
           this.canvasCache.delete(groupId)
         }
       }, 30000) // 5分钟后清理
     }
   }
   
   /**
    * 生成结果消息
    * @param {*} e 
    * @param {Object} gameData - 游戏数据
    * @param {boolean} isWin - 是否获胜
    * @returns {string} 结果消息
    */
   generateResultMessage(e, gameData, isWin) {
     if (isWin) {
       let message = `🎉 恭喜 ${e.sender.card} 猜中了！\n答案是 ${gameData.targetWord}`
       
       // 添加单词释义
       const definition = this.getWordDefinition(gameData.targetWord)
       if (definition) {
         message += `\n【释义】：${definition}`
       }
       
       message += `\n你用了 ${gameData.attempts} 次猜测。\n成绩不错，再来一局吧！`
       return message
     } else if (gameData.finished) {
       let message = `\n😔 很遗憾，你没有猜中。答案是 ${gameData.targetWord}`
       
       // 添加单词释义
       const definition = this.getWordDefinition(gameData.targetWord)
       if (definition) {
         message += `\n【释义】：${definition}`
       }
       
       message += `\n别灰心，再来一局挑战吧！`
       return message
     } else {
       return `\n还剩 ${gameData.maxAttempts - gameData.attempts} 次机会，再接再厉！\n直接发送${gameData.letterCount || 5}字母单词继续猜测，或发送 #wordle 答案 或 "#wordle ans" 结束当前游戏`
     }
   }

  /**
   * 结束游戏
   * @param e
   * @returns {Promise<boolean>}
   */
  async giveUpGame(e) {
    const groupId = e.group_id
    
    if (!global.wordleGames[groupId] || global.wordleGames[groupId].finished) {
      await e.reply('当前群聊没有进行中的游戏哦qwq')
      return true
    }
    
    const targetWord = global.wordleGames[groupId].targetWord
    global.wordleGames[groupId].finished = true
    
    let message = `游戏结束了哦
【单词】：${targetWord}`
    
    // 添加单词释义
    const definition = this.getWordDefinition(targetWord)
    if (definition) {
      message += `\n【释义】：${definition}`
    }
    
    await e.reply(message)
    return true
  }

  /**
   * 显示帮助
   * @param e
   * @returns {Promise<boolean>}
   */
  async showHelp(e) {
    const helpPath = './plugins/wordle-plugin/resources/help.txt'
    if (fs.existsSync(helpPath)) {
      const helpText = fs.readFileSync(helpPath, 'utf-8')
      await e.reply(helpText)
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
`)
    }
    return true
  }

  /**
   * 选择词库
   * @param e
   * @returns {Promise<boolean>}
   */
  async selectWordbank(e) {
    const groupId = e.group_id
    const currentWordbank = await this.getWordbankSelection(groupId)
    const newWordbank = currentWordbank === 'main' ? 'backup' : 'main'
    await this.setWordbankSelection(groupId, newWordbank)
    const currentWordbankName = currentWordbank === 'main' ? '四级词库' : '全词库'
    const newWordbankName = newWordbank === 'main' ? '四级词库' : '全词库'
    const wordbankDesc = newWordbank === 'main' ? 
      '四级词库：包含大学英语四级词汇，适合日常练习' : 
      '全词库：包含更全面的英语词汇，挑战性更高'
    await e.reply(`词库已切换：${currentWordbankName} → ${newWordbankName}\n当前词库信息：\n- ${wordbankDesc}`)
    return true
  }

  /**
   * 检查猜测结果
   * @param guess
   * @param target
   * @returns {Array}
   */
   checkGuess(guess, target) {
     const result = []
     const targetLetters = target.split('')
     const guessLetters = guess.split('')
     const length = target.length
     
     // 第一遍：检查正确位置的字母
     for (let i = 0; i < length; i++) {
       if (guessLetters[i] === targetLetters[i]) {
         result.push({ letter: guessLetters[i], status: 'correct' }) // 绿色
         targetLetters[i] = null // 标记为已使用
       } else {
         result.push({ letter: guessLetters[i], status: 'pending' })
       }
     }
     
     // 第二遍：检查存在但位置错误的字母
     for (let i = 0; i < length; i++) {
       if (result[i].status === 'pending') {
         const index = targetLetters.indexOf(guessLetters[i])
         if (index !== -1) {
           result[i].status = 'present' // 黄色
           targetLetters[index] = null // 标记为已使用
         } else {
           result[i].status = 'absent' // 灰色
         }
       }
     }
     
     return result
   }

  /**
   * 格式化结果
   * @param result
   * @returns {string}
   */
  formatResult(result) {
    let formatted = ''
    for (const item of result) {
      switch (item.status) {
        case 'correct':
          formatted += '🟩'
          break
        case 'present':
          formatted += '🟨'
          break
        case 'absent':
          formatted += '⬜'
          break
      }
    }
    return formatted
  }

  /**
   * 生成键盘提示
   * @param guesses 已猜测的单词数组
   * @param targetWord 目标单词
   * @returns {string} 键盘提示字符串
   */
  generateKeyboardHint(guesses, targetWord) {
    const keyboardLayout = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ]
    
    // 复用getLetterStatus方法
    const letterStatus = this.getLetterStatus(guesses, targetWord)
    
    // 构建键盘提示
    let hint = '⌨️ 键盘提示：\n'
    
    // 第一行 QWERTYUIOP
    for (const letter of keyboardLayout[0]) {
      const status = letterStatus.get(letter.toLowerCase())
      hint += this.getLetterSymbol(letter, status) + '  '
    }
    
    hint += '\n  '
    
    // 第二行 ASDFGHJKL
    for (const letter of keyboardLayout[1]) {
      const status = letterStatus.get(letter.toLowerCase())
      hint += this.getLetterSymbol(letter, status) + '  '
    }
    
    hint += '\n    '
    
    // 第三行 ZXCVBNM
    for (const letter of keyboardLayout[2]) {
      const status = letterStatus.get(letter.toLowerCase())
      hint += this.getLetterSymbol(letter, status) + '  '
    }
    
    return hint
  }
  
  /**
   * 根据字母状态返回对应的显示符号
   * @param {string} letter - 字母
   * @param {string} status - 状态：correct, present, absent, unknown
   * @returns {string} 显示符号
   */
  getLetterSymbol(letter, status) {
    switch (status) {
      case 'correct':
        return `🟩${letter}`
      case 'present':
        return `🟨${letter}`
      case 'absent':
        return `⬛${letter}`
      case 'unknown':
      default:
        return `⬜${letter}`
    }
  }

  /**
   * 验证单词是否在词汇列表中
   * @param {string} word - 要验证的单词
   * @param {number} wordLength - 单词长度（可选，默认为单词实际长度）
   * @returns {Promise<boolean>} - 单词是否有效
   */
  async isValidWord(word, wordLength = null) {
    const targetWord = word.toLowerCase()
    const length = wordLength || targetWord.length
    
    // 快速检查长度（大多数无效猜测会在此被过滤）
    if (!this.lengthStats) {
      // 初始化长度统计
      const { mainWords, backupWords } = await this.loadWords()
      this.lengthStats = new Set()
      for (const word of [...mainWords, ...backupWords]) {
        this.lengthStats.add(word.length);
      }
    }
    
    // 如果长度不在词库中，直接返回false
    if (!this.lengthStats.has(length)) {
      return false
    }
    
    const { mainWords, backupWords } = await this.loadWords()
    
    const foundInMain = mainWords.some(w => w.length === length && w === targetWord)
    if (foundInMain) {
      return true
    }
    
    const foundInBackup = backupWords.some(w => w.length === length && w === targetWord)
    return foundInBackup
  }

  /**
   * 获取随机单词
   * @param {number} letterCount - 字母数量（默认为5）
   * @returns {Promise<string|null>}
   */
  async getRandomWord(letterCount = 5, groupId = null) {
    // 从缓存中获取单词列表
    const { mainWords, backupWords } = await this.loadWords()
    
    // 根据词库选择状态决定使用哪个词库
    let wordbank
    if (groupId) {
      const selectedWordbank = await this.getWordbankSelection(groupId)
      wordbank = selectedWordbank === 'main' ? mainWords : backupWords
    } else {
      wordbank = mainWords
    }
    
    const filteredWords = wordbank.filter(word => word.length === letterCount)
    
    if (filteredWords.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredWords.length)
      logger.mark("[Wordle] 单词：" + filteredWords[randomIndex])
      return filteredWords[randomIndex]
    }
    
    return null
  }

  /**
   * 使用Canvas渲染游戏界面
   * @param e
   * @param gameData
   * @returns {Promise<*>}
   */
  async renderGame(e, gameData) {
    const startTime = Date.now()
    try {
      const guesses = Array.isArray(gameData.guesses) ? gameData.guesses : []
      const results = []
      
      // 获取字母数量
      const letterCount = gameData.targetWord ? gameData.targetWord.length : 5
      
      // 生成结果数据
      for (let i = 0; i < guesses.length; i++) {
        const result = this.checkGuess(guesses[i], gameData.targetWord)
        results.push(result)
      }

      // 获取最大尝试次数
      const maxAttempts = gameData.maxAttempts || 6
      
      // 样式计算
      const boxSize = 60
      const gap = 8
      const padding = 40
      const keyboardHeight = 180
      const versionInfoHeight = 25
      const height = maxAttempts * boxSize + (maxAttempts - 1) * gap + 2 * padding + keyboardHeight + 15 + versionInfoHeight
      const wordBasedWidth = letterCount * boxSize + (letterCount - 1) * gap + 2 * padding
      const keyWidth = 36
      const keyGap = 5
      const keyboardLayout = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
      ]
      
      // 找出最宽的一行键盘
      let maxKeyboardRowWidth = 0
      for (const row of keyboardLayout) {
        const rowWidth = row.length * keyWidth + (row.length - 1) * keyGap
        maxKeyboardRowWidth = Math.max(maxKeyboardRowWidth, rowWidth)
      }
      const keyboardBasedWidth = maxKeyboardRowWidth + 2 * padding
      const width = Math.max(wordBasedWidth, keyboardBasedWidth)

      const groupId = e.group_id
      let canvas, ctx
      
      if (this.canvasCache.has(groupId)) {
        canvas = this.canvasCache.get(groupId)
        ctx = canvas.getContext('2d')
        
        // 检查Canvas尺寸是否匹配，如果不匹配则重新创建
        if (canvas.width !== width || canvas.height !== height) {
          canvas = createCanvas(width, height)
          ctx = canvas.getContext('2d')
          this.canvasCache.set(groupId, canvas)
        } else {
          ctx.fillStyle = '#f8f8f8'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
      } else {
        canvas = createCanvas(width, height)
        ctx = canvas.getContext('2d')
        this.canvasCache.set(groupId, canvas)
      }

      ctx.fillStyle = '#f8f8f8'
      ctx.fillRect(0, 0, width, height)

      const boardWidth = letterCount * boxSize + (letterCount - 1) * gap
      const startX = (width - boardWidth) / 2
      
      for (let row = 0; row < maxAttempts; row++) {
        for (let col = 0; col < letterCount; col++) {
          const x = startX + col * (boxSize + gap)
          const y = padding + row * (boxSize + gap)
  
          // 设置颜色
          let bgColor = '#ffffff'
          let borderColor = '#d3d6da'
          let letter = ''
  
          if (row < guesses.length && typeof guesses[row] === 'string' && col < guesses[row].length) {
            letter = guesses[row][col]
            if (results[row] && results[row][col]) {
              const status = results[row][col].status
              switch (status) {
                case 'correct':
                  bgColor = '#6aaa64'
                  borderColor = '#6aaa64'
                  break
                case 'present':
                  bgColor = '#c9b458'
                  borderColor = '#c9b458'
                  break
                case 'absent':
                  bgColor = '#787c7e'
                  borderColor = '#787c7e'
                  break
              }
            }
          }
  
          // 绘制方块
          ctx.fillStyle = bgColor
          ctx.fillRect(x, y, boxSize, boxSize)
          ctx.strokeStyle = borderColor
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, boxSize, boxSize)
  
          // 绘制字母
          if (letter) {
            ctx.fillStyle = bgColor === '#ffffff' ? '#1a1a1b' : '#ffffff'
            ctx.font = 'bold 32px Arial'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(letter.toUpperCase(), x + boxSize / 2, y + boxSize / 2)
          }
        }
      }
      this.drawKeyboardHint(ctx, width, padding, height - keyboardHeight - versionInfoHeight - 10, gameData.guesses, gameData.targetWord)
      
      try {
        let pluginVersion = '0.0.5'
        const pluginPackagePath = path.join(process.cwd(), './plugins/wordle-plugin/package.json')
        if (fs.existsSync(pluginPackagePath)) {
          const pluginPackage = JSON.parse(fs.readFileSync(pluginPackagePath, 'utf8'))
          pluginVersion = pluginPackage.version || pluginVersion
        }
        
        let yunzaiName = '未知Yunzai'
        let yunzaiVersion = '3.1.3'
        try {
          const yunzaiPackagePath = path.join(process.cwd(), './package.json')
          if (fs.existsSync(yunzaiPackagePath)) {
            const yunzaiPackage = JSON.parse(fs.readFileSync(yunzaiPackagePath, 'utf8'))
            if (yunzaiPackage.name) {
              yunzaiName = yunzaiPackage.name.replace(/(^\w|-\w)/g, s => s.toUpperCase())
            }

            if (yunzaiPackage.version) {
              yunzaiVersion = yunzaiPackage.version
            }
          }
        } catch (error) {
          logger.debug('无法读取云崽package.json:', error.message)
        }
        
        // 绘制版本信息文本
        ctx.fillStyle = '#787c7e'
        ctx.font = '12px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${yunzaiName} v${yunzaiVersion} & Wordle-Plugin ${pluginVersion} Beta`, width / 2, height - versionInfoHeight / 2)
      } catch (error) {
        logger.error('绘制版本信息时出错:', error)
      }
      
      const buffer = canvas.toBuffer('image/png')
      const imageSegment = {
        type: 'image',
        file: buffer,
        url: 'data:image/png;base64,' + buffer.toString('base64'),
        filename: `wordle-${Date.now()}.png`
      }
      
      if (gameData.gameState === 'win') {
        const messages = [`🎉 恭喜 ${e.sender.card} 猜中了！\n答案是 ${gameData.targetWord}`, imageSegment]
        const definition = this.getWordDefinition(gameData.targetWord)
        if (definition) {
          messages.push(`【释义】：${definition}`)
        }
        messages.push(`\n ${gameData.attempts} 次就猜出来了\n成绩不错，再来一局吧！`)
        return messages
      } else if (gameData.gameState === 'lose') {
        const messages = []
        messages.push(`😔 很遗憾，正确答案是 ${gameData.targetWord}`)
        messages.push(imageSegment)
        const definition = this.getWordDefinition(gameData.targetWord)
        if (definition) {
          messages.push(`【释义】：${definition}`)
        }
        
        return messages
      } else {
        return [`你还有 ${gameData.maxAttempts - gameData.attempts} 次机会`, imageSegment]
      }
    } catch (err) {
      logger.error(`[Wordle] 渲染错误 [群:${e.group_id}]`, err)
      return null
    } finally {
      const renderTime = Date.now() - startTime
      if (renderTime > 1000) {
        logger.warn(`[Wordle] 渲染性能警告 [群:${e.group_id}] 耗时:${renderTime}ms`)
      }
    }
  }
  
  /**
   * 在Canvas上绘制键盘提示
   * @param ctx Canvas上下文
   * @param width 画布宽度
   * @param padding 内边距
   * @param startY 起始Y坐标
   * @param guesses 已猜测的单词数组
   * @param targetWord 目标单词
   */
  drawKeyboardHint(ctx, width, padding, startY, guesses, targetWord) {
    const keyboardLayout = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ]
    const letterStatus = this.getLetterStatus(guesses, targetWord)
    const keyWidth = 36
    const keyHeight = 42
    const keyGap = 5
    const rowGap = 8
    for (let rowIndex = 0; rowIndex < keyboardLayout.length; rowIndex++) {
      const row = keyboardLayout[rowIndex]
      const rowWidth = row.length * keyWidth + (row.length - 1) * keyGap
      const startX = (width - rowWidth) / 2
      
      // 绘制该行的每个按键
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const letter = row[colIndex]
        const status = letterStatus.get(letter.toLowerCase())
        const x = startX + colIndex * (keyWidth + keyGap)
        const y = startY + rowIndex * (keyHeight + rowGap)
        
        // 设置按键颜色
        let bgColor = '#d3d6da' // 默认颜色
        switch (status) {
          case 'correct':
            bgColor = '#6aaa64'
            break
          case 'present':
            bgColor = '#c9b458'
            break
          case 'absent':
            bgColor = '#787c7e'
            break
        }
        
        // 绘制按键 - 增加圆角
        ctx.fillStyle = bgColor
        ctx.beginPath()
        ctx.roundRect(x, y, keyWidth, keyHeight, 6)
        ctx.fill()
        
        // 绘制字母 - 使用更清晰的字体
        ctx.fillStyle = bgColor === '#d3d6da' ? '#1a1a1b' : '#ffffff'
        ctx.font = 'bold 18px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(letter, x + keyWidth / 2, y + keyHeight / 2)
      }
    }
  }
  
  /**
   * 获取每个字母的状态
   * @param guesses 已猜测的单词数组
   * @param targetWord 目标单词
   * @returns {Map<string, string>} 字母状态映射
   */
  getLetterStatus(guesses, targetWord) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'
    const letterStatus = new Map()
    
    // 初始化所有字母状态为未知
    for (const letter of alphabet) {
      letterStatus.set(letter, 'unknown')
    }
    
    // 根据猜测结果更新字母状态
    for (const guess of guesses) {
      const result = this.checkGuess(guess, targetWord)
      for (let i = 0; i < guess.length; i++) {
        const letter = guess[i]
        const status = result[i].status
        
        // 更新字母状态，优先级：correct > present > absent > unknown
        if (status === 'correct') {
          letterStatus.set(letter, 'correct')
        } else if (status === 'present' && letterStatus.get(letter) !== 'correct') {
          letterStatus.set(letter, 'present')
        } else if (status === 'absent' && letterStatus.get(letter) === 'unknown') {
          letterStatus.set(letter, 'absent')
        }
      }
    }
    
    return letterStatus
  }

  /**
   * 加载单词列表（带缓存）
   * @returns {Promise<{mainWords: Array<string>, backupWords: Array<string>}>} - 主词库和备用词库
   */
  async loadWords() {
    // 检查是否已有缓存
    if (this.wordsCache && Date.now() - this.wordsCache.timestamp < 3600000) { // 缓存1小时
      return this.wordsCache.data;
    }

    try {
      // 构建完整的文件路径 - 使用fileURLToPath正确处理路径
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const wordsFile = path.resolve(__dirname, '../resources/words.txt');
      const backupWordsFile = path.resolve(__dirname, '../resources/words-all.txt');
      
      // 初始化主词库和备用词库
      const mainWords = [];
      const backupWords = [];
      
      // 加载主词库
      if (fs.existsSync(wordsFile)) {
        const content = fs.readFileSync(wordsFile, 'utf-8');
        const lines = content.split('\n');
        
        // 提取单词
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          // 处理行号信息（如"314| banner n.旗，旗帜，横幅"）
          const lineParts = trimmedLine.split('|');
          let wordPart = lineParts.length > 1 ? lineParts[1].trim() : trimmedLine;
          
          // 提取单词部分（第一个空格前的内容）
          const firstSpaceIndex = wordPart.indexOf(' ');
          if (firstSpaceIndex !== -1) {
            const word = wordPart.substring(0, firstSpaceIndex).toLowerCase().trim();
            if (/^[a-z]+$/.test(word)) {
              mainWords.push(word);
            }
          }
        }
      } else {
        logger.error(`主单词文件不存在: ${wordsFile}`);
      }
      
      // 加载备用词库
      if (fs.existsSync(backupWordsFile)) {
        const backupContent = fs.readFileSync(backupWordsFile, 'utf-8');
        const backupLines = backupContent.split('\n');
        
        // 提取单词
        for (const line of backupLines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          // 备用词库每行只有一个单词，直接处理
          const word = trimmedLine.toLowerCase();
          if (/^[a-z]+$/.test(word)) {
            backupWords.push(word);
          }
        }
      } else {
        logger.error(`备用单词文件不存在: ${backupWordsFile}`);
      }

      this.wordsCache = {
        data: {
          mainWords: mainWords,
          backupWords: backupWords
        },
        timestamp: Date.now()
      };
      
      return this.wordsCache.data;
    } catch (error) {
      logger.error('加载单词列表时出错:', error);
      return {
        mainWords: [],
        backupWords: []
      };
    }
  }

  /**
  * 获取单词释义
  * @param {string} word - 要查询的单词
  * @returns {string} - 单词释义
  */
  getWordDefinition(word) {
    if (!fs.existsSync(this.wordsPath)) {
      return ''
    }
    
    try {
      const wordsContent = fs.readFileSync(this.wordsPath, 'utf-8')
      const lines = wordsContent.split('\n')
      
      for (const line of lines) {
        let trimmedLine = line.trim()
        if (!trimmedLine) continue
        
        // 处理行号信息（如"314| banner n.旗，旗帜，横幅"）
        if (trimmedLine.includes('|')) {
          const parts = trimmedLine.split('|')
          trimmedLine = parts[parts.length - 1].trim()
        }
        
        // 找到第一个空格
        const firstSpaceIndex = trimmedLine.indexOf(' ')
        if (firstSpaceIndex === -1) continue
        
        const currentWord = trimmedLine.substring(0, firstSpaceIndex).trim().toLowerCase()
        
        if (currentWord === word.toLowerCase()) {
          // 提取释义部分（词性后面的内容）
          const definitionPart = trimmedLine.substring(firstSpaceIndex + 1).trim()
          
          // 优化的释义提取逻辑
          let definition = this.extractDefinition(definitionPart)
          
          return definition || ''
        }
      }
    } catch (err) {
      logger.warn('获取单词释义时出错:', err)
    }
    
    return ''
  }

  /**
   * 提取并清理单词释义
   * @param {string} text - 包含词性和释义的文本
   * @returns {string} - 清理后的释义文本
   */
  extractDefinition(text) {
    const posPattern = /[a-zA-Z]+\./g
    const posMatches = text.match(posPattern) || []
    if (posMatches.length === 0) {
      return text.trim()
    }
    if (posMatches.length === 1 && text.startsWith(posMatches[0])) {
      return text.substring(posMatches[0].length).trim()
    }
    let result = ''
    let currentPos = ''
    let currentDef = ''
    let inDefinition = false
    
    for (let i = 0; i < text.length; i++) {
      let foundPos = false
      for (const pos of posMatches) {
        if (text.substr(i, pos.length) === pos) {
          if (currentDef.trim()) {
            if (result) result += '；'
            result += currentDef.trim()
            currentDef = ''
          }
          
          currentPos = pos
          inDefinition = true
          i += pos.length - 1 // 跳过词性标记
          foundPos = true
          break
        }
      }
      
      // 如果不是词性标记，且在释义部分，添加到当前释义
      if (!foundPos && inDefinition) {
        currentDef += text[i]
      }
    }
    
    // 添加最后一个释义
    if (currentDef.trim()) {
      if (result) result += '；'
      result += currentDef.trim()
    }
    
    // 如果没有提取到有效释义，尝试使用简单的正则方法
    if (!result) {
      // 移除所有词性标记
      result = text.replace(posPattern, '').trim()
    }
    
    // 清理多余的空格和分号
    result = result.replace(/\s+/g, ' ')
    result = result.replace(/；+/g, '；')
    result = result.trim()
    
    return result
  }

  /**
   * 获取群组的词库选择
   * @param {string} groupId - 群组ID
   * @returns {Promise<string>} - 词库类型，默认为'main'
   */
  async getWordbankSelection(groupId) {
    try {
      if (!global.redis) {
        logger.warn('Redis未启用，使用默认词库')
        return 'main'
      }
      
      const key = this.WORDBANK_KEY_PREFIX + groupId
      const wordbank = await global.redis.get(key)
      
      return wordbank || 'main'
    } catch (error) {
      logger.error('获取词库选择时出错:', error)
      return 'main'
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
        logger.warn('Redis未启用，词库选择将不会持久化')
        return false
      }
      
      const key = this.WORDBANK_KEY_PREFIX + groupId
      await global.redis.set(key, wordbankType)
      
      return true
    } catch (error) {
      logger.error('设置词库选择时出错:', error)
      return false
    }
  }
}
