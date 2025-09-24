import fs from 'fs'
import path from 'path'

logger.mark(logger.yellow("[Wordle] 载入中"));

let pluginVersion = "5.1.4";
const pkgPath = path.join(process.cwd(), './plugins/wordle-plugin/package.json');
if (fs.existsSync(pkgPath)) {
  try {
    pluginVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || pluginVersion;
  } catch (error) {
    logger.debug(`[Wordle] 读取package.json版本失败: ${error.message}`);
  }
}

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename).replace(/^\//, ''); // Windows 路径修复
const files = fs.readdirSync(path.join(__dirname, 'apps')).filter(f => f.endsWith('.js'));
const results = await Promise.allSettled(files.map(f => import(new URL(`file:///${path.join(__dirname, 'apps', f)}`).href)));

const apps = {};
files.forEach((f, i) => {
  const name = f.replace('.js', '');
  if (results[i].status !== 'fulfilled') {
    logger.error(`载入 Wordle 插件时发生错误：${logger.red(name)}`);
    logger.error(results[i].reason);
  } else {
    const mod = results[i].value;
    apps[name] = mod[Object.keys(mod)[0]];
  }
});

logger.mark(logger.green(`[Wordle] 载入成功！`));
logger.mark(logger.green(`[Wordle] 当前版本：v${pluginVersion} Beta`));

export { apps };