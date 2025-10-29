import fs from 'fs';
import path from 'node:path';
import { createCanvas } from 'canvas';

/**
 * Wordle游戏渲染模块
 * 负责游戏界面的Canvas绘制
 */
class WordleRenderer {
  constructor() {
    this.canvasCache = new Map();
    this.maxCacheSize = 200; // 最大缓存数量
    this.utils = null;
    this.versionInfoCache = null; // 版本信息缓存
    this.initUtils();
  }

  async initUtils() {
    try {
      this.utils = await import('./utils.js').then(m => m.default || m);
    } catch (e) {
      console.error('[renderer.js] 动态加载 utils 失败', e);
    }
  }

  /**
   * 获取版本信息（带缓存）
   * @returns {Object} 包含版本信息的对象
   */
  async getVersionInfo() {
    if (this.versionInfoCache) return this.versionInfoCache;
    try {
      let pluginVersion = '5.1.4';
      let yunzaiName = 'Yunzai';
      let yunzaiVersion = '1.1.4';

      const pluginPackagePath = path.join(process.cwd(), './plugins/wordle-plugin/package.json');
      if (fs.existsSync(pluginPackagePath)) {
        const pluginPackage = JSON.parse(fs.readFileSync(pluginPackagePath, 'utf8'));
        pluginVersion = pluginPackage.version || pluginVersion;
      }

      try {
        const yunzaiPackagePath = path.join(process.cwd(), './package.json');
        if (fs.existsSync(yunzaiPackagePath)) {
          const yunzaiPackage = JSON.parse(fs.readFileSync(yunzaiPackagePath, 'utf8'));
          if (yunzaiPackage.name) {
            yunzaiName = yunzaiPackage.name.replace(/(^\w|-\w)/g, s => s.toUpperCase());
          }
          if (yunzaiPackage.version) {
            yunzaiVersion = yunzaiPackage.version;
          }
        }
      } catch (error) {
        logger.debug('无法读取云崽package.json:', error.message);
      }

      this.versionInfoCache = {
        pluginVersion,
        yunzaiName,
        yunzaiVersion
      };
      return this.versionInfoCache;
    } catch (error) {
      logger.error('获取版本信息时出错:', error);
      this.versionInfoCache = {
        pluginVersion: '5.1.4',
        yunzaiName: 'Yunzai',
        yunzaiVersion: '1.1.4'
      };
      return this.versionInfoCache;
    }
  }

  /**
   * 清理过期的canvas缓存
   * @private
   */
  _cleanCache() {
    if (this.canvasCache.size > this.maxCacheSize) {
      const entriesToDelete = [...this.canvasCache.entries()]
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
        .slice(0, Math.floor(this.maxCacheSize * 0.2)); // 删除20%最旧的缓存

      for (const [key] of entriesToDelete) {
        this.canvasCache.delete(key);
      }
    }
  }

  /**
   * 使用Canvas渲染游戏界面
   * @param {Object} e - 消息事件对象
   * @param {Object} gameData - 游戏数据
   * @returns {Promise<*>} - 渲染结果
   */
  async renderGame(e, gameData, checkGuessFunc) {
    const startTime = Date.now();
    try {
      const guesses = Array.isArray(gameData.guesses) ? gameData.guesses : [];
      // 优先使用预计算结果，否则使用传入函数或utils进行计算
      let results = Array.isArray(gameData.results) ? gameData.results : null;
      const letterCount = gameData.targetWord ? gameData.targetWord.length : 5;

      if (!results) {
        const checker = typeof checkGuessFunc === 'function' ? checkGuessFunc : (this.utils?.checkGuess?.bind(this.utils));
        results = [];
        if (checker) {
          for (let i = 0; i < guesses.length; i++) {
            results.push(checker(guesses[i], gameData.targetWord));
          }
        }
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
        const cacheItem = this.canvasCache.get(groupId);
        canvas = cacheItem.canvas;
        ctx = canvas.getContext('2d');
        cacheItem.lastUsed = Date.now();
        
        if (canvas.width !== width || canvas.height !== height) {
          canvas = createCanvas(width, height);
          ctx = canvas.getContext('2d');
          this.canvasCache.set(groupId, { canvas, lastUsed: Date.now() });
        } else {
          ctx.fillStyle = '#f8f8f8';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      } else {
        canvas = createCanvas(width, height);
        ctx = canvas.getContext('2d');
        this.canvasCache.set(groupId, { canvas, lastUsed: Date.now() });
        this._cleanCache();
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
            if (results && results[row] && results[row][col]) {
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

      // 确保 utils 已加载（在需要使用前）
      if (!this.utils) {
        await this.initUtils();
      }

      await this.drawKeyboardHint(ctx, width, height - keyboardHeight - versionInfoHeight - 10, guesses, results);
      
      // 使用优化后的版本信息获取方法
      const versionInfo = await this.getVersionInfo();
      ctx.fillStyle = '#787c7e';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${versionInfo.yunzaiName} v${versionInfo.yunzaiVersion} & Wordle-Plugin ${versionInfo.pluginVersion} Beta`,
        width / 2,
        height - versionInfoHeight / 2
      );
      
      const buffer = canvas.toBuffer('image/png');
      const imageSegment = {
        type: 'image',
        file: buffer,
        url: 'data:image/png;base64,' + buffer.toString('base64'),
        filename: `wordle-${Date.now()}.png`
      };
      
      return imageSegment;
    } catch (err) {
      return this.handleRenderError(e, err);
    } finally {
      this.logPerformanceWarning(e, startTime);
    }
  }

  /**
   * 处理渲染错误
   * @private
   */
  async handleRenderError(e, err) {
    const errMsg = err.toString();
    logger.error(`[Wordle] 渲染错误 [群:${e.group_id}]`, err);
    
    const errorMessages = [
      `🚨 渲染错误！请尝试安装canvas依赖或更新插件\n`,
      `错误详情：${errMsg}\n`,
      `请将以下完整错误日志提供给开发者以便修复问题：\n`,
      `[Wordle] 渲染错误 [群:${e.group_id}] ${errMsg}\n`,
      `Node.js版本：${process.version}\n`
    ];
    
    try {
      const common = (await import('../../../lib/common/common.js')).default;
      return await common.makeForwardMsg(e, errorMessages, 'Wordle渲染错误日志');
    } catch (importErr) {
      logger.error(`导入common模块失败：`, importErr);
      return errorMessages;
    }
  }

  /**
   * 记录性能警告日志
   * @private
   */
  logPerformanceWarning(e, startTime) {
    const renderTime = Date.now() - startTime;
    if (renderTime > 1500) {
      logger.warn(`[Wordle] 渲染性能警告 [群:${e.group_id}] 耗时:${renderTime}ms`);
    }
  }
  
  /**
   * 在Canvas上绘制键盘提示
   * @param {CanvasRenderingContext2D} ctx - Canvas上下文
   * @param {number} width - 画布宽度
   * @param {number} startY - 起始Y坐标
   * @param {Array<string>} guesses - 已猜测的单词数组
   * @param {Array<Array<{letter:string,status:string}>>} results - 与每次猜测对应的结果
   */
  async drawKeyboardHint(ctx, width, startY, guesses, results) {
    const keyboardLayout = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ];
    const letterStatus = this.utils.getLetterStatusFromResults(guesses, results);
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