import fs from 'fs'
// import path from 'path'

logger.mark(logger.yellow("[Wordle] 正在载入组件中"));

if (!global.segment) {
  global.segment = (await import("oicq")).segment;
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
    logger.error(`载入插件时发生错误：${logger.red(name)}`);
    logger.error(ret[i].reason);
    continue;
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]];
}

logger.mark(logger.green("[Wordle] 载入成功！"));

export { apps };