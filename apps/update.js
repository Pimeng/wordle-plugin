import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { exec } = require("child_process");
import fs from 'fs';
import path from 'node:path';

// 更新状态标志
let updateStatus = false;

/**
 * Wordle插件更新功能
 */
export class WordleUpdate extends plugin {
  constructor() {
    super({
      name: 'Wordle更新',
      dsc: 'Wordle插件更新功能',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^(#|/)?(wordle|猜词)(强制)?更新$',
          fnc: 'wordleUpdate',
          Permission: 'master'
        }
      ]
    });
  }

  /**
   * Wordle插件更新
   */
  async wordleUpdate(e) {
    if (updateStatus) {
      await e.reply('[Wordle] 更新正在进行中，请稍后再试');
      return true;
    }

    updateStatus = true;
    try {
      // 获取插件目录
      const pluginPath = path.join(process.cwd(), './plugins/wordle-plugin');
      
      // 执行git pull命令
      let command = 'git pull --no-rebase';
      
      // 如果是强制更新，先重置本地修改
      if (e.msg.includes('强制')) {
        await e.reply('[Wordle] 正在执行强制更新操作，请稍等');
        command = `git checkout . && ${command}`;
      } else {
        await e.reply('[Wordle] 正在执行更新操作，请稍等');
      }
      
      // 记录更新前的commit id，用于获取更新日志
      let oldCommitId = await this.getCommitId(pluginPath);
      
      // 执行git pull命令
      let ret = await this.execCommand(command, pluginPath);
      
      // 安装依赖
      await this.installDependencies(pluginPath);
      
      // 检查更新结果
      if (ret.error) {
        this.handleGitError(ret.error, ret.stdout, e);
        updateStatus = false;
        return true;
      }
      
      // 获取更新时间
      let updateTime = await this.getUpdateTime(pluginPath);
      
      // 检查是否已经是最新版本
      if (/(Already up[ -]to[ -]date|已经是最新的)/.test(ret.stdout)) {
        await e.reply(`Wordle插件已经是最新的了\n最后更新时间: ${updateTime}`);
      } else {
        await e.reply(`[Wordle] 插件更新成功\n最后更新时间: ${updateTime}`);
        
        // 获取更新日志
        let log = await this.getUpdateLog(pluginPath, oldCommitId, e);
        if (log && log.length > 0) {
          try {
            // 尝试发送合并消息
            let msgList = log.map(item => ({
              user_id: Bot.uin,
              nickname: Bot.nickname,
              message: item
            }));
            
            // 根据环境选择合适的方式发送合并消息
            let forwardMsg;
            if (e.group) {
              forwardMsg = await e.group.makeForwardMsg(msgList);
            } else if (e.friend) {
              forwardMsg = await e.friend.makeForwardMsg(msgList);
            }
            
            if (forwardMsg) {
              await e.reply(forwardMsg);
            } else {
              // 如果无法发送合并消息，逐条发送
              for (let item of log) {
                await e.reply(item);
              }
            }
          } catch (err) {
            logger.error(`发送更新日志失败: ${err.message}`);
          }
          
          // 提示重启以应用更新
          await e.reply('请重启Yunzai以应用更新\n【#重启】');
        }
      }
      
      updateStatus = false;
      return true;
    } catch (err) {
      logger.error(`Wordle插件更新失败: ${err.message}`);
      await e.reply(`Wordle插件更新失败: ${err.message}`);
      updateStatus = false;
      return false;
    }
  }

  /**
   * 执行命令并返回结果
   */
  async execCommand(cmd, cwd = process.cwd()) {
    return new Promise((resolve) => {
      exec(cmd, { cwd, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ error, stdout, stderr });
      });
    });
  }

  /**
   * 获取最后一次提交的commit id
   */
  async getCommitId(pluginPath) {
    try {
      let cm = 'git rev-parse --short HEAD';
      let commitId = await this.execCommand(cm, pluginPath);
      return commitId.stdout ? commitId.stdout.trim() : '';
    } catch (error) {
      logger.error(`获取commit id失败: ${error.message}`);
      return '';
    }
  }

  /**
   * 获取更新时间
   */
  async getUpdateTime(pluginPath) {
    try {
      let cm = 'git log -1 --oneline --pretty=format:"%cd" --date=format:"%Y-%m-%d %H:%M:%S"';
      let ret = await this.execCommand(cm, pluginPath);
      return ret.stdout ? ret.stdout.trim() : '获取时间失败';
    } catch (error) {
      logger.error(`获取更新时间失败: ${error.message}`);
      return '获取时间失败';
    }
  }

  /**
   * 安装依赖
   */
  async installDependencies(pluginPath) {
    try {
      // 检查是否有package.json文件
      const packageJsonPath = path.join(pluginPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        logger.mark('[Wordle] 正在安装/更新依赖...');
        // 尝试使用pnpm安装依赖
        let pnpmCmd = 'pnpm i --registry=https://registry.npmmirror.com';
        let pnpmRet = await this.execCommand(pnpmCmd, pluginPath);
        
        // 如果pnpm失败，尝试使用npm
        if (pnpmRet.error) {
          logger.warn('[Wordle] pnpm安装依赖失败，尝试使用npm...');
          let npmCmd = 'npm i --registry=https://registry.npmmirror.com';
          await this.execCommand(npmCmd, pluginPath);
        }
      }
    } catch (error) {
      logger.error(`安装依赖失败: ${error.message}`);
    }
  }

  /**
   * 获取更新日志
   */
  async getUpdateLog(pluginPath, oldCommitId, e) {
    try {
      let cm = 'git log -20 --oneline --pretty=format:"%h||[%cd]  %s" --date=format:"%Y-%m-%d %H:%M:%S"';
      let ret = await this.execCommand(cm, pluginPath);
      
      if (!ret.stdout) return [];
      
      const logAll = ret.stdout.split('\n');
      const log = [];
      
      for (let str of logAll) {
        str = str.split('||');
        // 如果到达上次更新的commit id，停止获取日志
        if (oldCommitId && str[0] === oldCommitId) break;
        // 跳过合并提交
        if (str.length > 1 && str[1].includes('Merge branch')) continue;
        if (str.length > 1) {
          log.push(str[1]);
        }
      }
      
      // 添加仓库链接
      if (log.length > 0) {
        log.push('更多详细信息，请前往插件仓库查看更新日志');
      }
      
      return log;
    } catch (error) {
      logger.error(`获取更新日志失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 处理Git错误
   */
  async handleGitError(err, stdout, e) {
    let msg = "Wordle插件更新失败！";
    let errMsg = err ? err.toString() : '';
    stdout = stdout ? stdout.toString() : '';

    if (errMsg.includes("Timed out")) {
      let remote = errMsg.match(/'(.+?)'/g)?.[0]?.replace(/'/g, "") || '';
      await e.reply(msg + `\n连接超时：${remote}`);
      return;
    }

    if (/Failed to connect|unable to access/g.test(errMsg)) {
      let remote = errMsg.match(/'(.+?)'/g)?.[0]?.replace(/'/g, "") || '';
      await e.reply(msg + `\n连接失败：${remote}`);
      return;
    }

    if (errMsg.includes("be overwritten by merge")) {
      await e.reply(
        msg +
        `存在冲突：\n${errMsg}\n` +
        "请解决冲突后再更新，或者执行#wordle强制更新，放弃本地修改"
      );
      return;
    }

    if (stdout.includes("CONFLICT")) {
      await e.reply([
        msg + "存在冲突\n",
        errMsg,
        stdout,
        "\n请解决冲突后再更新，或者执行#wordle强制更新，放弃本地修改",
      ]);
      return;
    }

    await e.reply([errMsg, stdout]);
  }
}