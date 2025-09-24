import game from '../utils/game.js';
import utils from '../utils/utils.js';

export class Wordle extends plugin {
  constructor() {
    super({
      name: 'Wordle',
      dsc: '猜单词游戏',
      event: 'message', 
      priority: 5000,
      rule: [
        {
          reg: /^#[Ww]ordle(.*)$/i,
          fnc: 'wordle'
        },
        {
          reg: /^#释义\s+([a-zA-Z]+)$/i,
          fnc: 'getDefinition'
        },
        {
          reg: /^(?:#|!|！)?[a-zA-Z]+$/,
          fnc: 'listenMessages',
          log: false
        }
      ]
    });
    
    // 注入工具和游戏模块
    this.game = game;
    this.utils = utils;
  }
  
  /**
   * 监听所有消息，用于游戏进行中的直接猜测
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async listenMessages(e) {
    return await this.game.listenMessages(e);
  }
  
  /**
   * Wordle主函数
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async wordle(e) {
    return await this.game.wordle(e);
  }

  /**
   * 获取单词释义
   * @param {*} e - 消息事件对象
   * @returns {Promise<boolean>} - 处理结果
   */
  async getDefinition(e) {
    const match = e.msg.match(/^#释义\s+([a-zA-Z]+)$/i);
    if (!match) {
      return false;
    }
    
    const word = match[1].toLowerCase();
    const definition = await this.utils.word.getWordDefinition(word);
    
    if (definition) {
      await e.reply(`📖 单词：${word.toUpperCase()}
${definition}`);
      return true;
    } else {
      await e.reply(`❌ 未找到单词 "${word.toUpperCase()}" 的释义。\n该单词可能不在当前词库中。`);
      return false;
    }
  }
  
}
