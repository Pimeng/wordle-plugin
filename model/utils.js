import word from './word.js';
import renderer from './renderer.js';
import db from './db.js';
import leaderboard from './leaderboard.js';
import {
  checkGuess,
  formatResult,
  getLetterSymbol,
  getLetterStatus,
  getLetterStatusFromResults
} from './checker.js';

/**
 * Wordle工具整合模块
 * 整合所有拆分出去的工具模块，提供统一的接口
 */
class WordleUtils {
  constructor() {
    this.db = db;
    this.word = word;
    this.renderer = renderer;
    this.leaderboard = leaderboard;

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
   * 检查猜测结果
   * @param {string} guess - 用户猜测的单词
   * @param {string} target - 目标单词
   * @returns {Array} 猜测结果数组
   */
  checkGuess(guess, target) {
    return checkGuess(guess, target);
  }

  /**
   * 格式化结果显示
   * @param {Array} result - 猜测结果数组
   * @returns {string} 格式化后的结果字符串
   */
  formatResult(result) {
    return formatResult(result);
  }

  /**
   * 根据字母状态返回对应的显示符号
   * @param {string} letter - 字母
   * @param {string} status - 状态：correct, present, absent, unknown
   * @returns {string} 显示符号
   */
  getLetterSymbol(letter, status) {
    return getLetterSymbol(letter, status);
  }

  /**
   * 获取每个字母的状态（基于猜测与目标词）
   * @param {Array<string>} guesses - 已猜测的单词数组
   * @param {string} targetWord - 目标单词
   * @returns {Map<string, string>} 字母状态映射
   */
  getLetterStatus(guesses, targetWord) {
    return getLetterStatus(guesses, targetWord);
  }

  /**
   * 获取每个字母的状态（基于已计算的结果，避免重复计算）
   * @param {Array<string>} guesses - 已猜测的单词数组
   * @param {Array<Array<{letter:string,status:string}>>} results - 与每次猜测对应的结果
   * @returns {Map<string, string>} 字母状态映射
   */
  getLetterStatusFromResults(guesses, results) {
    return getLetterStatusFromResults(guesses, results);
  }
}

export default new WordleUtils();
