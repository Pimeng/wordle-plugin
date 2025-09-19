import fs from 'fs';
import yaml from 'yaml';
import crypto from 'crypto';
import path from 'node:path';
import { fileURLToPath } from 'url';

/**
 * Wordle翻译功能模块
 * 负责单词翻译、语言检测等功能
 */
class WordleTranslate {
  constructor() {
    this.__filename = fileURLToPath(import.meta.url);
    this.__dirname = path.dirname(this.__filename);
    this.configPath = path.resolve(this.__dirname, '../config/baidu_translate.yaml');
    this.baiduTranslateConfig = this.loadBaiduTranslateConfig();
  }

  /**
   * 加载百度翻译配置
   * @returns {Object} - 百度翻译配置
   */
  loadBaiduTranslateConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const config = yaml.parse(configData);
        logger.mark(logger.green('[Wordle] 让我看看配置文件...很不错，一切正常'));
        return {
          appid: config.appid || '',
          appkey: config.appkey || '',
          from_lang: config.from_lang || 'en',
          to_lang: config.to_lang || 'zh',
          enable: config.enable !== false
        };
      }
    } catch (error) {
      logger.warn('加载百度翻译配置失败:', error);
    }
    
    // 默认配置
    return {
      appid: '',
      appkey: '',
      from_lang: 'en',
      to_lang: 'zh',
      enable: true
    };
  }

  /**
   * 使用百度翻译API翻译文本
   * @param {string} text - 要翻译的文本
   * @param {string} fromLang - 源语言（可选，默认使用配置中的from_lang）
   * @param {string} toLang - 目标语言（可选，默认使用配置中的to_lang）
   * @returns {Promise<string>} - 翻译结果
   */
  async translateWithBaidu(text, fromLang = null, toLang = null) {
    try {
      // 验证配置
      if (!this.baiduTranslateConfig.appid || !this.baiduTranslateConfig.appkey) {
        logger.warn('百度翻译API配置不完整，跳过翻译');
        logger.info('如需使用翻译功能，请配置plugins/wordle-plugin/config/baidu_translate.yaml文件');
        logger.info('申请地址：https://fanyi-api.baidu.com/');
        return '';
      }

      if (!this.baiduTranslateConfig.enable) {
        logger.debug('百度翻译功能已禁用');
        return '';
      }
      if (!text || typeof text !== 'string') {
        logger.warn('翻译文本无效:', text);
        return '';
      }
      text = text.trim();
      if (!text) {
        logger.warn('翻译文本为空');
        return '';
      }
      const sourceLang = fromLang || this.baiduTranslateConfig.from_lang;
      const targetLang = toLang || this.baiduTranslateConfig.to_lang;
      const salt = Math.random().toString().substring(2, 8);
      const signStr = this.baiduTranslateConfig.appid + text + salt + this.baiduTranslateConfig.appkey;
      const sign = crypto.createHash('md5').update(signStr).digest('hex');
      const params = new URLSearchParams({
        q: text,
        from: sourceLang,
        to: targetLang,
        appid: this.baiduTranslateConfig.appid,
        salt: salt,
        sign: sign
      });
      const url = `https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`;
      logger.debug(`百度翻译请求: ${text} (${sourceLang} -> ${targetLang})`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          logger.warn(`百度翻译API请求失败: HTTP ${response.status} ${response.statusText}`);
          return '';
        }
        const data = await response.json();
        if (data.error_code) {
          const errorMsg = this.getBaiduErrorMessage(data.error_code, data.error_msg);
          logger.warn(`百度翻译API错误 [${data.error_code}]: ${errorMsg}`);
          return '';
        }
        if (data.trans_result && data.trans_result.length > 0) {
          const translation = data.trans_result[0].dst;
          logger.debug(`百度翻译成功: ${text} -> ${translation}`);
          return translation;
        }
        
        logger.warn('百度翻译API返回数据格式异常:', data);
        return '';
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError' || error.message?.includes('timeout')) {
          logger.warn('百度翻译请求超时');
        } else {
          logger.warn('百度翻译失败:', error.message || error);
        }
        return '';
      }
    } catch (error) {
      logger.warn('百度翻译过程中发生错误:', error.message || error);
      return '';
    }
  }

  /**
   * 获取百度翻译错误代码的详细说明
   * @param {string} errorCode - 错误代码
   * @param {string} errorMsg - 错误消息
   * @returns {string} - 详细的错误说明
   */
  getBaiduErrorMessage(errorCode, errorMsg) {
    const errorMap = {
      '52001': '请求超时，请检查网络连接',
      '52002': '系统错误，请重试',
      '52003': '未授权用户，请检查appid是否正确',
      '54000': '必填参数为空，请检查参数',
      '54001': '签名错误，请检查appkey是否正确',
      '54003': '访问频率受限，请降低调用频率',
      '54004': '账户余额不足，请充值',
      '54005': '长query请求频繁，请降低长文本翻译频率',
      '58000': '客户端IP非法，请检查IP地址',
      '58001': '译文语言方向不支持，请检查语言代码',
      '58002': '服务当前已关闭，请检查服务状态',
      '90107': '认证未通过或未生效，请检查认证状态'
    };
    
    return errorMap[errorCode] || errorMsg || '未知错误';
  }

  /**
   * 快速翻译函数 - 简化的翻译接口
   * @param {string} text - 要翻译的文本
   * @param {string} from - 源语言（可选）
   * @param {string} to - 目标语言（可选）
   * @returns {Promise<string>} - 翻译结果
   */
  async quickTranslate(text, from = null, to = null) {
    return await this.translateWithBaidu(text, from, to);
  }

  /**
   * 检测文本语言（使用百度翻译API的语言检测功能）
   * @param {string} text - 要检测的文本
   * @returns {Promise<string>} - 语言代码
   */
  async detectLanguage(text) {
    try {
      if (!text || typeof text !== 'string') {
        return '';
      }
      
      text = text.trim();
      if (!text) {
        return '';
      }

      // 使用百度翻译API进行语言检测（通过尝试翻译到中文来检测源语言）
      const result = await this.translateWithBaidu(text, 'auto', 'zh');
      
      // 如果翻译成功，说明检测到了语言
      if (result) {
        // 简单的语言判断逻辑
        if (/^[a-zA-Z\s]+$/.test(text)) {
          return 'en'; // 英文
        } else if (/[\u4e00-\u9fff]/.test(text)) {
          return 'zh'; // 中文
        } else if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
          return 'jp'; // 日文
        } else if (/[\uac00-\ud7af]/.test(text)) {
          return 'kor'; // 韩文
        } else {
          return 'auto'; // 其他语言
        }
      }
      
      return '';
    } catch (error) {
      logger.warn('语言检测失败:', error);
      return '';
    }
  }

  /**
   * 获取配置信息
   * @returns {Object} - 百度翻译配置
   */
  getConfig() {
    return this.baiduTranslateConfig;
  }

  /**
   * 重新加载配置
   */
  reloadConfig() {
    this.baiduTranslateConfig = this.loadBaiduTranslateConfig();
  }
}

export default new WordleTranslate();