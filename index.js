import fs from 'fs'
import path from 'path'

logger.mark(logger.yellow("[Wordle] 载入中"));

if (!global.segment) {
  global.segment = (await import("oicq")).segment;
}

let pluginVersion = "5.1.4"
const pluginPackagePath = path.join(process.cwd(), './plugins/wordle-plugin/package.json');
if (fs.existsSync(pluginPackagePath)) {
  const pluginPackage = JSON.parse(fs.readFileSync(pluginPackagePath, 'utf8'));
  pluginVersion = pluginPackage.version || pluginVersion;
}

let ret = [];

const files = fs
  .readdirSync('./plugins/wordle-plugin/apps')
  .filter((file) => file.endsWith('.js'));

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret);

let apps = {};
for (let i in files) {
  let name = files[i].replace('.js', '');

  if (ret[i].status !== 'fulfilled') {
    logger.error(`载入 Wordle 插件时发生错误：${logger.red(name)}`);
    logger.error(ret[i].reason);
    continue;
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]];  
}

logger.mark(logger.green(`[Wordle] 载入成功！  当前版本：v${pluginVersion} Beta`));

export { apps };