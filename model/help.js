/**
 * Wordle帮助数据
 * 帮助图与文字回退共用同一份数据，避免两处内容不一致
 */

export const HELP_SECTIONS = [
  {
    title: '游戏命令',
    items: [
      { cmd: '#wordle', desc: '开始新游戏（默认 5 字母）' },
      { cmd: '#wordle [数字]', desc: '开始指定字母数量的游戏（3-10）' },
      { cmd: '#wordle ans', desc: '结束当前游戏并查看答案' },
      { cmd: '#释义 [单词]', desc: '查询单词的中英文释义' }
    ]
  },
  {
    title: '词库切换',
    items: [
      { cmd: '#wordle 词典', desc: '循环切换词典' },
      { cmd: '#wordle 词典 列表', desc: '查看当前词库与全部可用词库' },
      { cmd: '#wordle 词典 [序号|名称]', desc: '按序号或名称切换，如 4、四级' },
      { cmd: '#wordle 词典 全部', desc: '使用全部词库，随机范围最大' }
    ]
  },
  {
    title: '排行榜',
    items: [
      { cmd: '#wordle 排行榜', desc: '查看本群排行榜（可选：胜场/参与/胜率）' },
      { cmd: '#wordle 总排行榜', desc: '查看全局排行榜（可选：胜场/参与/胜率）' }
    ]
  },
  {
    title: '提交猜测',
    items: [
      { cmd: '#apple / !apple', desc: '使用 # 或 ! 前缀提交猜测' }
    ]
  }
];

/** 文字版帮助（渲染失败时回退） */
export const HELP_TEXT = [
  'Wordle 游戏帮助',
  '',
  ...HELP_SECTIONS.flatMap(section => [
    `【${section.title}】`,
    ...section.items.map(item => `${item.cmd} - ${item.desc}`),
    ''
  ]),
  '帮助图样式可在 config/config.yaml 的 render.preset 中切换（white / blur）'
].join('\n').trim();
