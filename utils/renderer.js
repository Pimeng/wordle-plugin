import fs from 'fs';
import path from 'node:path';
import { createCanvas } from 'canvas';

let utils = (await import('./utils.js')).default;

/**
 * Wordle游戏渲染模块
 * 负责游戏界面的Canvas绘制
 */
class WordleRenderer {
  constructor() {
    this.canvasCache = new Map();
  }

  /**
   * 使用Canvas渲染游戏界面
   * @param {Object} e - 消息事件对象
   * @param {Object} gameData - 游戏数据
   * @param {Function} checkGuessFunc - 检查猜测结果的函数
   * @returns {Promise<*>} - 渲染结果
   */
  async renderGame(e, gameData, checkGuessFunc) {
    const startTime = Date.now();
    try {
      const guesses = Array.isArray(gameData.guesses) ? gameData.guesses : [];
      const results = [];
      const letterCount = gameData.targetWord ? gameData.targetWord.length : 5;
      for (let i = 0; i < guesses.length; i++) {
        const result = checkGuessFunc(guesses[i], gameData.targetWord);
        results.push(result);
      }
      const maxAttempts = gameData.maxAttempts || 6;
      const boxSize = 60;
      const gap = 8;
      const padding = 40;
      const keyboardHeight = 180;
      const versionInfoHeight = 25;
      const height = maxAttempts * boxSize + (maxAttempts - 1) * gap + 2 * padding + keyboardHeight + 15 + versionInfoHeight;
      const wordBasedWidth = letterCount * boxSize + (letterCount - 1) * gap + 2 * padding;
      const keyWidth = 36;
      const keyGap = 5;
      const keyboardLayout = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
      ];
      let maxKeyboardRowWidth = 0;
      for (const row of keyboardLayout)
        maxKeyboardRowWidth = Math.max(maxKeyboardRowWidth, row.length * keyWidth + (row.length - 1) * keyGap);
      const keyboardBasedWidth = maxKeyboardRowWidth + 2 * padding;
      const width = Math.max(wordBasedWidth, keyboardBasedWidth);
      const groupId = e.group_id;
      let canvas, ctx;
      if (this.canvasCache.has(groupId)) {
        canvas = this.canvasCache.get(groupId);
        ctx = canvas.getContext('2d');
        if (canvas.width !== width || canvas.height !== height) {
          canvas = createCanvas(width, height);
          ctx = canvas.getContext('2d');
          this.canvasCache.set(groupId, canvas);
        } else {
          ctx.fillStyle = '#f8f8f8';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      } else {
        canvas = createCanvas(width, height);
        ctx = canvas.getContext('2d');
        this.canvasCache.set(groupId, canvas);
      }
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(0, 0, width, height);
      const boardWidth = letterCount * boxSize + (letterCount - 1) * gap;
      const startX = (width - boardWidth) / 2;
      for (let row = 0; row < maxAttempts; row++) {
        for (let col = 0; col < letterCount; col++) {
          const x = startX + col * (boxSize + gap);
          const y = padding + row * (boxSize + gap);
          let bgColor = '#ffffff';
          let borderColor = '#d3d6da';
          let letter = '';
          if (row < guesses.length && typeof guesses[row] === 'string' && col < guesses[row].length) {
            letter = guesses[row][col];
            if (results[row] && results[row][col]) {
              const status = results[row][col].status;
              switch (status) {
                case 'correct':
                  bgColor = '#6aaa64';
                  borderColor = '#6aaa64';
                  break;
                case 'present':
                  bgColor = '#c9b458';
                  borderColor = '#c9b458';
                  break;
                case 'absent':
                  bgColor = '#787c7e';
                  borderColor = '#787c7e';
                  break;
              }
            }
          }
          ctx.fillStyle = bgColor;
          ctx.fillRect(x, y, boxSize, boxSize);
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, boxSize, boxSize);
          if (letter) {
            ctx.fillStyle = bgColor === '#ffffff' ? '#1a1a1b' : '#ffffff';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(letter.toUpperCase(), x + boxSize / 2, y + boxSize / 2);
          }
        }
      }
      await this.drawKeyboardHint(ctx, width, height - keyboardHeight - versionInfoHeight - 10, gameData.guesses, gameData.targetWord);
      try {
        let pluginVersion = '5.1.4';
        const pluginPackagePath = path.join(process.cwd(), './plugins/wordle-plugin/package.json');
        if (fs.existsSync(pluginPackagePath)) {
          const pluginPackage = JSON.parse(fs.readFileSync(pluginPackagePath, 'utf8'));
          pluginVersion = pluginPackage.version || pluginVersion;
        }
        let yunzaiName = 'Yunzai';
        let yunzaiVersion = '1.1.4';
        try {
          const yunzaiPackagePath = path.join(process.cwd(), './package.json');
          if (fs.existsSync(yunzaiPackagePath)) {
            const yunzaiPackage = JSON.parse(fs.readFileSync(yunzaiPackagePath, 'utf8'));
            if (yunzaiPackage.name)
              yunzaiName = yunzaiPackage.name.replace(/(^\w|-\w)/g, s => s.toUpperCase());
            if (yunzaiPackage.version)
              yunzaiVersion = yunzaiPackage.version;
          }
        } catch (error) {
          logger.debug('无法读取云崽package.json:', error.message);
        }
        ctx.fillStyle = '#787c7e';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${yunzaiName} v${yunzaiVersion} & Wordle-Plugin ${pluginVersion} Beta`, width / 2, height - versionInfoHeight / 2);
      } catch (error) {
        logger.error('绘制版本信息时出错:', error);
      }
      
      const buffer = canvas.toBuffer('image/png');
      const imageSegment = {
        type: 'image',
        file: buffer,
        url: 'data:image/png;base64,' + buffer.toString('base64'),
        filename: `wordle-${Date.now()}.png`
      };
      
      return imageSegment;
    } catch (err) {
      const errMsg = err.toString();
      logger.error(`[Wordle] 渲染错误 [群:${e.group_id}]`, err);
      
      // 构建错误信息数组
      const errorMessages = [];
      errorMessages.push(`🚨 渲染错误！请尝试安装canvas依赖或更新插件\n`);
      errorMessages.push(`错误详情：${errMsg}\n`);
      errorMessages.push(`请将以下完整错误日志提供给开发者以便修复问题：\n`);
      errorMessages.push(`[Wordle] 渲染错误 [群:${e.group_id}] ${errMsg}\n`);
      errorMessages.push(`Node.js版本：${process.version}\n`);
      
      try {
        // 尝试导入common模块来制作转发消息
        const common = (await import('../../../lib/common/common.js')).default;
        return await common.makeForwardMsg(
          e,
          errorMessages,
          'Wordle渲染错误日志'
        );
      } catch (importErr) {
        // 如果导入common模块失败，直接返回错误信息数组
        logger.error(`导入common模块失败：`, importErr);
        return errorMessages;
      }
    } finally {
      const renderTime = Date.now() - startTime;
      if (renderTime > 1000) {
        logger.warn(`[Wordle] 渲染性能警告 [群:${e.group_id}] 耗时:${renderTime}ms`);
      }
    }
  }
  
  /**
   * 在Canvas上绘制键盘提示
   * @param {CanvasRenderingContext2D} ctx - Canvas上下文
   * @param {number} width - 画布宽度
   * @param {number} startY - 起始Y坐标
   * @param {Array<string>} guesses - 已猜测的单词数组
   * @param {string} targetWord - 目标单词
   */
  async drawKeyboardHint(ctx, width, startY, guesses, targetWord) {
    const keyboardLayout = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ];
    const letterStatus = utils.getLetterStatus(guesses, targetWord);
    const keyWidth = 36;
    const keyHeight = 42;
    const keyGap = 5;
    const rowGap = 8;
    for (let rowIndex = 0; rowIndex < keyboardLayout.length; rowIndex++) {
      const row = keyboardLayout[rowIndex];
      const rowWidth = row.length * keyWidth + (row.length - 1) * keyGap;
      const startX = (width - rowWidth) / 2;
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const letter = row[colIndex];
        const status = letterStatus.get(letter.toLowerCase());
        const x = startX + colIndex * (keyWidth + keyGap);
        const y = startY + rowIndex * (keyHeight + rowGap);
        let bgColor = '#d3d6da';
        switch (status) {
          case 'correct':
            bgColor = '#6aaa64';
            break;
          case 'present':
            bgColor = '#c9b458';
            break;
          case 'absent':
            bgColor = '#787c7e';
            break;
        }
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        ctx.roundRect(x, y, keyWidth, keyHeight, 6);
        ctx.fill();
        ctx.fillStyle = bgColor === '#d3d6da' ? '#1a1a1b' : '#ffffff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, x + keyWidth / 2, y + keyHeight / 2);
      }
    }
  }
}

export default new WordleRenderer();