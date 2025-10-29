import word from './word-new.js';
import renderer from './renderer.js';
import db from './db.js';

/**
 * Wordle工具整合模块
 * 整合所有拆分出去的工具模块，提供统一的接口
 */
class WordleUtils {
  constructor() {
    this.db = db;
    this.word = word;
    this.renderer = renderer;
    
    // 注入必要的方法依赖
    this._injectDependencies();
  }

  /**
   * 注入模块间的依赖关系
   * 确保各个模块能够正常协作
   */
  _injectDependencies() {
    this.word.injectGetWordbankSelection(this.db.getWordbankSelection.bind(this.db));
  }

  /**
   * 检查猜测结果（性能优化版：两遍扫描 + 频次表）
   * @param {string} guess - 用户猜测的单词
   * @param {string} target - 目标单词
   * @returns {Array} 猜测结果数组
   */
  checkGuess(guess, target) {
    guess = guess.toLowerCase();
    target = target.toLowerCase();

    const length = target.length;
    const result = new Array(length);
    const freq = Object.create(null);

    // 第一次遍历：标记正确位置，并统计剩余字母频次
    for (let i = 0; i < length; i++) {
      const g = guess[i];
      const t = target[i];
      if (g === t) {
        result[i] = { letter: g, status: 'correct' };
      } else {
        result[i] = { letter: g, status: 'pending' };
        freq[t] = (freq[t] || 0) + 1;
      }
    }

    // 第二次遍历：为非正确位置分配 present/absent
    for (let i = 0; i < length; i++) {
      if (result[i].status === 'pending') {
        const g = guess[i];
        if (freq[g] > 0) {
          result[i].status = 'present';
          freq[g] -= 1;
        } else {
          result[i].status = 'absent';
        }
      }
    }

    return result;
  }

  /**
   * 格式化结果显示
   * @param {Array} result - 猜测结果数组
   * @returns {string} 格式化后的结果字符串
   */
  formatResult(result) {
    let formatted = '';
    for (const item of result) {
      switch (item.status) {
        case 'correct':
          formatted += '🟩';
          break;
        case 'present':
          formatted += '🟨';
          break;
        case 'absent':
          formatted += '⬜';
          break;
      }
    }
    return formatted;
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
        return `🟩${letter}`;
      case 'present':
        return `🟨${letter}`;
      case 'absent':
        return `⬛${letter}`;
      case 'unknown':
      default:
        return `⬜${letter}`;
    }
  }

  /**
   * 获取每个字母的状态（基于猜测与目标词）
   * @param {Array<string>} guesses - 已猜测的单词数组
   * @param {string} targetWord - 目标单词
   * @returns {Map<string, string>} 字母状态映射
   */
  getLetterStatus(guesses, targetWord) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const letterStatus = new Map();
    for (const letter of alphabet) letterStatus.set(letter, 'unknown');

    const guessArray = Array.isArray(guesses) ? guesses : [];
    for (const guess of guessArray) {
      const result = this.checkGuess(guess, targetWord);
      for (let i = 0; i < guess.length; i++) {
        const letter = guess[i];
        const status = result[i].status;

        if (status === 'correct') letterStatus.set(letter, 'correct');
        else if (status === 'present' && letterStatus.get(letter) !== 'correct') letterStatus.set(letter, 'present');
        else if (status === 'absent' && letterStatus.get(letter) === 'unknown') letterStatus.set(letter, 'absent');
      }
    }

    return letterStatus;
  }

  /**
   * 获取每个字母的状态（基于已计算的结果，避免重复计算）
   * @param {Array<string>} guesses - 已猜测的单词数组
   * @param {Array<Array<{letter:string,status:string}>>} results - 与每次猜测对应的结果
   * @returns {Map<string, string>} 字母状态映射
   */
  getLetterStatusFromResults(guesses, results) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const letterStatus = new Map();
    for (const letter of alphabet) letterStatus.set(letter, 'unknown');

    const guessArray = Array.isArray(guesses) ? guesses : [];
    const resultsArray = Array.isArray(results) ? results : [];

    for (let gi = 0; gi < guessArray.length; gi++) {
      const guess = guessArray[gi];
      const res = resultsArray[gi] || [];
      for (let i = 0; i < guess.length; i++) {
        const letter = guess[i];
        const status = res[i]?.status || 'unknown';
        if (status === 'correct') letterStatus.set(letter, 'correct');
        else if (status === 'present' && letterStatus.get(letter) !== 'correct') letterStatus.set(letter, 'present');
        else if (status === 'absent' && letterStatus.get(letter) === 'unknown') letterStatus.set(letter, 'absent');
      }
    }

    return letterStatus;
  }
}

export default new WordleUtils();