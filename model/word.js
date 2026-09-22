import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

/** 全部词库伪词典ID */
const ALL_WORDBANK_ID = 'ALL';
/** 全部词库伪词典名称 */
const ALL_WORDBANK_NAME = '全部词库';

/**
 * Wordle单词管理模块（JSON词典版本）
 * 负责从JSON词典文件加载单词、释义、验证等操作
 */
class WordleWordNew {
  constructor() {
    this.wordsCache = null;
    this.lengthStats = null;
    this.globalWordSet = null;        // 全部单词集合（小写）
    this.definitionIndex = null;      // 单词 -> 释义与来源词典
    this.wordsByLengthCache = new WeakMap(); // 词库 -> (单词长度 -> 单词列表)
    this._loadPromise = null;         // 词典加载中的共享Promise

    this.__filename = fileURLToPath(import.meta.url);
    this.__dirname = path.dirname(this.__filename);
    this.dictionariesPath = path.resolve(this.__dirname, '../resources/words');
    this.dictionaryFiles = [
      'CET4.json', 'CET6.json', 'GMAT.json', 'GRE.json', 
      'IELTS.json', 'SAT.json', 'TOEFL.json', '专八.json', 
      '专四.json', '考研.json'
    ];
    this.dictionaryNames = {
      'CET4.json': '四级词库',
      'CET6.json': '六级词库', 
      'GMAT.json': 'GMAT词库',
      'GRE.json': 'GRE词库',
      'IELTS.json': '雅思词库',
      'SAT.json': 'SAT词库',
      'TOEFL.json': '托福词库',
      '专八.json': '专八词库',
      '专四.json': '专四词库',
      '考研.json': '考研词库'
    };
  }

  /**
   * 加载所有词典数据（带缓存）
   * @returns {Promise<Object>} - 包含所有词典数据的对象
   */
  async loadAllDictionaries() {
    // 检查是否已有缓存
    if (this.wordsCache && Date.now() - this.wordsCache.timestamp < 3600000) { // 缓存1小时
      return this.wordsCache.data;
    }

    // 并发调用时共享同一次加载，避免重复读取词典文件
    if (!this._loadPromise) {
      this._loadPromise = this._loadDictionaries().finally(() => {
        this._loadPromise = null;
      });
    }
    return await this._loadPromise;
  }

  /**
   * 读取并解析全部词典文件
   * @returns {Promise<Object>} - 包含所有词典数据的对象
   */
  async _loadDictionaries() {
    try {
      const allDictionaries = {};
      
      // 加载所有词典文件
      for (const dictFile of this.dictionaryFiles) {
        const dictPath = path.resolve(this.dictionariesPath, dictFile);
        let content;
        try {
          content = await fs.promises.readFile(dictPath, 'utf-8');
        } catch (err) {
          // 词典文件不存在时跳过
          continue;
        }
        const dictionary = JSON.parse(content);

        // 提取词典名称（不带.json后缀）
        const dictName = dictFile.replace('.json', '');
        const wordList = Object.keys(dictionary);
        allDictionaries[dictName] = {
          name: this.dictionaryNames[dictFile] || dictName,
          words: dictionary,
          wordList
        };
      }

      this.wordsCache = {
        data: allDictionaries,
        timestamp: Date.now()
      };

      // 同步构建加速索引
      this._buildIndexes(allDictionaries);
      
      return allDictionaries;
    } catch (error) {
      logger.error('加载词典数据时出错:', error);
      return {};
    }
  }

  /**
   * 构建全局索引以加速校验与释义查询
   * @param {Object} dictionaries
   * @private
   */
  _buildIndexes(dictionaries) {
    try {
      const lengths = new Set();
      const allWords = new Set();
      const defIndex = new Map();
      const allByLength = new Map();

      for (const dictName in dictionaries) {
        const dict = dictionaries[dictName];
        for (const w of dict.wordList) {
          const lw = w.toLowerCase();
          lengths.add(lw.length);
          if (!allWords.has(lw)) {
            allWords.add(lw);
            let pool = allByLength.get(lw.length);
            if (!pool) {
              pool = [];
              allByLength.set(lw.length, pool);
            }
            pool.push(lw);
          }
          if (!defIndex.has(lw)) {
            defIndex.set(lw, { definition: dict.words[lw], dictName: dict.name });
          }
        }
      }

      this.lengthStats = lengths;
      this.globalWordSet = allWords;
      this.definitionIndex = defIndex;
      this.allWordsByLength = allByLength;
    } catch (e) {
      logger.error('构建词典索引失败:', e);
    }
  }

