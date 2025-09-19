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
          reg: /^(?:#|!|！)?[a-zA-Z]+$/,
          fnc: 'listenMessages',
          log: false
        }
      ]
    });
    
    // 保留必要的配置引用，方便其他模块访问
    this.REGEX_WORDLE_CMD = /^#[Ww]ordle(.*)$/i;
    this.REGEX_ALPHA = /^[a-zA-Z]+$/
    this.REGEX_NUMBER = /^\d+$/;
    
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
}
