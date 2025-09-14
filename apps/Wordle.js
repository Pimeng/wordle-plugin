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
          reg: /^[a-z]+$/,
          /** 执行方法 */
          fnc: 'listenMessages',
          log: false
        }
      ]
    })
    
    // 单词文件路径
    this.wordsPath = './plugins/wordle-plugin/resources/words.txt'
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
      
      const message = e.msg.trim().toLowerCase()
      
      // 检查群聊中是否有进行中的游戏
      if (global.wordleGames[groupId] && !global.wordleGames[groupId].finished) {
        // 忽略以#开头的命令消息，让wordle方法处理
        if (message.startsWith('#')) {
          return false
        }
        
        // 检查是否包含非字母字符
        if (!/^[a-z]+$/.test(message)) {
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
    const input = e.msg.replace(/^#[Ww]ordle\s*/i, '').trim().toLowerCase()
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
    if (/^\d+$/.test(input)) {
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
      await e.reply('当前群聊已经有一个进行中的游戏了！请先完成当前游戏或使用 "#wordle 答案" 放弃游戏。')
      return true
    }
    
    // 选择随机单词
    const targetWord = this.getRandomWord(letterCount)
    if (!targetWord) {
      await e.reply(`词汇表中没有${letterCount}个字母的单词！请尝试其他字母数量。`)
      return true
    }
    
    // 初始化游戏数据
    global.wordleGames[groupId] = {
      targetWord: targetWord,
      guesses: [],
      attempts: 0,
      maxAttempts: 6,
      finished: false,
      startTime: Date.now(),
      letterCount: letterCount
    }
    
    // 使用Puppeteer渲染游戏界面
    const gameData = {
      targetWord: targetWord,
      guesses: [],
      attempts: 0,
      maxAttempts: 6,
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
        `直接发送单词即可猜测！
`,
        img
      ]
      await e.reply(gameStartMessage)
    } else {
      await e.reply(`🎮 Wordle猜词游戏开始啦！\n请猜测一个${letterCount}字母单词（直接发送单词即可）\n你有${global.wordleGames[groupId].maxAttempts}次机会。\n🟩=字母正确且位置正确，🟨=字母正确但位置错误，⬜=字母不存在`)
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
     
     // 验证单词是否在单词列表中
     if (!this.isValidWord(guess, game.letterCount)) {
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
     if (img) {
       await e.reply(img)
     } else {
         // 备用文本显示
         let feedback = `第${game.attempts}次猜测：${guess}\n`
         feedback += this.formatResult(result)
         
         if (isWin) {
           feedback += `\n🎉 恭喜你猜中了！答案是 ${game.targetWord}`
           
           // 添加单词释义
           const definition = this.getWordDefinition(game.targetWord)
           if (definition) {
             feedback += `\n【释义】：${definition}`
           }
           
           feedback += `\n你用了 ${game.attempts} 次猜测。\n成绩不错，再来一局吧！`
         } else if (game.finished) {
           feedback += `\n😔 很遗憾，你没有猜中。答案是 ${game.targetWord}`
           
           // 添加单词释义
           const definition = this.getWordDefinition(game.targetWord)
           if (definition) {
             feedback += `\n【释义】：${definition}`
           }
           
           feedback += `\n别灰心，再来一局挑战吧！`
         } else {
           feedback += `\n还剩 ${game.maxAttempts - game.attempts} 次机会，再接再厉！`
           feedback += `\n直接发送${game.letterCount || 5}字母单词继续猜测，或发送 #wordle 答案 放弃当前游戏`
         }
       
       await e.reply(feedback)
     }
     
     return true
   }

  /**
   * 放弃游戏
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
    * 验证单词是否在词汇列表中
    * @param {string} word - 要验证的单词
    * @param {number} wordLength - 单词长度（可选，默认为单词实际长度）
    * @returns {boolean} - 单词是否有效
    */
    isValidWord(word, wordLength = null) {
      const targetWord = word.toLowerCase()
      const length = wordLength || targetWord.length
      
      // 从内存中获取单词列表
      if (global.wordleWords && global.wordleWords.length > 0) {
        return global.wordleWords.filter(w => w.length === length).includes(targetWord)
      }
      
      // 如果内存中没有单词列表，则从文件读取并解析新格式
      if (fs.existsSync(this.wordsPath)) {
        try {
          const wordsContent = fs.readFileSync(this.wordsPath, 'utf-8')
          // 使用与getRandomWord相同的解析逻辑
          const words = wordsContent.split('\n')
            .map(line => {
              line = line.trim()
              if (!line) return null
              
              // 解析新格式：找到第一个空格
              const firstSpaceIndex = line.indexOf(' ')
              if (firstSpaceIndex === -1) return null
              
              const word = line.substring(0, firstSpaceIndex).trim()
              
              // 验证单词格式
              if (!word || !/^[a-zA-Z.]+$/.test(word)) return null
              
              return word.toLowerCase()
            })
            .filter(word => word && word.length === length)
          
          return words.includes(targetWord)
        } catch (err) {
          logger.warn('读取单词文件时出错:', err)
        }
      }
      
      // 使用示例单词列表作为备用
      const sampleWords = [
        'apple', 'brain', 'chair', 'dance', 'eagle',
        'flame', 'grape', 'house', 'image', 'juice',
        'knife', 'lemon', 'mouse', 'night', 'ocean',
        'paper', 'queen', 'river', 'snake', 'table',
        'uncle', 'voice', 'water', 'xenon', 'youth',
        'zebra', 'about', 'beach', 'cloud', 'dream',
        'at', 'be', 'do', 'go', 'he', 'if', 'in', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'to', 'up', 'us', 'we'
      ]
      
      return sampleWords.filter(w => w.length === length).includes(targetWord)
    }

   /**
    * 获取随机单词
    * @param {number} letterCount - 字母数量（默认为5）
    * @returns {string|null}
    */
   getRandomWord(letterCount = 5) {
     // 从内存中获取单词列表
     if (global.wordleWords && global.wordleWords.length > 0) {
       const filteredWords = global.wordleWords.filter(word => word.length === letterCount)
       if (filteredWords.length > 0) {
         const randomIndex = Math.floor(Math.random() * filteredWords.length)
         return filteredWords[randomIndex]
       }
       return null
     }
     
     // 如果内存中没有单词列表，则从文件读取
     if (fs.existsSync(this.wordsPath)) {
       try {
         const wordsContent = fs.readFileSync(this.wordsPath, 'utf-8')
         // 解析新的单词表格式：每行 "单词 词性.释义"，处理各种特殊情况
         const words = wordsContent.split('\n')
           .map(line => {
             line = line.trim()
             if (!line) return null
             
             // 处理 "P.M. n.下午，午后" 这类带点号的单词
             // 先找到第一个空格
             const firstSpaceIndex = line.indexOf(' ')
             if (firstSpaceIndex === -1) return null
             
             const word = line.substring(0, firstSpaceIndex).trim()
             
             // 验证单词是否为纯字母（允许带点号如P.M.）
             if (!word || !/^[a-zA-Z.]+$/.test(word)) return null
             
             return word
           })
           .filter(word => word && word.length === letterCount) // 按字母数量过滤
           .map(word => word.toLowerCase())
         
         if (words.length > 0) {
           const randomIndex = Math.floor(Math.random() * words.length)
           return words[randomIndex]
         }
         return null
       } catch (err) {
         logger.warn('读取单词文件时出错:', err)
       }
     }
     
     // 备用单词列表 - 按字母数量过滤
     const sampleWords = [
       'apple', 'brain', 'chair', 'dance', 'eagle',
       'flame', 'grape', 'house', 'image', 'juice',
       'knife', 'lemon', 'mouse', 'night', 'ocean',
       'paper', 'queen', 'river', 'snake', 'table',
       'uncle', 'voice', 'water', 'xenon', 'youth',
       'zebra', 'about', 'beach', 'cloud', 'dream',
       'at', 'be', 'do', 'go', 'he', 'if', 'in', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'to', 'up', 'us', 'we'
     ]
     
     const filteredWords = sampleWords.filter(word => word.length === letterCount)
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
  
      // Canvas设置 - 根据字母数量动态调整宽度
      const boxSize = 62
      const gap = 8
      const padding = 30
      const width = letterCount * boxSize + (letterCount - 1) * gap + 2 * padding
      const height = 6 * boxSize + 5 * gap + 2 * padding
  
      // 创建canvas
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
  
      // 背景 - 浅灰色
      ctx.fillStyle = '#f8f8f8'
      ctx.fillRect(0, 0, width, height)
  
      // 绘制游戏板
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < letterCount; col++) {
          const x = padding + col * (boxSize + gap)
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