  /**
   * 获取随机单词
   * @param {number} letterCount - 字母数量（默认为5）
   * @param {string} groupId - 群组ID（用于确定词典选择）
   * @returns {Promise<string|null>}
   */
  async getRandomWord(letterCount = 5, groupId = null) {
    const dictionaries = await this.loadAllDictionaries();
    
    // 根据词典选择状态决定使用哪个词典
    let selectedDictName = 'CET4';
    if (groupId) {
      if (typeof this.getWordbankSelection !== 'function') {
        logger.warn('getWordbankSelection方法未注入，使用四级词库');
      } else {
        selectedDictName = await this.getWordbankSelection(groupId);
      }
    }
    
    // 过滤指定长度的单词（带缓存）
    let filteredWords;
    let wordbankName;
    if (selectedDictName === ALL_WORDBANK_ID) {
      if (!this.allWordsByLength) this._buildIndexes(dictionaries);
      filteredWords = this.allWordsByLength?.get(letterCount) || [];
      wordbankName = ALL_WORDBANK_NAME;
    } else {
      const selectedDict = dictionaries[selectedDictName] || dictionaries['CET4'];
      if (!selectedDict) {
        logger.error('未找到选择的词典');
        return null;
      }
      filteredWords = this._getWordsOfLength(selectedDict, letterCount);
      wordbankName = selectedDict.name;
    }
    
    if (filteredWords.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredWords.length);
      const selectedWord = filteredWords[randomIndex];
      logger.mark("[Wordle] 单词：" + selectedWord + "（来自：" + wordbankName + "）");
      return selectedWord;
    }
    
    return null;
  }

  /**
   * 获取指定词库中指定长度的单词列表（带缓存）
   * @param {Object} dict - 词库对象
   * @param {number} letterCount - 字母数量
   * @returns {Array<string>} 单词列表
   */
  _getWordsOfLength(dict, letterCount) {
    let byLength = this.wordsByLengthCache.get(dict.wordList);
    if (!byLength) {
      byLength = new Map();
      this.wordsByLengthCache.set(dict.wordList, byLength);
    }
    if (!byLength.has(letterCount)) {
      byLength.set(letterCount, dict.wordList.filter(word => word.length === letterCount));
    }
    return byLength.get(letterCount);
  }

  /**
   * 验证单词是否在词汇列表中（性能优化：O(1) 查询）
   * @param {string} word - 要验证的单词
   * @param {number} wordLength - 单词长度（可选，默认为单词实际长度）
   * @returns {Promise<boolean>} - 单词是否有效
   */
  async isValidWord(word, wordLength = null) {
    const targetWord = (word || '').toLowerCase();
    const length = wordLength || targetWord.length;

    const dictionaries = await this.loadAllDictionaries(); // 确保索引已构建

    if (!this.lengthStats || !this.globalWordSet) {
      this._buildIndexes(dictionaries);
    }

    if (!this.lengthStats.has(length)) return false;
    return this.globalWordSet.has(targetWord);
  }

  /**
   * 获取单词释义（性能优化：使用索引）
   * @param {string} word - 要查询的单词
   * @returns {Promise<string>} - 单词释义
   */
  async getWordDefinition(word) {
    const dictionaries = await this.loadAllDictionaries(); // 确保索引已构建
    if (!this.definitionIndex) this._buildIndexes(dictionaries);

    const targetWord = (word || '').toLowerCase();
    const hit = this.definitionIndex?.get(targetWord);
    if (hit && hit.definition) {
      return this.formatDefinition(hit.definition, hit.dictName);
    }
    return '';
  }

  /**
   * 格式化单词释义
   * @param {Object} definition - 单词释义对象
   * @param {string} dictName - 词典名称
   * @returns {string} - 格式化后的释义
   */
  formatDefinition(definition, dictName) {
    let result = '';
    
    if (definition['中释']) {
      result += `【中文释义】${definition['中释']}`;
    }
    
    if (definition['英释']) {
      if (result) result += '\n';
      result += `【英文释义】${definition['英释']}`;
    }
    
    if (result) {
      result += `\n📚 来自：${dictName}`;
    }
    
    return result;
  }

  /**
   * 获取所有可用的词典列表
   * @returns {Promise<Array<Object>>} - 词典列表
   */
  async getAvailableDictionaries() {
    const dictionaries = await this.loadAllDictionaries();
    const result = [];
    
    for (const dictName in dictionaries) {
      const dict = dictionaries[dictName];
      result.push({
        id: dictName,
        name: dict.name,
        wordCount: dict.wordList.length
      });
    }
    
    result.sort((a, b) => a.name.localeCompare(b.name));

    // 全部词库放在首位，词数为去重后的总量
    let totalWords = this.globalWordSet?.size;
    if (!totalWords) {
      totalWords = result.reduce((sum, dict) => sum + dict.wordCount, 0);
    }
    result.unshift({
      id: ALL_WORDBANK_ID,
      name: ALL_WORDBANK_NAME,
      wordCount: totalWords
    });

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

export default new WordleWordNew();