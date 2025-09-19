> [!warning]
> 目前仍在 Beta 版，有任何使用问题欢迎提 issue

# Wordle 游戏插件

基于原Wordle网页版的云崽Bot改版，为云崽Bot提供更智能、更友好的游戏体验。

## 食用方法

### 1. 下载插件

### github源

```console
git clone --depth=1 https://github.com/Pimeng/wordle-plugin.git ./plugins/wordle-plugin
```

### gitee源（国内用户推荐，更新可能延迟）

```console
git clone --depth=1 https://gitee.com/Pimeng/wordle-plugin.git ./plugins/wordle-plugin
```

### github代理加速（速度可能不稳定）

```console
git clone --depth=1 https://gh-proxy.com/https://github.com/Pimeng/wordle-plugin.git ./plugins/wordle-plugin
```

### 2. 安装依赖（By 千奈千祁）

#### Linux安装

##### I. Ubuntu / Debian

```console
sudo apt update
sudo apt install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

##### I. CentOS / RHEL

```console
sudo yum install -y gcc-c++ cairo-devel pango-devel libjpeg-turbo-devel giflib-devel librsvg2-devel
```

##### II. 编译安装canvas
```console
cd plugins/wordle-plugin
npm i
npm install canvas --build-from-source
```
#### Windows & Other

```console
cd plugins/wordle-plugin
pnpm i
pnpm approve-builds
```

### 3. 重启云崽之后就可以食用啦

### 常见问题

如果渲染报错，请尝试使用pnpm安装canvas依赖
```console
pnpm i canvas
```

如果报错日志里面的有 `canvas.node` 字样请考虑安装完依赖之后运行安装脚本……
```console
pnpm approve-builds
```

canvas还是有问题那就自己问AI自求多福吧……

## ✨ 特性

### 1. 重复单词检测 🔍
- 自动检测用户输入的重复单词
- 提示"已猜过"并不计入猜测次数
- 避免浪费宝贵的猜测机会

### 2. 冷却时间机制 ⏰
- 每次猜测后设置3秒冷却时间
- 防止刷屏和一次性多次回答
- 提升群聊环境的友好度

### 3. 多前缀支持 🎯
- 支持 `#apple` `!apple` 两种前缀格式
- 避免因为插件优先级被抢了导致不能正常进行游戏

### 4. 大小写兼容 🔤
- 完全支持大小写混合输入
- Apple、APPLE、apple 都能正确识别
- 提升用户体验

### 5. 智能键盘提示 ⌨️
- 实时显示字母使用状态
- 三行QWERTY键盘布局
- 颜色标识：🟩正确 🟨存在 ⬛不存在 ⬜未使用

## 🚀 使用方法

### 基本命令
```
#wordle                     # 开始5字母游戏
#wordle 7                   # 开始7字母游戏
#wordle apple               # 使用前缀猜测
!apple                      # 通过前缀猜词
#wordle 答案                 # 结束游戏
#wordle 帮助                 # 查看帮助
#wordle 词库 (全词库|四级词库) # 切换词库
```

### 前缀支持
- `#apple` - 使用#前缀
- `!apple` - 使用!前缀

## 🎮 游戏界面

游戏开始时会显示：
- 游戏规则说明
- 当前尝试次数
- 键盘提示预览
- 彩色游戏板

每次猜测后显示：
- 猜测结果（彩色方块）
- 剩余机会
- 键盘提示更新
- 单词释义（游戏结束时）

## 🔧 技术特性

- **Node.js Canvas渲染**：高质量游戏界面
- **内存缓存**：快速单词验证
- **正则匹配**：精准命令识别
- **错误处理**：完善的异常捕获

## 插件效果预览

<img src="https://gitee.com/pimeng/wordle-plugin/raw/main/resources/game-preview.png" width="60%" />

## 📝 更新日志

### v0.0.6 (当前版本)

- ✅ 没错，还是重构大量代码（其实是石山模块化（确信
- ✅ 新增百度翻译的选项

### v0.0.5

- ✅ 重构大量代码
- ✅ 改用Redis储存游戏数据
- ✅ 文本提示进一步优化

### v0.0.4

- ✅ 新增词库切换功能

### v0.0.3

- ✅ 新增重复单词检测
- ✅ 新增冷却时间机制
- ✅ 新增多前缀支持
- ✅ 新增自适应尝试次数
- ✅ 新增大小写兼容
- ✅ 新增键盘提示功能
- ✅ 优化帮助文档
- ✅ 提升用户体验

### v0.0.2 (初版)

- 基础Wordle游戏功能
- 5字母单词猜测
- 6次尝试机会
- 基础命令支持

### v0.0.1

被我吃了（bushi

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个插件！

## 📄 许可证

本项目基于GPL-3.0许可证开源，您可以在遵守许可证条款的前提下自由使用、修改和分发本项目的代码。

## 🔗 联系我

https://github.com/Pimeng#%E8%81%94%E7%B3%BB%E6%96%B9%E5%BC%8F

---

**享受游戏，快乐猜词！** 🎉
