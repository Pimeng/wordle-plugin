# <img width="25px" src="resources/wordle.png"> Wordle 游戏插件 

基于原Wordle网页版的云崽Bot改版，参考的 https://wordle.org

由于当时是真的闲得慌，所以就用AI写了这个插件，第一次写大插件如有不足之处还请多多包涵哈

如果插件使用有问题请反馈！渲染使用云崽自带的 `Puppeteer`（Chromium），遇到渲染问题请看[常见问题](#-常见问题)

> 这个仓库我也不知道为什么搬到 Gitee 会被封库，有知道的可以提 issue

## 安装方法

### 1. 下载插件

#### <img width="15px" src="https://github.com/favicon.ico"> GitHub源

```console
git clone --depth=1 https://github.com/Pimeng/wordle-plugin.git ./plugins/wordle-plugin
```


#### <img width="15px" src="https://github.com/favicon.ico"> GitHub代理加速

```console
git clone --depth=1 https://gh-proxy.com/https://github.com/Pimeng/wordle-plugin.git ./plugins/wordle-plugin
```

#### <img width="15px" src="https://cdn-static.gitcode.com/static/images/logo-favicon.png"> Gitcode源(更新可能不及时)

```console
git clone --depth=1 https://gitcode.com/Mirror-Yunzai/wordle-plugin.git ./plugins/wordle-plugin
```

### 2. 安装依赖

本插件使用云崽自带的 Puppeteer（Chromium）截图渲染，不再依赖 canvas：

```console
cd plugins/wordle-plugin
pnpm i
```

若云崽未安装 Chromium，可在云崽根目录执行：

```console
node node_modules/puppeteer/install.js
```

Linux 下如缺少 Chromium 运行库（如 `libnss3`、`libatk-bridge2.0-0`、`libx11-xcb1`、`libxcomposite1`、`libxdamage1`、`libxrandr2`、`libgbm1`、`libasound2` 等），请按发行版自行安装。

### 3. 重启云崽之后就可以食用啦

## 📚 常见问题

如果渲染报错，请先确认云崽的 Chromium/Puppeteer 可用，可在云崽根目录执行安装命令：

```console
node node_modules/puppeteer/install.js
```

- 日志出现 `Could not find Chromium`：Chromium 未安装或安装不完整
- 日志出现 `cannot open shared object file`：缺少系统运行库，请补装对应的 Chromium 依赖
- 浏览器连接异常时可尝试删除 `data/puppeteer` 后重启云崽

## 🚀 使用方法

### 基本命令
```log
#wordle            # 开始常规游戏
#wordle 7          # 开始7字母游戏
#apple             # 使用前缀猜测
!apple             # 通过前缀猜词
#wordle 答案       # 结束游戏
#wordle 帮助       # 查看帮助
#wordle 词典       # 循环切换词典
#wordle 词典 列表  # 查看当前词库与全部可用词库
#wordle 词典 4     # 按序号切换词库
#wordle 词典 四级  # 按名称切换词库
#wordle 词典 全部  # 使用全部词库（随机范围最大）
#wordle 排行榜     # 查看群排行榜（可选：胜场/参与/胜率）
#wordle 总排行榜   # 查看全局排行榜（可选：胜场/参与/胜率）
#释义 access       # 查询单词释义
```

## 🎉 正在使用本插件的Bot

- 云露露 [官方群](https://qm.qq.com/q/rGR21aiSSA)
- 依涵


## 👀 插件效果预览

<img src="https://raw.githubusercontent.com/Pimeng/wordle-plugin/main/resources/game-preview.png" width="60%" />

## 📝 更新日志

> 具体更新日志请查看 Commits

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个插件！

## 📄 许可证

本项目基于GPL-3.0许可证开源，您可以在遵守许可证条款的前提下自由使用、修改和分发本项目的代码。

## 🔗 联系我

https://github.com/Pimeng#%E8%81%94%E7%B3%BB%E6%96%B9%E5%BC%8F

> 本插件大量代码均由 Kimi-K2 & Gemini 3 Pro & GPT-5 & Claude 4.5 编写
