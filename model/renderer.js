import fs from 'fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from '../../../lib/puppeteer/puppeteer.js';
import { checkGuess, getLetterStatusFromResults } from './checker.js';
import { Config, BACKGROUND_FAIL_TTL } from './config.js';

const KEYBOARD_LAYOUT = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
];

/** 帮助图背景请求超时（ms） */
const HELP_BG_TIMEOUT = 6000;

/**
 * 帮助图字体：Google Sans 优先，MiSans 作为中文回退。
 * 模板会被写入 temp/html 再以 file:// 打开，因此这里转成绝对 file:// 地址，
 * 避免相对路径依赖当前工作目录。缺失时返回空串，模板自动退回系统字体。
 */
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.resolve(pluginRoot, '../../resources/font');

function resolveFontUrl(file) {
  try {
    return fs.existsSync(file) ? pathToFileURL(file).href : '';
  } catch {
    return '';
  }
}

const GOOGLE_SANS_URL = resolveFontUrl(path.join(FONT_DIR, 'GoogleSans.ttf'));
const MI_SANS_URL = resolveFontUrl(path.join(FONT_DIR, 'MiSans-Regular.ttf'));

/**
 * Wordle游戏渲染模块
 * 负责使用浏览器（Puppeteer）渲染游戏界面
 */
class WordleRenderer {
  constructor() {
    this.versionInfoCache = null; // 版本信息缓存
    this.helpBackgroundCache = new Map(); // 帮助图背景缓存
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
   * 获取帮助图背景（转 data URI，带短时缓存）
   * @param {string} url - 背景图地址
   * @param {number} cacheSeconds - 缓存时间（秒），0 表示不缓存
   * @returns {Promise<string>} data URI，获取失败返回空字符串
   */
  async _fetchHelpBackground(url, cacheSeconds = 0) {
    if (!url) return '';

    const now = Date.now();
    const ttl = Math.max(0, Number(cacheSeconds) || 0) * 1000;
    const cached = this.helpBackgroundCache.get(url);
    if (cached && cached.expiresAt > now) return cached.value;

    let value = '';
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(HELP_BG_TIMEOUT) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const mime = response.headers.get('content-type') || 'image/jpeg';
      if (!mime.startsWith('image/')) throw new Error(`非图片响应：${mime}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('响应内容为空');
      value = `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (err) {
      logger.warn(`[Wordle] 帮助图背景获取失败，本次回退白底：${err.message}`);
    }

    this.helpBackgroundCache.set(url, {
      value,
      expiresAt: now + (value ? ttl : Math.max(ttl, BACKGROUND_FAIL_TTL))
    });
    if (this.helpBackgroundCache.size > 8) {
      const oldest = this.helpBackgroundCache.keys().next().value;
      if (oldest !== undefined) this.helpBackgroundCache.delete(oldest);
    }
    return value;
  }

  /**
   * 使用浏览器渲染帮助图片（样式由 config/config.yaml 的 render.preset 决定）
   * @param {Object} e - 消息事件对象
   * @param {Object} options - 渲染参数
   * @param {Array} options.sections - 帮助章节数据
   * @returns {Promise<*>} - 图片segment，失败返回 null
   */
  async renderHelp(e, { sections } = {}) {
    const startTime = Date.now();
    try {
      const versionInfo = await this.getVersionInfo();
      let mode = 'plain';
      let background = '';
      const backgroundUrl = Config.background;
      if (backgroundUrl) {
        background = await this._fetchHelpBackground(backgroundUrl, Config.backgroundCache);
        if (background) {
          mode = Config.backgroundMode || (Config.renderPreset === 'white' ? 'white' : 'portrait');
        }
      }

      const viewData = {
        sections: Array.isArray(sections) ? sections : [],
        mode,
        background,
        backgroundBlur: Config.backgroundBlur,
        googleSansFont: GOOGLE_SANS_URL,
        miSansFont: MI_SANS_URL,
        footer: `${versionInfo.yunzaiName} v${versionInfo.yunzaiVersion} & Wordle-Plugin ${versionInfo.pluginVersion}`
      };

      // 浏览器可能仍在启动，首次渲染失败时稍后重试
      for (let attempt = 0; attempt < 2; attempt++) {
        const img = await puppeteer.screenshot('wordle-help', {
          tplFile: './plugins/wordle-plugin/resources/html/help.html',
          saveId: `wordle-help_${Date.now()}_${attempt}`,
          imgType: 'jpeg',
          quality: 92,
          ...viewData
        });
        if (img) return img;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return null;
    } catch (err) {
      logger.error('[Wordle] 帮助图片渲染失败：', err);
      return null;
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
