import fs from 'node:fs'
import path from 'node:path'

logger.mark(logger.yellow('[Wordle] 载入中'))

let pluginVersion = '5.1.4'
const pkgPath = path.join(process.cwd(), './plugins/wordle-plugin/package.json')
if (fs.existsSync(pkgPath)) {
  try {
    pluginVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || pluginVersion
  } catch (err) {
    logger.debug(`[Wordle] 读取package.json版本失败: ${err.message}`)
  }
}

let ret = []

const files = fs
  .readdirSync('./plugins/wordle-plugin/apps')
  .filter((file) => file.endsWith('.js'))

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')

  if (ret[i].status != 'fulfilled') {
    logger.error(`载入 Wordle 插件时发生错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

logger.mark(logger.green(`[Wordle] 载入成功！`))
logger.info(logger.green(`[Wordle] 当前版本：v${pluginVersion}`))

export { apps }
