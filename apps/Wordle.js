import plugin from '../../../lib/plugins/plugin.js'
import fs from 'fs'

// 游戏数据存储在内存中
global.wordleGames = global.wordleGames || {}

export class Wordle extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: 'Wordle游戏',
      /** 功能描述 */
      dsc: '猜单词游戏',
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 5000,
      rule: [
        {
          /** 命令正则匹配 */
          reg: '^#[Ww]ordle(.*)$',
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
    
    // 单词文件路径
    this.wordsPath = './plugins/wordle-plugin/resources/words.txt'
    
    // 冷却时间配置（毫秒）
    this.cooldownTime = 3000 // 3秒冷却时间
    
    // 用户冷却状态记录
    this.userCooldowns = new Map()
    
    // 自适应尝试次数配置
    this.adaptiveAttempts = {
      3: 4,  // 3字母单词给4次机会
      4: 5,  // 4字母单词给5次机会
      5: 6,  // 5字母单词给6次机会（默认）
      6: 8,  // 6字母单词给8次机会
      7: 10,  // 7字母单词给10次机会
      8: 12    // 8字母单词给12次机会
    }
  }

  /**
   * 监听所有消息，用于游戏进行中的直接猜测
   * @param e
   * @returns {Promise<boolean>}
   */
  async listenMessages(e) {
    // 只在群聊中监听
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
        await e.reply(`请等待 ${remainingTime} 秒后再猜测！`, false, {recallMsg: 5})
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
        
        // 检查字母数是否匹配
        if (message.length !== expectedLength) {
          await e.reply(`请输入${expectedLength}个字母的单词，你输入了${message.length}个字母哦~`, false, {recallMsg: 30})
          return true
        }
        
        // 更新冷却时间
        this.userCooldowns.set(cooldownKey, now)
        
        // 处理猜测
        return await this.processGuess(e, message, groupId)
      }
    }
    
    // 不是游戏中的有效猜测，让消息继续处理
    return false
  }
  
  /**
   * Wordle主函数
   * @param e
   * @returns {Promise<boolean>}
   */
  async wordle(e) {
    const input = e.msg.replace(REGEX_WORDLE_CMD, '').trim().toLowerCase()
    const groupId = e.group_id
    
    // 如果没有参数，开始新游戏（默认5字母）
    if (!input) {
      return await this.startNewGame(e, 5)
    }
    
    // 处理特殊命令
    if (input === '帮助') {
      return await this.showHelp(e)
    }
    
    if (input === '答案') {
      return await this.giveUpGame(e)
    }
    
    // 检查是否是数字（自定义字母数量）
    if (REGEX_NUMBER.test(input)) {
      const letterCount = parseInt(input)
      if (letterCount >= 3 && letterCount <= 8) {
        return await this.startNewGame(e, letterCount)
      } else {
        await e.reply('请输入3-8之间的字母数量！')
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
    
    // 其他情况显示帮助
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
      await e.reply('当前群聊已经有一个进行中的游戏了哦！请先完成当前游戏或使用 "#wordle 答案" 结束游戏。')
      return true
    }
    
    // 选择随机单词
    const targetWord = await this.getRandomWord(letterCount)
    if (!targetWord) {
      await e.reply(`词汇表中没有${letterCount}个字母的单词！请尝试其他字母数量。`)
      return true
    }
    
    // 获取自适应尝试次数
    const maxAttempts = this.adaptiveAttempts[letterCount] || 6
    
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
      // 添加友好的游戏开始提示
        const gameStartMessage = [
          `🎮 Wordle猜词游戏开始啦！
`,
          `游戏规则很简单：每轮猜一个${letterCount}字母的英文单词
`,
          `🟩 = 字母正确且位置正确
`,
          `🟨 = 字母正确但位置错误
`,
          `⬜ = 字母不存在于答案中
`,
          `你有${maxAttempts}次机会
`,
          `请使用前缀猜测：#apple 或 !apple
`,
          img
        ]
      await e.reply(gameStartMessage)
    } else {
      await e.reply(`🎮 Wordle猜词游戏开始啦！\n请猜测一个${letterCount}字母单词\n你有${maxAttempts}次机会，请使用前缀#或!进行猜测，例如：#apple 或 !apple\n🟩=字母正确且位置正确，🟨=字母正确但位置错误，⬜=字母不存在`)
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
     if (!(await this.isValidWord(guess, game.letterCount))) {
       // 发送提示并在5秒后撤回
       await e.reply(`"${guess}" 不是有效的英文单词哦~请输入${game.letterCount || 5}个字母的英文单词。`, false, {recallMsg: 30})
       return true
     }
     
     // 记录猜测
     game.guesses.push(guess)
     game.attempts++
     
     // 检查结果
     const result = this.checkGuess(guess, game.targetWord)
     
     // 检查是否猜中
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
     
     // 处理游戏结果消息
     await this.sendGameResultMessage(e, gameData, isWin, img)
     
     return true
   }
   
   /**
    * 发送游戏结果消息
    * @param {*} e - 消息对象
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
         feedback += this.generateResultMessage(gameData, isWin)
       
       await e.reply(feedback)
     }
   }
   
   /**
    * 生成结果消息
    * @param {Object} gameData - 游戏数据
    * @param {boolean} isWin - 是否获胜
    * @returns {string} 结果消息
    */
   generateResultMessage(gameData, isWin) {
     if (isWin) {
       let message = `\n🎉 恭喜你猜中了！答案是 ${gameData.targetWord}`
       
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
       return `\n还剩 ${gameData.maxAttempts - gameData.attempts} 次机会，再接再厉！\n直接发送${gameData.letterCount || 5}字母单词继续猜测，或发送 #wordle 答案 结束当前游戏`
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
      await e.reply('Wordle 游戏帮助\n\n命令：\n#wordle - 开始新游戏\n#wordle [单词] - 提交猜测\n#wordle 答案 - 显示答案\n#wordle help - 显示帮助')
    }
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
   * 生成键盘提示 - 模拟网页版布局
   * @param guesses 已猜测的单词数组
   * @param targetWord 目标单词
   * @returns {string} 键盘提示字符串
   */
  generateKeyboardHint(guesses, targetWord) {
    // 定义QWERTY键盘布局（不包含删除和回车键）
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
      
      // 从内存中获取单词列表（使用缓存）
      const words = await this.loadWords()
      return words.some(w => w.length === length && w === targetWord)
    }

   /**
    * 获取随机单词
    * @param {number} letterCount - 字母数量（默认为5）
    * @returns {Promise<string|null>}
    */
   async getRandomWord(letterCount = 5) {
     // 从缓存中获取单词列表
     const words = await this.loadWords()
     const filteredWords = words.filter(word => word.length === letterCount)
     
     if (filteredWords.length > 0) {
       const randomIndex = Math.floor(Math.random() * filteredWords.length)
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
    try {
      const { createCanvas } = await import('canvas')
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
      
      const boxSize = 60
      const gap = 8
      const padding = 40
      const keyboardHeight = 180
      const height = maxAttempts * boxSize + (maxAttempts - 1) * gap + 2 * padding + keyboardHeight + 15
      
      // 计算基于字母数量的宽度
      const wordBasedWidth = letterCount * boxSize + (letterCount - 1) * gap + 2 * padding
      
      // 计算基于键盘布局的宽度（确保键盘完整显示）
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
      
      // 键盘基于的宽度需要考虑左右padding
      const keyboardBasedWidth = maxKeyboardRowWidth + 2 * padding
      
      // 取两者中的较大值作为最终宽度，确保字母区域和键盘区域都能完全显示
      const width = Math.max(wordBasedWidth, keyboardBasedWidth)
  
      // 创建canvas
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
  
      // 背景 - 浅灰色
      ctx.fillStyle = '#f8f8f8'
      ctx.fillRect(0, 0, width, height)
  
      // 绘制游戏板（根据最大尝试次数动态调整行数）
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
      
      // 绘制键盘提示（游戏开始就显示）
      this.drawKeyboardHint(ctx, width, padding, height - keyboardHeight - 10, gameData.guesses, gameData.targetWord)
      
      // 转换为buffer
      const buffer = canvas.toBuffer('image/png')
      // 构建符合系统要求的图片对象，添加必要参数
      const imageSegment = {
        type: 'image',
        file: buffer,
        url: 'data:image/png;base64,' + buffer.toString('base64'),
        filename: `wordle-${Date.now()}.png`
      }
      
      // 构建消息数组（图文混排）
      if (gameData.gameState === 'win') {
        const messages = [`🎉 恭喜你猜中了单词 ${gameData.targetWord}！`, imageSegment]
        
        // 添加单词释义
        const definition = this.getWordDefinition(gameData.targetWord)
        if (definition) {
          messages.push(`【释义】：${definition}`)
        }
        
        return messages
      } else if (gameData.gameState === 'lose') {
        const messages = []
        messages.push(`😔 很遗憾，正确答案是 ${gameData.targetWord}`)
        messages.push(imageSegment)
        
        // 添加单词释义
        const definition = this.getWordDefinition(gameData.targetWord)
        if (definition) {
          messages.push(`【释义】：${definition}`)
        }
        
        return messages
      } else {
        return [`你还有 ${gameData.maxAttempts - gameData.attempts} 次机会`, imageSegment]
      }
    } catch (err) {
      logger.error('渲染游戏界面时出错:', err)
      return null
    }
  }
  
  /**
   * 在Canvas上绘制键盘提示 - 优化版（增加按键大小和间距）
   * @param ctx Canvas上下文
   * @param width 画布宽度
   * @param padding 内边距
   * @param startY 起始Y坐标
   * @param guesses 已猜测的单词数组
   * @param targetWord 目标单词
   */
  drawKeyboardHint(ctx, width, padding, startY, guesses, targetWord) {
    // 定义QWERTY键盘布局（不包含删除和回车键）
    const keyboardLayout = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ]
    
    // 获取字母状态（复用现有方法）
    const letterStatus = this.getLetterStatus(guesses, targetWord)
    
    // 键盘设置 - 优化版（减小按键大小和间距，确保能看到边框）
    const keyWidth = 36
    const keyHeight = 42
    const keyGap = 5
    const rowGap = 8
    
    // 计算每一行的起始X坐标，使其居中
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
        const trimmedLine = line.trim()
        if (!trimmedLine) continue
        
        // 找到第一个空格
        const firstSpaceIndex = trimmedLine.indexOf(' ')
        if (firstSpaceIndex === -1) continue
        
        const currentWord = trimmedLine.substring(0, firstSpaceIndex).trim().toLowerCase()
        
        if (currentWord === word.toLowerCase()) {
          // 提取释义部分（词性后面的内容）
          const definitionPart = trimmedLine.substring(firstSpaceIndex + 1).trim()
          
          // 处理 "n.谋杀，凶杀" 或 "a.男的，雄的 n.男子" 这样的格式
          let definition = definitionPart
          
          // 移除词性标记（如 n., a., vt. 等）
          definition = definition.replace(/^[a-zA-Z]+\./, '').trim()
          
          // 处理多个词性用 & 连接的情况
          definition = definition.replace(/&[a-zA-Z]+\./g, '').trim()
          
          return definition || ''
        }
      }
    } catch (err) {
      logger.warn('获取单词释义时出错:', err)
    }
    
    return ''
  }
}