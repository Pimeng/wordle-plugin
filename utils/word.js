import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

/**
 * Wordle单词管理模块
 * 负责单词列表的加载、验证、随机选择等操作
 */
class WordleWord {
  constructor() {
    this.wordsCache = null;
    this.lengthStats = null;
    this.__filename = fileURLToPath(import.meta.url);
    this.__dirname = path.dirname(this.__filename);
    this.wordsFile = path.resolve(this.__dirname, '../resources/words.txt');
    this.backupWordsFile = path.resolve(this.__dirname, '../resources/words-all.txt');
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
      // 初始化主词库和备用词库
      const mainWords = [];
      const backupWords = [];
      
      // 加载主词库
      if (fs.existsSync(this.wordsFile)) {
        const content = fs.readFileSync(this.wordsFile, 'utf-8');
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
        logger.error(`主单词文件不存在: ${this.wordsFile}`);
      }
      
      // 加载备用词库
      if (fs.existsSync(this.backupWordsFile)) {
        const backupContent = fs.readFileSync(this.backupWordsFile, 'utf-8');
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
        logger.error(`备用单词文件不存在: ${this.backupWordsFile}`);
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
   * 获取随机单词
   * @param {number} letterCount - 字母数量（默认为5）
   * @param {string} groupId - 群组ID（用于确定词库选择）
   * @returns {Promise<string|null>}
   */
  async getRandomWord(letterCount = 5, groupId = null) {
    // 从缓存中获取单词列表
    const { mainWords, backupWords } = await this.loadWords();
    
    // 根据词库选择状态决定使用哪个词库
    let wordbank;
    if (groupId) {
      // 需要从外部注入getWordbankSelection方法
      if (typeof this.getWordbankSelection !== 'function') {
        logger.warn('getWordbankSelection方法未注入，使用主词库');
        wordbank = mainWords;
      } else {
        const selectedWordbank = await this.getWordbankSelection(groupId);
        wordbank = selectedWordbank === 'main' ? mainWords : backupWords;
      }
    } else {
      wordbank = mainWords;
    }
    
    const filteredWords = wordbank.filter(word => word.length === letterCount);
    
    if (filteredWords.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredWords.length);
      logger.mark("[Wordle] 单词：" + filteredWords[randomIndex]);
      return filteredWords[randomIndex];
    }
    
    return null;
  }

  /**
   * 验证单词是否在词汇列表中
   * @param {string} word - 要验证的单词
   * @param {number} wordLength - 单词长度（可选，默认为单词实际长度）
   * @returns {Promise<boolean>} - 单词是否有效
   */
  async isValidWord(word, wordLength = null) {
    const targetWord = word.toLowerCase();
    const length = wordLength || targetWord.length;
    
    if (!this.lengthStats) {
      const { mainWords, backupWords } = await this.loadWords();
      this.lengthStats = new Set();
      for (const word of [...mainWords, ...backupWords]) {
        this.lengthStats.add(word.length);
      }
    }
    
    if (!this.lengthStats.has(length)) {
      return false;
    }
    
    const { mainWords, backupWords } = await this.loadWords();
    
    const foundInMain = mainWords.some(w => w.length === length && w === targetWord);
    if (foundInMain) {
      return true;
    }
    
    const foundInBackup = backupWords.some(w => w.length === length && w === targetWord);
    return foundInBackup;
  }

  /**
   * 获取单词释义
   * @param {string} word - 要查询的单词
   * @param {Object} translateConfig - 翻译配置（可选）
   * @param {Function} translateFunc - 翻译函数（可选）
   * @returns {string} - 单词释义
   */
  async getWordDefinition(word, translateConfig = null, translateFunc = null) {
    if (!fs.existsSync(this.wordsFile)) return '';
    
    let definition = '';
    
    try {
      const wordsContent = fs.readFileSync(this.wordsFile, 'utf-8');
      const lines = wordsContent.split('\n');
      
      for (const line of lines) {
        let trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        if (trimmedLine.includes('|')) {
          const parts = trimmedLine.split('|');
          trimmedLine = parts[parts.length - 1].trim();
        }
        
        const firstSpaceIndex = trimmedLine.indexOf(' ');
        if (firstSpaceIndex === -1) continue;
        
        const currentWord = trimmedLine.substring(0, firstSpaceIndex).trim().toLowerCase();
        
        if (currentWord === word.toLowerCase()) {
          const definitionPart = trimmedLine.substring(firstSpaceIndex + 1).trim();
          definition = this.extractDefinition(definitionPart);
          break;
        }
      }
    } catch (err) {
      logger.warn('获取单词释义时出错:', err);
    }
    
    // 如果本地找不到释义，尝试使用翻译功能
    if (!definition && translateConfig?.enable && typeof translateFunc === 'function') {
      logger.info(`本地未找到单词 "${word}" 的释义，尝试使用翻译`);
      const translation = await translateFunc(word);
      if (translation) {
        definition = `翻译：${translation}`;
        logger.info(`翻译成功：${word} -> ${translation}`);
      }
    }
    
    return definition || '';
  }

  /**
   * 提取并清理单词释义
   * @param {string} text - 包含词性和释义的文本
   * @returns {string} - 清理后的释义文本
   */
  extractDefinition(text) {
    const posPattern = /[a-zA-Z]+\./g;
    const posMatches = text.match(posPattern) || [];
    if (posMatches.length === 0) return text.trim();
    if (posMatches.length === 1 && text.startsWith(posMatches[0]))
      return text.substring(posMatches[0].length).trim();
    
    let result = '';
    let currentDef = '';
    let inDefinition = false;
    
    for (let i = 0; i < text.length; i++) {
      let foundPos = false;
      for (const pos of posMatches) {
        if (text.substr(i, pos.length) === pos) {
          if (currentDef.trim()) {
            if (result) result += '；';
            result += currentDef.trim();
            currentDef = '';
          }
          inDefinition = true;
          i += pos.length - 1;
          foundPos = true;
          break;
        }
      }
      
      if (!foundPos && inDefinition)
        currentDef += text[i];
    }
    
    if (currentDef.trim()) {
      if (result) result += '；';
      result += currentDef.trim();
    }
    
    if (!result) result = text.replace(posPattern, '').trim();
    
    result = result.replace(/\s+/g, ' ').replace(/；+/g, '；').trim();
    return result;
  }

  /**
   * 注入getWordbankSelection方法
   * @param {Function} method - getWordbankSelection方法
   */
  injectGetWordbankSelection(method) {
    if (typeof method === 'function') {
      this.getWordbankSelection = method;
    }
  }
}

export default new WordleWord();