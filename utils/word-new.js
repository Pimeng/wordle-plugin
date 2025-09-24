import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

/**
 * Wordle单词管理模块（JSON词典版本）
 * 负责从JSON词典文件加载单词、释义、验证等操作
 */
class WordleWordNew {
  constructor() {
    this.wordsCache = null;
    this.lengthStats = null;
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

    try {
      const allDictionaries = {};
      
      // 加载所有词典文件
      for (const dictFile of this.dictionaryFiles) {
        const dictPath = path.resolve(this.dictionariesPath, dictFile);
        if (fs.existsSync(dictPath)) {
          const content = fs.readFileSync(dictPath, 'utf-8');
          const dictionary = JSON.parse(content);
          
          // 提取词典名称（不带.json后缀）
          const dictName = dictFile.replace('.json', '');
          allDictionaries[dictName] = {
            name: this.dictionaryNames[dictFile] || dictName,
            words: dictionary,
            wordList: Object.keys(dictionary)
          };
        }
      }

      this.wordsCache = {
        data: allDictionaries,
        timestamp: Date.now()
      };
      
      return allDictionaries;
    } catch (error) {
      logger.error('加载词典数据时出错:', error);
      return {};
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
    let selectedDict;
    if (groupId) {
      if (typeof this.getWordbankSelection !== 'function') {
        logger.warn('getWordbankSelection方法未注入，使用四级词库');
        selectedDict = dictionaries['CET4'];
      } else {
        const selectedDictName = await this.getWordbankSelection(groupId);
        selectedDict = dictionaries[selectedDictName] || dictionaries['CET4'];
      }
    } else {
      selectedDict = dictionaries['CET4'];
    }
    
    if (!selectedDict) {
      logger.error('未找到选择的词典');
      return null;
    }
    
    // 过滤指定长度的单词
    const filteredWords = selectedDict.wordList.filter(word => word.length === letterCount);
    
    if (filteredWords.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredWords.length);
      const selectedWord = filteredWords[randomIndex];
      logger.mark("[Wordle] 单词：" + selectedWord + "（来自：" + selectedDict.name + "）");
      return selectedWord;
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
      const dictionaries = await this.loadAllDictionaries();
      this.lengthStats = new Set(
        Object.values(dictionaries)
          .flatMap(dict => dict.wordList.map(word => word.length))
      );
    }
    
    if (!this.lengthStats.has(length)) {
      return false;
    }
    
    const dictionaries = await this.loadAllDictionaries();
    
    // 在所有词典中查找单词
    for (const dictName in dictionaries) {
      const found = dictionaries[dictName].wordList.some(w => w.length === length && w === targetWord);
      if (found) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 获取单词释义
   * @param {string} word - 要查询的单词
   * @returns {Promise<string>} - 单词释义
   */
  async getWordDefinition(word) {
    const dictionaries = await this.loadAllDictionaries();
    const targetWord = word.toLowerCase();
    
    // 在所有词典中查找单词释义
    for (const dictName in dictionaries) {
      const dict = dictionaries[dictName];
      if (dict.words[targetWord]) {
        const definition = dict.words[targetWord];
        return this.formatDefinition(definition, dict.name);
      }
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
    
    return result.sort((a, b) => a.name.localeCompare(b.name));
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