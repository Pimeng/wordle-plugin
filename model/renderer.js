import fs from 'fs';
import path from 'node:path';
import puppeteer from '../../../lib/puppeteer/puppeteer.js';
import { checkGuess, getLetterStatusFromResults } from './checker.js';

const KEYBOARD_LAYOUT = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
];

/**
 * Wordle游戏渲染模块
 * 负责使用浏览器（Puppeteer）渲染游戏界面
 */
class WordleRenderer {
  constructor() {
    this.versionInfoCache = null; // 版本信息缓存
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
   * 构建模板渲染数据
   * @param {Object} gameData - 游戏数据
   * @param {Array} guesses - 已猜测的单词数组
   * @param {Array} results - 与每次猜测对应的判定结果
   * @param {Object} versionInfo - 版本信息
   * @returns {Object} 模板数据
   */
  buildViewData(gameData, guesses, results, versionInfo) {
    const targetWord = typeof gameData.targetWord === 'string' ? gameData.targetWord : '';
    const letterCount = targetWord ? targetWord.length : 5;
    const maxAttempts = gameData.maxAttempts || 6;
    const letterStatus = getLetterStatusFromResults(guesses, results);

    const rows = [];
    for (let row = 0; row < maxAttempts; row++) {
      const cells = [];
      for (let col = 0; col < letterCount; col++) {
        let letter = '';
        let status = 'empty';
        if (row < guesses.length && typeof guesses[row] === 'string' && col < guesses[row].length) {
          letter = guesses[row][col].toUpperCase();
          status = results?.[row]?.[col]?.status || 'empty';
        }
        cells.push({ letter, status });
      }
      rows.push(cells);
    }

    const keyboard = KEYBOARD_LAYOUT.map(row => row.map(letter => ({
      letter,
      status: letterStatus.get(letter.toLowerCase()) || 'unknown'
    })));

    return {
      rows,
      keyboard,
      footer: `${versionInfo.yunzaiName} v${versionInfo.yunzaiVersion} & Wordle-Plugin ${versionInfo.pluginVersion}`
    };
  }

  /**
   * 使用浏览器渲染游戏界面
   * @param {Object} e - 消息事件对象
   * @param {Object} gameData - 游戏数据
   * @returns {Promise<*>} - 渲染结果（图片segment）
   */
  async renderGame(e, gameData, checkGuessFunc) {
    const startTime = Date.now();
    try {
      const guesses = Array.isArray(gameData.guesses) ? gameData.guesses : [];
      // 优先使用预计算结果，否则使用传入函数或默认判定计算
      let results = Array.isArray(gameData.results) ? gameData.results : null;
      const targetWord = typeof gameData.targetWord === 'string' ? gameData.targetWord : '';

      if (!results) {
        const checker = typeof checkGuessFunc === 'function' ? checkGuessFunc : checkGuess;
        results = [];
        for (let i = 0; i < guesses.length; i++) {
          results.push(checker(guesses[i], targetWord));
        }
      }

      const versionInfo = await this.getVersionInfo();
      const viewData = this.buildViewData(gameData, guesses, results, versionInfo);

      const img = await puppeteer.screenshot('wordle', {
        tplFile: './plugins/wordle-plugin/resources/html/wordle.html',
        saveId: `wordle_${Date.now()}`,
        imgType: 'png',
        quality: 100,
        ...viewData
      });

      if (!img) {
        throw new Error('浏览器渲染失败，请检查 Chromium/Puppeteer 是否可用');
      }
      return img;
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
      `🚨 渲染错误！请检查 Chromium/Puppeteer 是否可用\n`,
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
}

export default new WordleRenderer();
