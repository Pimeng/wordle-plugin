import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFile = path.join(pluginRoot, 'config', 'default.yaml');
const configFile = path.join(pluginRoot, 'config', 'config.yaml');

/** 参与热重载的配置文件 */
const WATCH_FILES = new Set([path.basename(defaultFile), path.basename(configFile)]);

/** 一次保存常触发多个文件事件，合并到一次重载 */
const WATCH_DEBOUNCE_MS = 250;

/** 内置帮助图背景地址：white = 白底立绘；blur = 竖图模糊羽化 */
const PRESET_BACKGROUNDS = {
  white: 'https://t.alcy.cc/bd',
  blur: 'https://t.alcy.cc/moemp'
};

/** 可选版式：白底整图 / 横向照片 / 右侧竖图 */
const BACKGROUND_MODES = ['white', 'photo', 'portrait'];

/** 背景获取失败的负缓存时长（ms） */
const BACKGROUND_FAIL_TTL = 30 * 1000;

const FALLBACK = {
  render: {
    preset: 'blur',
    background: '',
    backgroundBlur: 16,
    backgroundCache: 60,
    backgroundMode: ''
  }
};

function merge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = merge({ ...(target[key] || {}) }, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function readYaml(file) {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    return {};
  }
}

/**
 * Wordle 插件配置
 * 默认值 default.yaml + 用户配置 config.yaml 合并，支持热重载
 */
class WordleConfig {
  constructor() {
    this._data = null;
    this._watcher = null;
    this._watchTimer = null;
    this.ensureUserConfig();
    this.watch();
  }

  /** 首次运行时从 default.yaml 复制生成用户配置 */
  ensureUserConfig() {
    try {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      if (!fs.existsSync(configFile) && fs.existsSync(defaultFile)) {
        fs.copyFileSync(defaultFile, configFile);
      }
    } catch (err) {
      global.logger?.warn?.(`[Wordle] 配置文件创建失败：${err?.message ?? err}`);
    }
  }

  /**
   * 监听配置目录实现热重载。
   * 不直接 watch 单个文件：多数编辑器保存时是「写临时文件 + 重命名覆盖」，
   * 目标文件被替换后原文件句柄失效，监听会失效。改看目录、按文件名过滤更稳。
   */
  watch() {
    if (this._watcher) return;
    try {
      this._watcher = fs.watch(path.dirname(configFile), (_event, filename) => {
        const name = filename ? String(filename) : '';
        if (name && !WATCH_FILES.has(name)) return;
        this.scheduleReload();
      });
      this._watcher.on?.('error', error => {
        global.logger?.warn?.(`[Wordle] 配置监听异常：${error?.message ?? error}`);
      });
      this._watcher.unref?.();
    } catch (error) {
      global.logger?.warn?.(`[Wordle] 配置热重载不可用（修改配置后需重启）：${error?.message ?? error}`);
    }
  }

  /** 防抖：合并同一批文件事件后再重载 */
  scheduleReload() {
    if (this._watchTimer) clearTimeout(this._watchTimer);
    this._watchTimer = setTimeout(() => {
      this._watchTimer = null;
      this.reload();
    }, WATCH_DEBOUNCE_MS);
    this._watchTimer.unref?.();
  }

  reload() {
    this._data = null;
  }

  get data() {
    if (this._data) return this._data;
    const base = JSON.parse(JSON.stringify(FALLBACK));
    const defaults = merge(base, readYaml(defaultFile));
    this._data = merge(defaults, readYaml(configFile));
    return this._data;
  }

  /**
   * 帮助图样式：white 白底；blur 背景图模糊
   */
  get renderPreset() {
    const value = String(this.data.render?.preset || 'blur').toLowerCase();
    return value === 'white' ? 'white' : 'blur';
  }

  /**
   * 帮助图背景地址。自定义地址优先，留空时使用当前预置的内置地址。
   */
  get background() {
    const custom = String(this.data.render?.background || '').trim();
    return custom || PRESET_BACKGROUNDS[this.renderPreset];
  }

  /**
   * 版式模式。显式配置优先，留空则跟随当前预置。
   */
  get backgroundMode() {
    const value = String(this.data.render?.backgroundMode || '').toLowerCase();
    return BACKGROUND_MODES.includes(value) ? value : '';
  }

  /**
   * 背景模糊度（px），仅 blur 样式生效
   */
  get backgroundBlur() {
    const value = Number(this.data.render?.backgroundBlur);
    return Number.isFinite(value) && value >= 0 ? value : 16;
  }

  /**
   * 背景图缓存时间（秒），避免频繁请求随机图接口；为 0 时不缓存
   */
  get backgroundCache() {
    const value = Number(this.data.render?.backgroundCache);
    return Number.isFinite(value) && value >= 0 ? value : 60;
  }
}

export const Config = new WordleConfig();
export { PRESET_BACKGROUNDS, BACKGROUND_MODES, BACKGROUND_FAIL_TTL, configFile, defaultFile };
